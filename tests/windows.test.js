'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, note, sleep, flush } = require('./helpers');

/* 贴边收起由主进程轮询光标位置决定；测试里替换掉读光标和焦点的函数，任何系统上都能跑 */
const setCursor = (app, x, y) => app.evaluate(({ screen }, p) => { globalThis.__cursor = p; screen.getCursorScreenPoint = () => globalThis.__cursor; }, { x, y });
const notFocused = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => { w.isFocused = () => false; }));
const winInfo = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ sticky: w.webContents.getURL().includes('sticky'), b: w.getBounds(), top: w.isAlwaysOnTop() })));
const mainBounds = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('sticky')).getBounds());

describe('桌面便笺与贴边收起', () => {
  let t;
  let dir;
  before(async () => {
    t = await launchApp({
      seed: {
        notes: [note('a', '<div>主便笺</div>'), note('b', '<div>要贴到桌面的</div>')],
        settings: { activeNoteId: 'b', bounds: { x: 300, y: 200, width: 700, height: 380 } }
      }
    });
    dir = t.dir;
  });
  after(async () => {
    await t.close(); // 先关闭再断言：断言失败时应用也不会一直开着，测试进程能正常结束
    assert.deepEqual(t.errors, []);
  });

  it('贴到桌面：独立窗口，内容双向同步，放回便笺本', async () => {
    const [sticky] = await Promise.all([t.app.waitForEvent('window'), t.page.evaluate(() => stickNote('b', 1000, 150))]);
    await sticky.waitForFunction(() => typeof state !== 'undefined' && state.activeId === 'b');
    assert.equal(new URL(sticky.url()).searchParams.get('mode'), 'sticky');
    assert.equal(await t.page.textContent('#note-title'), '主便笺', '便笺本换到另一张');
    await sticky.click('#editor');
    await sticky.keyboard.press('Control+End');
    await sticky.keyboard.type('（桌面上写的）');
    await flush();
    assert.ok(await t.page.evaluate(() => state.notes.find(n => n.id === 'b').content.includes('桌面上写的')));
    await t.page.click('#note-switcher');
    assert.match(await t.page.textContent('.menu-item.stuck'), /桌面/);
    await t.page.keyboard.press('Escape');
    // 位置大小改一下，看重启后能否恢复
    await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('sticky')).setBounds({ x: 1100, y: 300, width: 300, height: 240 }));
    await sleep(900);
  });

  it('重启后桌面便笺回到原位', async () => {
    await t.close();
    t = await launchApp({ dir });
    await sleep(1200);
    const wins = await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ sticky: w.webContents.getURL().includes('sticky'), b: w.getBounds() })));
    const s = wins.find(w => w.sticky);
    assert.ok(s, '桌面便笺被恢复');
    assert.deepEqual(s.b, { x: 1100, y: 300, width: 300, height: 240 });
    const sticky = t.app.windows().find(w => w.url().includes('sticky'));
    await sticky.evaluate(() => document.getElementById('btn-close').click()).catch(() => {});
    await sleep(800);
    assert.equal(t.app.windows().length, 1);
    assert.match(await t.page.textContent('#note-title'), /^要贴到桌面的/, '放回后在便笺本里打开');
  });

  it('贴边：吸附、移开收成细边、碰到展开、拖离取消', async () => {
    await t.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.isFocused = () => false; // 模拟用户已经切到别的程序
      w.setBounds({ x: -20, y: 200, width: 700, height: 380 });
    });
    await setCursor(t.app, 300, 300);
    await sleep(600);
    await t.page.evaluate(() => window.api.dragEnd());
    await sleep(200);
    assert.ok(await t.page.evaluate(() => document.body.classList.contains('docked')));
    const wa = await t.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    assert.equal((await mainBounds(t.app)).x, wa.x - 14, '卡片正好贴住屏幕左边');
    await setCursor(t.app, wa.x + 1200, wa.y + 600);
    await sleep(900);
    const strip = await mainBounds(t.app);
    assert.ok(await t.page.evaluate(() => document.body.classList.contains('collapsed')));
    assert.equal(strip.width, 26);
    await setCursor(t.app, strip.x + 5, strip.y + 20);
    await sleep(500);
    assert.equal((await mainBounds(t.app)).width, 700, '鼠标碰到细边就展开');
    await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 300, y: 200, width: 700, height: 380 }));
    await sleep(600);
    await t.page.evaluate(() => window.api.dragEnd());
    await sleep(200);
    assert.ok(!(await t.page.evaluate(() => document.body.classList.contains('docked'))));
  });

  it('贴边期间强制置顶（细边不被其他窗口盖住），取消后恢复用户设置', async () => {
    await t.page.evaluate(async () => { state.settings.alwaysOnTop = false; await window.api.setAlwaysOnTop(false); });
    let main = (await winInfo(t.app)).find(w => !w.sticky);
    assert.equal(main.top, false);
    const wa = await t.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    await setCursor(t.app, wa.x + wa.width - 300, 350); // 鼠标停在窗口上，避免贴边后被自动收起
    await t.app.evaluate(({ BrowserWindow }, x) => BrowserWindow.getAllWindows()[0].setBounds({ x, y: 200, width: 700, height: 380 }), wa.x + wa.width - 690);
    await sleep(600);
    await t.page.evaluate(() => window.api.dragEnd());
    await sleep(200);
    main = (await winInfo(t.app)).find(w => !w.sticky);
    assert.equal(main.top, true, '贴边后强制置顶');
    await setCursor(t.app, 600, 350);
    await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 300, y: 200, width: 700, height: 380 }));
    await sleep(600);
    await t.page.evaluate(() => window.api.dragEnd());
    await sleep(200);
    main = (await winInfo(t.app)).find(w => !w.sticky);
    assert.ok(!(await t.page.evaluate(() => document.body.classList.contains('docked'))));
    assert.equal(main.top, false, '取消贴边后恢复为不置顶');
  });

  it('桌面便笺也能贴边；同一条边上的多条细边不重叠，重启后保持收起', async () => {
    const wa = await t.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    const right = wa.x + wa.width;
    // 便笺本贴到右边并收起
    await t.app.evaluate(({ BrowserWindow }, x) => BrowserWindow.getAllWindows()[0].setBounds({ x, y: 200, width: 700, height: 380 }), right - 690);
    await sleep(600);
    await t.page.evaluate(() => window.api.dragEnd());
    // 贴一张桌面便笺，也放到右边、同样的高度
    const [sticky] = await Promise.all([t.app.waitForEvent('window'), t.page.evaluate(() => stickNote(state.activeId, 900, 300))]);
    await sticky.waitForFunction(() => typeof state !== 'undefined' && !!state.activeId);
    await sleep(400);
    await t.app.evaluate(({ BrowserWindow }, x) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('sticky')).setBounds({ x, y: 200, width: 340, height: 280 }), right - 330);
    await sleep(600);
    await sticky.evaluate(() => window.api.dragEnd());
    await sleep(200);
    assert.ok(await sticky.evaluate(() => document.body.classList.contains('docked')), '桌面便笺进入贴边');
    await notFocused(t.app);
    await setCursor(t.app, wa.x + 300, wa.y + 300);
    await sleep(900);
    const ws = await winInfo(t.app);
    const m = ws.find(w => !w.sticky).b;
    const st = ws.find(w => w.sticky).b;
    assert.equal(m.width, 26); assert.equal(st.width, 26, '两条都收成了细边');
    assert.equal(m.x, right - 26); assert.equal(st.x, right - 26);
    assert.ok(st.y >= m.y + m.height || m.y >= st.y + st.height, `两条细边不重叠：${JSON.stringify([m, st])}`);
    assert.ok(ws.every(w => w.top), '细边都在最上层');
    // 碰到桌面便笺那条，只展开它
    await setCursor(t.app, st.x + 5, st.y + 20);
    await sleep(500);
    const ws2 = await winInfo(t.app);
    assert.equal(ws2.find(w => w.sticky).b.width, 340);
    assert.equal(ws2.find(w => !w.sticky).b.width, 26);
    await setCursor(t.app, wa.x + 300, wa.y + 300);
    await sleep(900);
    // 重启后桌面便笺仍是收起状态
    await t.close();
    t = await launchApp({ dir });
    await sleep(1500);
    const ws3 = await winInfo(t.app);
    assert.equal(ws3.find(w => w.sticky).b.width, 26, '重启后桌面便笺仍收在边上');
    assert.equal(ws3.find(w => !w.sticky).b.width, 26, '重启后便笺本仍收在边上');
  });
});
