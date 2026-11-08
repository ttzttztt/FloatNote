'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { launchApp, seedData, note, sleep, flush } = require('./helpers');

describe('数据与备份', () => {
  let t;
  let dir;
  before(async () => {
    const os = require('os');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'floatnote-data-'));
    const img = (f) => path.join(dir, 'images', f);
    fs.mkdirSync(path.join(dir, 'images', 'a'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'images', 'gone'), { recursive: true });
    seedData(dir, {
      notes: [
        note('a', `<div>图：<img src="${pathToFileURL(img('a/keep.png')).href}"></div>`),
        note('b', '<div>第二张</div>'),
        note('old', '<div>很久以前删的</div>', { trashed: Date.now() - 40 * 86400000 })
      ],
      settings: { activeNoteId: 'a' }
    });
    const old = new Date(Date.now() - 86400000);
    for (const f of ['a/keep.png', 'a/orphan.png', 'gone/x.png']) {
      fs.writeFileSync(img(f), 'png');
      fs.utimesSync(img(f), old, old);
    }
    t = await launchApp({ dir, env: { FLOATNOTE_CLEANUP_DELAY: '1500' } });
  });
  after(async () => {
    assert.deepEqual(t.errors, []);
    await t.close();
  });

  it('只保存改动的字段，其他数据原样保留', async () => {
    await t.page.click('#editor');
    await t.page.keyboard.press('Control+End');
    await t.page.keyboard.type('新内容');
    await flush();
    const s = t.saved();
    assert.match(s.notes.find(n => n.id === 'a').content, /新内容/);
    assert.equal(s.notes.find(n => n.id === 'b').content, '<div>第二张</div>');
  });

  it('启动时清理放了 30 天以上的「最近删除」', () => {
    assert.ok(!t.saved().notes.some(n => n.id === 'old'));
  });

  it('每天自动备份', () => {
    const files = fs.readdirSync(path.join(dir, 'backups'));
    assert.equal(files.length, 1);
    assert.match(files[0], /^data-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('清理没有便笺在用的图片', async () => {
    await sleep(1200);
    assert.ok(fs.existsSync(path.join(dir, 'images/a/keep.png')));
    assert.ok(!fs.existsSync(path.join(dir, 'images/a/orphan.png')));
    assert.ok(!fs.existsSync(path.join(dir, 'images/gone')));
  });

  it('数据文件损坏时从备份恢复，损坏文件留档', async () => {
    await t.close();
    fs.writeFileSync(path.join(dir, 'data.json'), '{ 这不是 JSON');
    t = await launchApp({ dir });
    assert.deepEqual(await t.page.evaluate(() => liveNotes().map(n => n.id).sort()), ['a', 'b']);
    assert.equal(fs.readdirSync(dir).filter(f => f.startsWith('data.corrupt')).length, 1);
  });
});
