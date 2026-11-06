'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, note, sleep, flush } = require('./helpers');

describe('便笺管理与界面', () => {
  let t;
  before(async () => {
    t = await launchApp({
      seed: {
        notes: [
          note('a', '<h2>周五清单</h2><div class="todo"><input type="checkbox">&nbsp;整理文档</div><div class="todo"><input type="checkbox">&nbsp;对稿</div>', { tags: ['工作'], color: 'yellow', updatedAt: Date.now() - 300000 }),
          note('b', '<div>第三章：习惯</div>', { title: '读书笔记' }),
          note('c', '<div>周末计划</div>', { tags: ['生活'] }),
          note('empty1'), note('empty2')
        ],
        settings: { activeNoteId: 'a' }
      }
    });
  });
  after(async () => {
    assert.deepEqual(t.errors, []);
    await t.close();
  });

  it('启动时清理空便笺，状态栏不把格式差异当成编辑', async () => {
    const ids = await t.page.evaluate(() => liveNotes().map(n => n.id));
    assert.deepEqual(ids.sort(), ['a', 'b', 'c']);
    assert.match(await t.page.textContent('#status-bar'), /编辑于 5 分钟前/);
  });

  it('双击标题重命名，留空恢复自动标题', async () => {
    await t.page.dblclick('#note-switcher');
    await t.page.keyboard.type('项目计划');
    await t.page.keyboard.press('Enter');
    assert.equal(await t.page.textContent('#note-title'), '项目计划');
    await t.page.keyboard.press('F2');
    await t.page.keyboard.press('Control+A'); await t.page.keyboard.press('Backspace'); await t.page.keyboard.press('Enter');
    assert.equal(await t.page.textContent('#note-title'), '周五清单');
  });

  it('当前便笺为空时点新建不会再建一张', async () => {
    await t.page.click('#btn-new');
    const n = await t.page.evaluate(() => liveNotes().length);
    await t.page.click('#btn-new');
    assert.equal(await t.page.evaluate(() => liveNotes().length), n);
    await t.page.evaluate(() => switchTo('a'));
    await sleep(200);
    assert.equal(await t.page.evaluate(() => liveNotes().length), n - 1, '切走后空便笺被清理');
  });

  it('菜单搜索、置顶、拖动排序', async () => {
    await t.page.click('#note-switcher');
    await sleep(150);
    assert.equal(await t.page.evaluate(() => document.activeElement.className), 'menu-search');
    await t.page.keyboard.type('生活');
    assert.deepEqual(await t.page.$$eval('.menu-item .mi-title', e => e.map(x => x.textContent)), ['周末计划']);
    await t.page.fill('.menu-search', '');
    await t.page.hover('.menu-item:nth-child(3)');
    await t.page.click('.menu-item:nth-child(3) .mi-pin');
    assert.equal(await t.page.evaluate(() => displayOrder()[0].id), 'c');
    await t.page.dragAndDrop('.menu-item:nth-child(3)', '.menu-item:nth-child(2)', { targetPosition: { x: 20, y: 4 } });
    assert.deepEqual(await t.page.evaluate(() => displayOrder().map(n => n.id)), ['c', 'b', 'a']);
    await t.page.keyboard.press('Escape');
  });

  it('勾选迸出圆点并计数，全部完成只给提示', async () => {
    await t.page.locator('#editor .todo input').nth(0).click();
    await sleep(100);
    assert.equal(await t.page.locator('.spark').count(), 7);
    await sleep(1000);
    await t.page.locator('#editor .todo input').nth(1).click();
    await sleep(100);
    assert.equal(await t.page.locator('.spark').count(), 0);
    assert.match(await t.page.textContent('.toast'), /全部完成/);
    assert.match(await t.page.textContent('#status-bar'), /今日完成 2 件/);
  });

  it('设置：颜色、纸张、字号、外观跟随', async () => {
    const pick = async (sel) => { await t.page.click('#btn-settings'); await t.page.click(sel); await t.page.keyboard.press('Escape'); };
    await pick('#sm-swatches [data-theme=kraft]');
    await pick('#sm-paper [data-paper=fold]');
    assert.equal(await t.page.evaluate(() => document.body.dataset.theme), 'kraft');
    assert.equal(await t.page.evaluate(() => document.body.dataset.paper), 'fold');
    await t.page.click('#btn-settings');
    await t.page.$eval('#sm-font-size', e => { e.value = 18; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
    await t.page.keyboard.press('Escape');
    assert.equal(await t.page.evaluate(() => getComputedStyle(el.editor).fontSize), '18px');
    await flush();
    const s = t.saved();
    assert.equal(s.notes.find(n => n.id === 'a').paper, 'fold');
    assert.equal(s.settings.fontSize, 18);
  });

  it('删除进入「最近删除」：可撤销、恢复、彻底删除', async () => {
    await t.page.evaluate(() => switchTo('b'));
    await t.page.click('#btn-delete');
    assert.equal(await t.page.locator('.tear-sheet').count(), 1, '撕纸动画');
    await flush();
    assert.ok(t.saved().notes.find(n => n.id === 'b').trashed);
    await t.page.click('.toast-btn');
    assert.equal(await t.page.textContent('#note-title'), '读书笔记');
    await t.page.click('#btn-delete');
    await t.page.click('#note-switcher');
    assert.match(await t.page.textContent('.menu-footer'), /最近删除\s*1/);
    await t.page.click('.menu-footer');
    assert.match(await t.page.textContent('.trash-item'), /读书笔记.*还剩 30 天/);
    await t.page.click('.trash-item .mi-text-btn');
    assert.equal(await t.page.textContent('#note-title'), '读书笔记');
    await t.page.click('#btn-delete');
    await t.page.click('#note-switcher'); await t.page.click('.menu-footer');
    await t.page.hover('.trash-item'); await t.page.click('.trash-item .mi-purge');
    await flush();
    assert.ok(!t.saved().notes.some(n => n.id === 'b'));
    await t.page.keyboard.press('Escape');
  });

  it('点进空便笺有反馈，菜单切换后光标直接在正文', async () => {
    await t.page.click('#btn-new');
    const ph = () => t.page.evaluate(() => getComputedStyle(el.editor, '::before').content);
    await t.page.click('#editor');
    assert.equal(await ph(), '"开始输入…"');
    assert.ok(await t.page.evaluate(() => document.body.classList.contains('window-focused')));
    await t.page.click('#note-switcher');
    await t.page.locator('.menu-item', { hasText: '周末计划' }).click();
    assert.ok(await t.page.evaluate(() => document.activeElement === el.editor));
  });
});
