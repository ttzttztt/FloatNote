'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, note, sleep } = require('./helpers');

const todo = (body = '&nbsp;', attrs = '') => `<div class="todo"${attrs}><input type="checkbox">${body}</div>`;
const paragraph = '上下方向键应按屏幕上实际显示的文字行移动，空待办也能正常进入，换行后不应突然跳到行尾。'.repeat(5);

describe('待办行上下方向键', () => {
  let t;
  before(async () => {
    t = await launchApp({ seed: { notes: [note('a')], settings: { activeNoteId: 'a', fontSize: 16,
      bounds: { x: 300, y: 200, width: 560, height: 400 } } } });
  });
  after(async () => { if (t) { await t.close(); assert.deepEqual(t.errors, []); } });

  const setup = (html, index) => t.page.evaluate(({ html, index }) => {
    el.editor.innerHTML = html;
    normalizeTodoLines();
    el.editor.focus();
    caretAfterCheckbox(el.editor.children[index]);
    el.editor.scrollTop = 0;
    Undo.record();
  }, { html, index });
  const position = () => t.page.evaluate(() => {
    const s = getSelection();
    const r = document.createRange();
    r.setStart(s.focusNode, s.focusOffset); r.collapse(true);
    const b = r.getBoundingClientRect();
    return { line: [...el.editor.children].indexOf(lineOf(s.focusNode)), x: b.x, y: b.y, height: b.height };
  });
  const press = async key => { await t.page.keyboard.press(key); await sleep(30); return position(); };

  it('截图场景：从多行待办开头按 ↑，进入第一条空待办并能直接输入', async () => {
    await setup(todo() + todo('&nbsp;' + paragraph), 1);
    assert.equal((await press('ArrowUp')).line, 0);
    for (let i = 0; i < 3; i++) assert.equal((await press('ArrowUp')).line, 0);
    await t.page.keyboard.type('first');
    assert.equal(await t.page.locator('#editor > .todo').first().textContent(), '\u00a0first');
    assert.equal(await t.page.locator('#editor > .todo').nth(1).textContent(), '\u00a0' + paragraph);
  });

  it('连续空待办（含 br 占位）可以逐条上移、下移，内容不变', async () => {
    const html = todo() + todo('&nbsp;<br>') + todo('<br>') + todo('&nbsp;' + paragraph);
    await setup(html, 3);
    const before = await t.html();
    for (const line of [2, 1, 0]) assert.equal((await press('ArrowUp')).line, line);
    for (const line of [1, 2, 3]) assert.equal((await press('ArrowDown')).line, line);
    assert.equal(await t.html(), before);
  });

  it('自动换行按可视行逐行移动，保留横向列位置，返回空待办后也不跳到行尾', async () => {
    const html = todo() + todo('&nbsp;' + paragraph);
    await setup(html, 1);
    const before = await t.html();
    let last = await position();
    const column = last.x;
    for (let i = 0; i < 3; i++) {
      const next = await press('ArrowDown');
      assert.equal(next.line, 1);
      assert.ok(next.y > last.y + 5, '↓ 必须移动到下一条可视行');
      assert.ok(Math.abs(next.x - column) <= 17, '光标应保留所在列');
      last = next;
    }
    for (let i = 0; i < 3; i++) {
      const next = await press('ArrowUp');
      assert.ok(next.y < last.y - 5, '↑ 必须移动到上一条可视行');
      assert.ok(Math.abs(next.x - column) <= 17);
      last = next;
    }
    assert.equal((await press('ArrowUp')).line, 0);
    const firstRow = await press('ArrowDown');
    const secondRow = await press('ArrowDown');
    assert.ok(secondRow.y > firstRow.y + 5);
    assert.ok(Math.abs(secondRow.x - column) <= 17);
    assert.equal(await t.html(), before);
  });

  it('缩进待办、行内格式和普通段落之间可以连续移动', async () => {
    const rich = '&nbsp;<strong>加粗文字</strong><em> italic text </em>' + paragraph;
    const html = '<div>开头段落</div>' + todo(rich) + todo('&nbsp;', ' data-indent="1"') + '<div>结尾段落</div>';
    await setup(html, 2);
    const before = await t.html();
    const up = await press('ArrowUp');
    assert.equal(up.line, 1);
    for (let i = 0; i < 30 && (await position()).line !== 0; i++) await press('ArrowUp');
    assert.equal((await position()).line, 0);
    assert.equal((await press('ArrowDown')).line, 1);
    assert.equal(await t.html(), before);
  });

  it('Shift+↑ 保留扩展选区，组合键导航不被当成普通光标移动', async () => {
    await setup(todo() + todo('&nbsp;' + paragraph), 1);
    await t.page.evaluate(() => setCaret(el.editor.children[1].querySelector('.todo-text').firstChild, 65));
    const anchor = await t.page.evaluate(() => getSelection().anchorOffset);
    await press('Shift+ArrowUp');
    assert.equal(await t.page.evaluate(() => getSelection().isCollapsed), false);
    assert.equal(await t.page.evaluate(() => getSelection().anchorOffset), anchor);
    assert.ok((await t.page.evaluate(() => getSelection().toString())).length > 0);
  });

  it('左右键或鼠标重新定位后，上下键使用新的横向位置', async () => {
    await setup(todo() + todo('&nbsp;' + paragraph), 1);
    await press('ArrowDown');
    for (let i = 0; i < 5; i++) await press('ArrowRight');
    const moved = await position();
    const down = await press('ArrowDown');
    assert.ok(down.y > moved.y + 5);
    assert.ok(Math.abs(down.x - moved.x) <= 17);
    const point = await t.page.evaluate(() => {
      const node = el.editor.children[1].querySelector('.todo-text').firstChild;
      const r = document.createRange(); r.setStart(node, 8); r.setEnd(node, 9);
      const b = r.getBoundingClientRect();
      return { x: b.left + 1, y: b.top + b.height / 2 };
    });
    await t.page.mouse.click(point.x, point.y);
    const clicked = await position();
    const next = await press('ArrowDown');
    assert.ok(next.y > clicked.y + 5);
    assert.ok(Math.abs(next.x - clicked.x) <= 17);
  });

  it('长待办连续上移时自动滚动，让光标留在编辑器可视区域', async () => {
    await setup(todo() + todo('&nbsp;' + paragraph.repeat(10)), 1);
    await t.page.evaluate(() => {
      caretLineEnd(el.editor.children[1]);
      el.editor.scrollTop = el.editor.scrollHeight;
    });
    const oldScroll = await t.page.evaluate(() => el.editor.scrollTop);
    for (let i = 0; i < 15; i++) {
      const p = await press('ArrowUp');
      const box = await t.page.locator('#editor').boundingBox();
      assert.ok(p.y >= box.y - 1 && p.y + p.height <= box.y + box.height + 1, '光标应保持可见');
    }
    assert.ok(await t.page.evaluate(() => el.editor.scrollTop) < oldScroll);
  });
});
