'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, note, sleep, flush } = require('./helpers');

describe('第一次打开：欢迎便笺', () => {
  let t;
  before(async () => {
    // 全新的数据目录（没有 data.json），相当于第一次安装
    t = await launchApp({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'floatnote-fresh-')) });
  });
  after(async () => {
    await t.close();
    assert.deepEqual(t.errors, []);
  });

  it('只有第一次打开时出现，带几条可勾选的上手步骤', async () => {
    assert.equal(await t.page.textContent('#note-title'), '欢迎使用 FloatNote');
    assert.equal(await t.page.locator('#editor .todo input[type=checkbox]').count(), 6);
    assert.match(await t.page.textContent('#editor'), /Ctrl\+Alt\+Space/);
    await flush();
    assert.equal(t.saved().settings.welcomed, true);
  });

  it('删掉之后不会再出现', async () => {
    await t.page.click('#btn-delete');
    await t.page.evaluate(() => purgeNotes(trashedNotes().map(n => n.id)));
    await flush();
    await t.close();
    t = await launchApp({ dir: t.dir });
    assert.equal(await t.page.textContent('#note-title'), '空便笺');
  });
});

describe('工具栏、这张便笺的菜单、快捷键', () => {
  let t;
  before(async () => {
    t = await launchApp({
      seed: {
        notes: [note('a', '<div>买牛奶</div><div>写周报</div>'), note('b', '<div>读书笔记</div>')],
        settings: { activeNoteId: 'a' }
      }
    });
  });
  after(async () => {
    await t.close();
    assert.deepEqual(t.errors, []);
  });

  it('「待办」按钮把光标所在行变成待办，再点一次还原', async () => {
    await t.page.click('#editor div:nth-child(2)');
    await t.page.click('#btn-todo');
    assert.equal(await t.page.locator('#editor .todo').count(), 1);
    assert.match(await t.page.textContent('#editor .todo'), /写周报/);
    await t.page.click('#btn-todo');
    assert.equal(await t.page.locator('#editor .todo').count(), 0);
  });

  it('「＋ 标签」：回车添加，Esc 放弃', async () => {
    await t.page.hover('#editor');
    await t.page.click('.tag-add');
    await t.page.keyboard.type('#工作');
    await t.page.keyboard.press('Enter');
    assert.deepEqual(await t.page.$$eval('#tag-bar .tag:not(.tag-add)', els => els.map(e => e.textContent)), ['#工作×']);
    await t.page.hover('#editor');
    await t.page.click('.tag-add');
    await t.page.keyboard.type('不要');
    await t.page.keyboard.press('Escape');
    assert.equal(await t.page.locator('#tag-bar .tag:not(.tag-add)').count(), 1);
  });

  it('「⋯」菜单：固定在列表最前、重命名', async () => {
    await t.page.evaluate(() => switchTo('b'));
    await t.page.click('#btn-note-menu');
    assert.equal(await t.page.textContent('#nm-pin-label'), '固定在列表最前');
    await t.page.click('#nm-pin');
    assert.equal(await t.page.evaluate(() => displayOrder()[0].id), 'b');
    await t.page.click('#btn-note-menu');
    assert.equal(await t.page.textContent('#nm-pin-label'), '取消固定');
    await t.page.click('#nm-rename');
    await t.page.keyboard.type('书单');
    await t.page.keyboard.press('Enter');
    assert.equal(await t.page.textContent('#note-title'), '书单');
    // 列表里的同一个按钮叫法一致
    await t.page.click('#note-switcher');
    assert.equal(await t.page.getAttribute('.menu-item:first-child .mi-pin', 'title'), '取消固定');
    await t.page.keyboard.press('Escape');
  });

  it('Ctrl+F 打开列表并定位到搜索框，Ctrl+N 新建', async () => {
    await t.page.click('#editor');
    await t.page.keyboard.press('Control+f');
    assert.equal(await t.page.isVisible('#switcher-menu'), true);
    assert.equal(await t.page.evaluate(() => document.activeElement.className), 'menu-search');
    await t.page.keyboard.type('周报');
    assert.equal(await t.page.locator('#switcher-menu .menu-item').count(), 1);
    await t.page.keyboard.press('Escape');
    const before = await t.page.evaluate(() => liveNotes().length);
    await t.page.click('#editor');
    await t.page.keyboard.press('Control+n');
    assert.equal(await t.page.evaluate(() => liveNotes().length), before + 1);
    assert.equal(await t.page.textContent('#note-title'), '空便笺');
  });

  it('提示条落在底部状态栏的位置，不挡正文；显示期间状态栏让位', async () => {
    await t.page.evaluate(() => switchTo('a'));
    await t.page.click('#btn-delete');
    const r = await t.page.evaluate(() => {
      const c = el.card.getBoundingClientRect();
      const b = document.querySelector('.toast').getBoundingClientRect();
      return { gap: c.bottom - b.bottom, hidden: getComputedStyle(el.statusBar).visibility === 'hidden' };
    });
    assert.ok(r.gap >= 0 && r.gap < 12, '贴着卡片底边：' + r.gap);
    assert.equal(r.hidden, true);
    await t.page.click('.toast-btn');
    assert.equal(await t.page.evaluate(() => document.body.classList.contains('has-toast')), false);
  });

  it('四边都能调整大小：拖左边时右边不动，不会小于最小尺寸', async () => {
    const bounds = () => t.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('sticky'));
      return w.getBounds();
    });
    const b0 = await bounds();
    await t.page.evaluate(() => { window.api.resizeStart(); return window.api.resizeMove('w', 60, 0); });
    await sleep(100);
    const b1 = await bounds();
    assert.equal(b1.x, b0.x + 60);
    assert.equal(b1.x + b1.width, b0.x + b0.width, '右边不动');
    await t.page.evaluate(() => { window.api.resizeStart(); return window.api.resizeMove('nw', 2000, 2000); });
    await sleep(100);
    const b2 = await bounds();
    assert.deepEqual([b2.width, b2.height], [320, 220]);
    assert.equal(b2.x + b2.width, b1.x + b1.width, '缩到最小后也不会被推着走');
    assert.equal(b2.y + b2.height, b1.y + b1.height);
    // 热区在卡片以内（落在透明边距里会被点击穿透，抓不到）
    await sleep(800); // 等上一步撤销删除时的「贴回」动画结束
    const inside = await t.page.evaluate(() => {
      const c = el.card.getBoundingClientRect();
      const bad = [...document.querySelectorAll('.rz')].map(h => {
        const r = h.getBoundingClientRect();
        return (r.left >= c.left - 0.5 && r.top >= c.top - 0.5 && r.right <= c.right + 0.5 && r.bottom <= c.bottom + 0.5) || [h.className, r, c];
      }).filter(x => x !== true);
      return bad.length ? bad : true;
    });
    assert.ok(inside === true, JSON.stringify(inside));
  });
});
