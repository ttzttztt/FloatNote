'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, note, sleep } = require('./helpers');

describe('编辑器', () => {
  let t;
  before(async () => {
    t = await launchApp({ seed: { notes: [note('a')], settings: { activeNoteId: 'a' } } });
  });
  after(async () => {
    assert.deepEqual(t.errors, []);
    await t.close();
  });

  const reset = async () => {
    await t.page.evaluate(() => { el.editor.innerHTML = ''; });
    await t.page.click('#editor');
  };

  it('Ctrl+Shift+T 把选中的多行转成待办，再按一次还原', async () => {
    await reset();
    for (const s of ['1', '2', '3']) { await t.page.keyboard.type(s); await t.page.keyboard.press('Enter'); }
    await t.page.keyboard.press('Backspace');
    await t.page.keyboard.press('Control+A');
    await t.page.keyboard.press('Control+Shift+T');
    assert.equal(await t.page.locator('#editor .todo input').count(), 3);
    assert.match(await t.html(), /&nbsp;1<\/div>.*&nbsp;2<\/div>.*&nbsp;3<\/div>/);
    await t.page.keyboard.press('Control+Shift+T');
    assert.equal(await t.html(), '<div>1</div><div>2</div><div>3</div>');
  });

  it('待办行回车续出新待办，空待办回车退出', async () => {
    await reset();
    await t.page.keyboard.press('Control+Shift+T');
    await t.page.keyboard.type('a');
    await t.page.keyboard.press('Enter');
    assert.equal(await t.page.locator('#editor .todo input').count(), 2);
    await t.page.keyboard.press('Enter');
    assert.equal(await t.page.locator('#editor .todo input').count(), 1);
  });

  it('Markdown 快捷输入：[] / - / 1. / #', async () => {
    await reset();
    for (const s of ['# 标题', '- 列表', '', '1. 第一', '', '[] 待办']) {
      await t.page.keyboard.type(s);
      await t.page.keyboard.press('Enter');
    }
    const h = await t.html();
    assert.match(h, /<h2>标题<\/h2>/);
    assert.match(h, /<ul><li>列表<\/li><\/ul>/);
    assert.match(h, /<ol><li>第一<\/li><\/ol>/);
    assert.match(h, /class="todo"><input type="checkbox">&nbsp;待办/);
  });

  it('Tab / Shift+Tab 缩进，行首退格取消缩进，回车保持缩进', async () => {
    await reset();
    await t.page.keyboard.type('项目'); await t.page.keyboard.press('Enter'); await t.page.keyboard.type('前端');
    await t.page.keyboard.press('Tab');
    await t.page.keyboard.press('Tab');
    assert.match(await t.html(), /data-indent="2">前端/);
    await t.page.keyboard.press('Shift+Tab');
    assert.match(await t.html(), /data-indent="1">前端/);
    await t.page.keyboard.press('Enter'); await t.page.keyboard.type('后端');
    assert.match(await t.html(), /data-indent="1">后端/);
    await t.page.keyboard.press('Home'); await t.page.keyboard.press('Backspace');
    assert.match(await t.html(), /<div>后端<\/div>/);
    // 待办行缩进不被待办自身的边距覆盖
    await t.page.keyboard.press('Control+Shift+T'); await t.page.keyboard.press('Tab');
    const ml = await t.page.evaluate(() => getComputedStyle(document.querySelector('#editor .todo')).marginLeft);
    assert.notEqual(ml, '0px');
  });

  it('撤销 / 重做覆盖打字、待办、缩进、Markdown', async () => {
    await reset();
    await t.page.keyboard.type('第一句'); await sleep(700); await t.page.keyboard.type('第二句');
    await t.page.keyboard.press('Control+Z');
    assert.equal(await t.html(), '第一句');
    await t.page.keyboard.press('Control+Y');
    assert.equal(await t.html(), '第一句第二句');
    await t.page.keyboard.press('Control+Shift+T');
    await t.page.keyboard.press('Control+Z');
    assert.doesNotMatch(await t.html(), /checkbox/);
    await t.page.keyboard.press('Tab');
    await t.page.keyboard.press('Control+Z');
    assert.doesNotMatch(await t.html(), /data-indent/);
    await t.page.keyboard.press('Control+Shift+Z');
    assert.match(await t.html(), /data-indent/);
  });

  it('粘贴网页内容只留结构，去掉样式 / 脚本 / 远程图片 / 不安全链接', async () => {
    await reset();
    const web = '<meta charset="utf-8"><div style="color:red;font-size:28px"><h1 style="color:blue">网页标题</h1>' +
      '<p class="x" style="margin:30px">普通 <b>加粗</b> <a href="https://example.com" style="color:green">链接</a> <a href="javascript:alert(1)">坏链接</a></p>' +
      '<img src="https://x.com/a.png"><ul><li style="color:red">项目</li></ul><script>alert(1)</script></div>';
    await t.page.evaluate((h) => {
      const dt = new DataTransfer(); dt.setData('text/html', h); dt.setData('text/plain', 'x');
      el.editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, web);
    const h = await t.html();
    assert.match(h, /<h2>网页标题<\/h2>/);
    assert.match(h, /<strong>加粗<\/strong>/);
    assert.match(h, /<a href="https:\/\/example.com"[^>]*>链接<\/a>/);
    assert.match(h, /<ul><li>项目<\/li><\/ul>/);
    assert.doesNotMatch(h, /style=|class="x"|<script|<img|javascript:/);
    await t.page.keyboard.press('Control+Z');
    assert.doesNotMatch(await t.html(), /网页标题/);
  });

  it('Ctrl+Shift+V 只粘贴纯文本，网址变链接', async () => {
    await reset();
    await t.page.evaluate(() => {
      plainPasteUntil = Date.now() + 800;
      const dt = new DataTransfer(); dt.setData('text/html', '<b style="color:red">粗</b>'); dt.setData('text/plain', '第一行\nhttps://floatnote.dev');
      el.editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    const h = await t.html();
    assert.doesNotMatch(h, /<b[ >]|<strong|style=/);
    assert.match(h, /第一行<br><a href="https:\/\/floatnote.dev"/);
  });

  it('网址后敲空格自动变链接，Ctrl+单击交给系统浏览器', async () => {
    await reset();
    await t.page.keyboard.type('看看 www.example.org/a?b=1 ');
    assert.match(await t.html(), /<a href="https:\/\/www.example.org\/a\?b=1"[^>]*>www.example.org\/a\?b=1<\/a>/);
    await t.app.evaluate(({ shell }) => { globalThis.__opened = null; shell.openExternal = async (u) => { globalThis.__opened = u; return true; }; });
    const link = t.page.locator('#editor a');
    await link.click();
    assert.equal(await t.app.evaluate(() => globalThis.__opened), null, '普通单击不打开');
    await link.click({ modifiers: ['Control'] });
    await sleep(200);
    assert.equal(await t.app.evaluate(() => globalThis.__opened), 'https://www.example.org/a?b=1');
  });
});
