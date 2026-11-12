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

describe('窄窗口', () => {
  let t;
  before(async () => {
    t = await launchApp({ seed: { notes: [note('a', '<div>一张名字特别特别长的便笺标题用来测试省略</div>')], settings: { activeNoteId: 'a', bounds: { x: 200, y: 160, width: 320, height: 260 } } } });
  });
  after(async () => {
    await t.close();
    assert.deepEqual(t.errors, []);
  });

  it('最小宽度下工具栏按钮都在卡片里，删除收进「⋯」', async () => {
    const r = await t.page.evaluate(() => {
      const c = el.card.getBoundingClientRect();
      const out = [...document.querySelectorAll('.toolbar .tbtn, .toolbar .pill')]
        .filter(b => b.offsetParent)
        .filter(b => { const r = b.getBoundingClientRect(); return r.left < c.left || r.right > c.right; })
        .map(b => b.id);
      return { width: innerWidth, out, deleteShown: !!el.btnDelete.offsetParent };
    });
    assert.equal(r.width, 320);
    assert.deepEqual(r.out, []);
    assert.equal(r.deleteShown, false);
    await t.page.click('#btn-note-menu');
    await t.page.click('#nm-delete');
    await sleep(200);
    assert.ok(await t.page.evaluate(() => state.notes.find(n => n.id === 'a').trashed));
  });
});

describe('待办 / 列表上的退格、Delete、方向键', () => {
  let t;
  const T = (txt, c) => `<div class="todo"><input type="checkbox"${c ? ' checked="checked"' : ''}> ${txt}</div>`;
  before(async () => {
    t = await launchApp({ seed: { notes: [note('a', '')], settings: { activeNoteId: 'a' } } });
  });
  after(async () => {
    await t.close();
    assert.deepEqual(t.errors, []);
  });
  /* 设内容和光标，按键，返回带光标标记 | 的 HTML（复选框写成 [] / [x]，不换行空格写成 _） */
  const run = async (html, caret, keys) => {
    await t.page.evaluate(([html, caret]) => {
      el.editor.innerHTML = html;
      normalizeTodoLines();
      el.editor.focus();
      const [sel, idx, where] = caret;
      const node = el.editor.querySelectorAll(sel)[idx];
      if (where === 'textStart') caretAfterCheckbox(node);
      else if (where === 'end') setCaretLineEnd(node);
      else setCaret(node.firstChild && node.firstChild.nodeType === 3 ? node.firstChild : node, 0);
      Undo.record();
    }, [html, caret]);
    for (const k of keys) { await t.page.keyboard.press(k); await sleep(40); }
    return t.page.evaluate(() => {
      const mk = document.createTextNode('|');
      getSelection().getRangeAt(0).insertNode(mk);
      const copy = el.editor.cloneNode(true);
      copy.querySelectorAll('.todo > .todo-text').forEach(body => body.replaceWith(...body.childNodes));
      const h = copy.innerHTML.replace(/<input type="checkbox"( checked="checked")?>/g, (m, c) => (c ? '[x]' : '[]'))
        .replace(/&nbsp;/g, '_').replace(/ class="todo"/g, '.t');
      mk.remove();
      return h;
    });
  };

  it('待办文字开头按一次退格就去掉复选框（空的、已勾选的、Ctrl+退格都一样）', async () => {
    assert.equal(await run('<div>xyz</div>' + T('abc'), ['.todo', 0, 'textStart'], ['Backspace']), '<div>xyz</div><div>|abc</div>');
    assert.equal(await run('<div>xyz</div>' + T(''), ['.todo', 0, 'textStart'], ['Backspace']), '<div>xyz</div><div>|<br></div>');
    assert.equal(await run('<div>xyz</div>' + T('abc', 1), ['.todo', 0, 'textStart'], ['Backspace']), '<div>xyz</div><div>|abc</div>');
    assert.equal(await run('<div>xyz</div>' + T('abc'), ['.todo', 0, 'textStart'], ['Control+Backspace']), '<div>xyz</div><div>|abc</div>');
    assert.equal(await run('<div>xyz</div>' + T('ab'), ['.todo', 0, 'end'], ['Backspace', 'Backspace', 'Backspace']), '<div>xyz</div><div>|<br></div>');
  });

  it('上一行行尾按 Delete：把下一行待办的文字接过来，不留半截待办', async () => {
    assert.equal(await run('<div>xyz</div>' + T('abc'), ['div', 0, 'end'], ['Delete']), '<div>xyz|abc</div>');
    assert.equal(await run(T('abc') + T('def'), ['.todo', 0, 'end'], ['Delete']), '<div.t>[]_abc|def</div>');
    assert.equal(await run('<div><br></div>' + T('abc'), ['div', 0, 'start'], ['Delete']), '<div>|abc</div>');
  });

  it('← 在待办文字开头跳到上一行末尾；Shift+Home 不选中复选框', async () => {
    assert.equal(await run('<div>xyz</div>' + T('abc'), ['.todo', 0, 'textStart'], ['ArrowLeft', 'q']), '<div>xyzq|</div><div.t>[]_abc</div>');
    assert.equal(await run(T('abc'), ['.todo', 0, 'end'], ['Shift+Home', 'q']), '<div.t>[]_q|</div>');
  });

  it('退格后可以撤销', async () => {
    assert.equal(await run('<div>xyz</div>' + T('abc'), ['.todo', 0, 'textStart'], ['Backspace', 'Control+z']), '<div>xyz</div><div.t>[]_|abc</div>');
  });

  it('列表项开头按退格：去掉圆点 / 编号，文字留在原来那行；嵌套的先退一级', async () => {
    assert.equal(await run('<ul><li>abc</li></ul>', ['li', 0, 'start'], ['Backspace']), '<div>|abc</div>');
    assert.equal(await run('<ul><li>abc</li><li>def</li><li>ghi</li></ul>', ['li', 1, 'start'], ['Backspace']), '<ul><li>abc</li></ul><div>|def</div><ul><li>ghi</li></ul>');
    assert.equal(await run('<div>xyz</div><ol><li>abc</li></ol>', ['li', 0, 'start'], ['Backspace']), '<div>xyz</div><div>|abc</div>');
    assert.equal(await run('<ul><li>abc<ul><li>def</li></ul></li></ul>', ['li', 1, 'start'], ['Backspace']), '<ul><li>abc</li><li>|def</li></ul>');
  });

  it('Ctrl+Shift+8 / 7 切换圆点 / 编号列表', async () => {
    assert.equal(await run('<div>abc</div>', ['div', 0, 'end'], ['Control+Shift+Digit8']), '<ul><li>abc|</li></ul>');
    assert.equal(await run('<div>abc</div>', ['div', 0, 'end'], ['Control+Shift+Digit7']), '<ol><li>abc|</li></ol>');
  });

  it('设置里显示便笺实际保存的完整路径', async () => {
    await t.page.click('#btn-settings');
    assert.equal(await t.page.textContent('#sm-datadir'), t.dir);
    assert.equal(await t.page.textContent('#sm-datadir-kind'), '这台电脑的默认位置');
    await t.page.keyboard.press('Escape');
  });
});
