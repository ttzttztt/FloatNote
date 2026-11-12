'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, note, flush } = require('./helpers');
const text = '长待办的第一行和后续文字行应使用同一个左边界，加粗和粘贴的内容也能正常回车续出新待办。'.repeat(5);
const todo = body => `<div class="todo"><input type="checkbox">&nbsp;${body}</div>`;

describe('待办排版与回车', () => {
  let t;
  before(async () => {
    t = await launchApp({ seed: { notes: [note('a', todo(text))], settings: { activeNoteId: 'a', fontSize: 16,
      bounds: { x: 300, y: 200, width: 560, height: 400 } } } });
  });
  after(async () => { if (t) { await t.close(); assert.deepEqual(t.errors, []); } });
  const setup = html => t.page.evaluate(html => {
    el.editor.innerHTML = html; normalizeTodoLines(); applyFontSize(16);
    el.editor.focus(); caretLineEnd(el.editor.firstElementChild); Undo.record();
  }, html);

  it('读取旧便笺时保留文字和勾选框，建立统一文字区域', async () => {
    assert.equal(await t.page.locator('#editor > .todo > .todo-text').count(), 1);
    assert.equal(await t.page.locator('#editor > .todo > .todo-text').textContent(), text);
    assert.equal(await t.page.locator('#editor input').count(), 1);
  });

  it('不同字号、缩进及行内格式的首行和折行均对齐，复选框与首行居中', async () => {
    for (const size of [12, 16, 22]) {
      for (const body of [text, `<strong>加粗文字</strong><em> italic </em>${text}`, `<p>${text}</p>`]) {
        await setup(todo(body));
        await t.page.evaluate(size => { applyFontSize(size); setIndent(el.editor.firstElementChild, 1); el.editor.scrollTop = 0; }, size);
        const rows = await t.page.evaluate(() => {
          const line = el.editor.firstElementChild, body = todoContent(line), boxes = [];
          const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            for (let i = 0; i < node.length; i++) {
              if (/\s/.test(node.data[i])) continue;
              const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1);
              const b = r.getBoundingClientRect();
              if (!boxes.length || Math.abs(boxes[boxes.length - 1].top - b.top) > 5) boxes.push({ left: b.left, top: b.top, height: b.height });
            }
          }
          const cb = lineCheckbox(line).getBoundingClientRect();
          return { boxes, checkboxCenter: cb.top + cb.height / 2 };
        });
        assert.ok(rows.boxes.length >= 2);
        for (const row of rows.boxes) assert.ok(Math.abs(row.left - rows.boxes[0].left) < 1, '首行和折行应对齐');
        assert.ok(Math.abs(rows.checkboxCenter - rows.boxes[0].top - rows.boxes[0].height / 2) < 3);
      }
    }
  });

  it('普通、加粗及内层段落的行末回车，均续出独立的新待办', async () => {
    for (const body of [text, `<strong>${text}</strong>`, `<div>${text}</div>`, `<p><em>${text}</em></p>`]) {
      for (const boundary of [false, true]) {
        await setup(todo(body));
        if (boundary) await t.page.evaluate(() => focusEditorEnd());
        await t.page.keyboard.press('Enter');
        assert.equal(await t.page.locator('#editor > .todo').count(), 2);
        assert.equal(await t.page.locator('#editor > .todo > .todo-text').first().textContent(), text);
        assert.equal(await t.page.locator('#editor > .todo > .todo-text').nth(1).textContent(), '');
        await t.page.keyboard.type('next');
        assert.equal(await t.page.locator('#editor > .todo > .todo-text').nth(1).textContent(), 'next');
        assert.equal(await t.page.locator('#editor .todo .todo').count(), 0);
      }
    }
  });

  it('回车前仍会把末尾网址转换成链接，并续建未勾选的待办', async () => {
    await setup(todo('https://example.com'));
    await t.page.keyboard.press('Enter');
    assert.equal(await t.page.locator('#editor > .todo').count(), 2);
    assert.equal(await t.page.locator('#editor > .todo').first().locator('a').getAttribute('href'), 'https://example.com');
    assert.equal(await t.page.locator('#editor > .todo').first().locator('.todo-text').textContent(), 'https://example.com');
    assert.equal(await t.page.locator('#editor input').nth(1).isChecked(), false);
  });

  it('富文本中间回车拆分尾部，保留格式和缩进，新待办未勾选；可撤销和重做', async () => {
    await setup('<div class="todo" data-indent="2"><input type="checkbox" checked>&nbsp;<strong>abcd</strong><em>efgh</em></div>');
    await t.page.evaluate(() => { setCaret(el.editor.querySelector('strong').firstChild, 2); Undo.record(); });
    const original = await t.html();
    await t.page.keyboard.press('Enter');
    assert.deepEqual(await t.page.$$eval('#editor > .todo > .todo-text', ns => ns.map(n => n.textContent)), ['ab', 'cdefgh']);
    assert.equal(await t.page.locator('#editor > .todo').nth(1).getAttribute('data-indent'), '2');
    assert.equal(await t.page.locator('#editor input').first().isChecked(), true);
    assert.equal(await t.page.locator('#editor input').nth(1).isChecked(), false);
    assert.equal(await t.page.locator('#editor > .todo').nth(1).locator('strong').textContent(), 'cd');
    assert.equal(await t.page.locator('#editor > .todo').nth(1).locator('em').textContent(), 'efgh');
    await t.page.keyboard.press('Control+z');
    assert.equal(await t.html(), original);
    await t.page.keyboard.press('Control+y');
    assert.equal(await t.page.locator('#editor > .todo').count(), 2);
  });

  it('同一待办中的选中文字可被换行替换，前后文字不丢失', async () => {
    await setup(todo('<strong>abcd</strong><em>efgh</em>'));
    await t.page.evaluate(() => {
      const r = document.createRange();
      r.setStart(el.editor.querySelector('strong').firstChild, 1);
      r.setEnd(el.editor.querySelector('em').firstChild, 2);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await t.page.keyboard.press('Enter');
    assert.deepEqual(await t.page.$$eval('#editor > .todo > .todo-text', ns => ns.map(n => n.textContent)), ['a', 'gh']);
  });

  it('Delete 合并下一条待办时，文字仍留在同一个文字区域，可以撤销恢复', async () => {
    await setup(todo('abc') + todo('<strong>def</strong>'));
    await t.page.evaluate(() => { caretLineEnd(el.editor.firstElementChild); Undo.record(); });
    const original = await t.html();
    await t.page.keyboard.press('Delete');
    assert.equal(await t.page.locator('#editor > .todo').count(), 1);
    assert.equal(await t.page.locator('#editor > .todo > .todo-text').textContent(), 'abcdef');
    assert.equal(await t.page.locator('#editor > .todo > .todo-text strong').textContent(), 'def');
    await t.page.keyboard.press('Control+z');
    assert.equal(await t.html(), original);
  });

  it('空待办回车退出；Shift+回车只换行，不添加复选框', async () => {
    await setup(todo('abc'));
    await t.page.keyboard.press('Shift+Enter'); await t.page.keyboard.type('def');
    assert.equal(await t.page.locator('#editor input').count(), 1);
    assert.equal(await t.page.locator('#editor .todo-text').textContent(), 'abcdef');
    assert.ok(await t.page.locator('#editor .todo-text br').count() > 0);
    await t.page.keyboard.press('Enter'); await t.page.keyboard.press('Enter');
    assert.equal(await t.page.locator('#editor input').count(), 1);
    assert.equal(await t.page.locator('#editor > :last-child').getAttribute('class'), null);
  });

  it('输入法确认键不续建待办，直接的段落输入事件可以续建', async () => {
    await setup(todo(text));
    const composing = await t.page.evaluate(() => {
      const e = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
      el.editor.dispatchEvent(e); return e.defaultPrevented;
    });
    assert.equal(composing, false);
    assert.equal(await t.page.locator('#editor input').count(), 1);
    const prevented = await t.page.evaluate(() => {
      const e = new InputEvent('beforeinput', { inputType: 'insertParagraph', bubbles: true, cancelable: true });
      el.editor.dispatchEvent(e); return e.defaultPrevented;
    });
    assert.equal(prevented, true);
    assert.equal(await t.page.locator('#editor > .todo').count(), 2);
  });

  it('保存并刷新后文字区域不重复嵌套，内容、勾选状态和回车行为保持', async () => {
    await setup('<div class="todo"><input type="checkbox" checked>&nbsp;<strong>saved</strong></div>');
    await t.page.evaluate(() => persist()); await flush();
    for (let i = 0; i < 2; i++) {
      await t.page.reload();
      await t.page.waitForFunction(() => typeof state !== 'undefined' && state.activeId === 'a');
      assert.equal(await t.page.locator('#editor .todo-text').count(), 1);
      assert.equal(await t.page.locator('#editor .todo-text').textContent(), 'saved');
      assert.equal(await t.page.locator('#editor input').isChecked(), true);
    }
    await t.page.evaluate(() => { el.editor.focus(); caretLineEnd(el.editor.firstElementChild); });
    await t.page.keyboard.press('Enter');
    assert.equal(await t.page.locator('#editor > .todo').count(), 2);
  });
});
