'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { launchApp, seedData, note, sleep, flush } = require('./helpers');

/* 两个应用实例（各自的本机目录 = 两台电脑）共用一个“同步文件夹”，模拟 OneDrive / 坚果云 */
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const imgWidths = (page) => page.evaluate(async () => {
  const imgs = [...document.querySelectorAll('#editor img')];
  await Promise.all(imgs.map(i => i.decode().catch(() => {})));
  return imgs.map(i => i.naturalWidth);
});
const ids = (page) => page.evaluate(() => liveNotes().map(n => n.id).sort());
/* 等到条件成立（同步每 2 秒检查一次文件，留足余量） */
async function waitFor(fn, ms = 9000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(300);
  }
}
const contentOf = (page, id) => page.evaluate((i) => (state.notes.find(n => n.id === i) || {}).content || '', id);

describe('数据位置与多设备同步', () => {
  let A;
  let B;
  const shared = tmp('floatnote-shared-');
  before(async () => {
    // 旧版本格式：本机设置混在 data.json 里，图片是本机绝对路径
    const dirA = tmp('floatnote-A-');
    fs.mkdirSync(path.join(dirA, 'images', 'a'), { recursive: true });
    fs.writeFileSync(path.join(dirA, 'images', 'a', 'pic.png'), PNG_1PX);
    seedData(dirA, {
      notes: [note('a', `<div>A 的便笺<img src="${pathToFileURL(path.join(dirA, 'images', 'a', 'pic.png')).href}"></div>`), note('b', '<div>第二张</div>')],
      settings: { activeNoteId: 'a', hotkey: 'CommandOrControl+Alt+Space', bounds: { x: 210, y: 150, width: 700, height: 400 } }
    });
    A = await launchApp({ dir: dirA });
  });
  after(async () => {
    await A.close(); // 先关闭再断言：断言失败时应用也不会一直开着，测试进程能正常结束
    if (B) await B.close();
    assert.deepEqual(A.errors, [], 'A 无页面错误');
    if (B) assert.deepEqual(B.errors, [], 'B 无页面错误');
  });

  it('旧数据迁移：图片地址与位置无关，本机设置拆到 local.json', async () => {
    assert.match(await contentOf(A.page, 'a'), /src="fnimg:\/\/a\/pic\.png"/);
    assert.deepEqual(await imgWidths(A.page), [1], '图片能显示');
    await A.page.click('#editor'); await A.page.keyboard.press('Control+End'); await A.page.keyboard.type('。');
    await flush();
    assert.equal(A.saved().settings.bounds, undefined, '窗口位置不再写进会同步的 data.json');
    assert.deepEqual(A.local().bounds, { x: 210, y: 150, width: 700, height: 400 });
  });

  it('数据位置改到同步文件夹：便笺和图片复制过去，原位置保留', async () => {
    const r = await A.page.evaluate((d) => window.api.setDataDir(d, 'move'), shared);
    assert.equal(r.ok, true);
    assert.equal(r.mode, 'move');
    await A.page.waitForFunction(() => typeof state !== 'undefined' && !!state.activeId); // 窗口重新加载
    await sleep(500);
    assert.ok(fs.existsSync(path.join(shared, 'data.json')));
    assert.ok(fs.existsSync(path.join(shared, 'images', 'a', 'pic.png')), '图片复制过去');
    assert.ok(fs.existsSync(path.join(A.dir, 'data.json')), '原位置的文件保留');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(A.dir, 'location.json'), 'utf-8')), { dataDir: path.resolve(shared) });
    assert.deepEqual(await imgWidths(A.page), [1], '换目录后图片照常显示');
    assert.equal((await A.page.evaluate(() => window.api.getDataDir())).isDefault, false);
  });

  it('另一台电脑选同一个文件夹（合并）：拿到全部便笺', async () => {
    B = await launchApp({ seed: { notes: [note('bonly', '<div>B 自己的便笺</div>')], settings: { activeNoteId: 'bonly', bounds: { x: 600, y: 300, width: 500, height: 360 } } } });
    const r = await B.page.evaluate((d) => window.api.setDataDir(d, 'merge'), shared);
    assert.equal(r.mode, 'merge');
    await B.page.waitForFunction(() => typeof state !== 'undefined' && !!state.activeId);
    await sleep(500);
    assert.deepEqual(await ids(B.page), ['a', 'b', 'bonly']);
    // A 也会收到 B 带来的便笺
    assert.ok(await waitFor(async () => (await ids(A.page)).includes('bonly')), 'A 看到 B 的便笺');
  });

  it('一边修改、新建、删除，另一边几秒内同步；各自的窗口位置互不影响', async () => {
    await A.page.evaluate(() => switchTo('b'));
    await A.page.click('#editor'); await A.page.keyboard.press('Control+End'); await A.page.keyboard.type('（A 改的）');
    assert.ok(await waitFor(async () => (await contentOf(B.page, 'b')).includes('A 改的')), 'B 看到 A 的修改');

    const newId = await B.page.evaluate(() => {
      newNote(); el.editor.innerHTML = '<div>B 新建的</div>'; persist(); return state.activeId;
    });
    assert.ok(await waitFor(async () => (await contentOf(A.page, newId)).includes('B 新建的')), 'A 看到 B 新建的便笺');

    // B 把 bonly 删到「最近删除」再彻底删除：A 也删掉，且不会被 A 带回来
    await B.page.evaluate(() => { switchTo('bonly'); });
    await sleep(200);
    await B.page.evaluate(() => { deleteNote(); purgeNotes(['bonly']); persist(); });
    assert.ok(await waitFor(async () => !(await A.page.evaluate(() => state.notes.some(n => n.id === 'bonly')))), 'A 同步删除');
    await sleep(4500);
    assert.ok(!(await B.page.evaluate(() => state.notes.some(n => n.id === 'bonly'))), '删掉的没有被另一边带回来');

    assert.deepEqual(A.local().bounds, { x: 210, y: 150, width: 700, height: 400 }, 'A 的窗口位置没被 B 覆盖');
    assert.equal(B.local().bounds.x, 600, 'B 的窗口位置没被 A 覆盖');
  });

  it('安静下来后两边不再互相写文件（不会来回触发）', async () => {
    await sleep(3000);
    const m1 = fs.statSync(path.join(shared, 'data.json')).mtimeMs;
    await sleep(6000);
    assert.equal(fs.statSync(path.join(shared, 'data.json')).mtimeMs, m1);
  });

  it('同步软件产生的冲突副本会被合并并改名', async () => {
    const cur = JSON.parse(fs.readFileSync(path.join(shared, 'data.json'), 'utf-8'));
    cur.notes.push(note('fromconflict', '<div>冲突副本里的便笺</div>', { mtime: Date.now() }));
    fs.writeFileSync(path.join(shared, 'data (冲突副本 2026-11-09).json'), JSON.stringify(cur));
    fs.writeFileSync(path.join(shared, 'database.json'), JSON.stringify({ hello: 'world' })); // 不是便笺数据，不能碰
    assert.ok(await waitFor(async () => (await ids(A.page)).includes('fromconflict'), 15000), 'A 合并了冲突副本');
    assert.ok(await waitFor(async () => (await ids(B.page)).includes('fromconflict'), 9000), 'B 也同步到');
    const files = fs.readdirSync(shared);
    assert.ok(files.includes('data (冲突副本 2026-11-09).json.merged'));
    assert.ok(files.includes('database.json'), '无关文件原样保留');
  });

  it('改回默认位置（合并回本机目录）', async () => {
    const r = await A.page.evaluate((d) => window.api.setDataDir(d, 'merge'), A.dir);
    assert.equal(r.ok, true);
    await A.page.waitForFunction(() => typeof state !== 'undefined' && !!state.activeId);
    await sleep(500);
    assert.equal((await A.page.evaluate(() => window.api.getDataDir())).isDefault, true);
    assert.ok(!fs.existsSync(path.join(A.dir, 'location.json')));
    assert.ok((await ids(A.page)).includes('fromconflict'), '同步文件夹里的便笺合并回来了');
    assert.deepEqual(await imgWidths(A.page).catch(() => []), await imgWidths(A.page));
  });
});
