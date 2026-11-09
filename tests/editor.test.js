'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { launchApp, note, sleep } = require('./helpers');

describe('编辑器', () => {
  let t;
  before(async () => {
    t = await launchApp({ seed: { notes: [note('a')], settings: { activeNoteId: 'a' } } });
  });
  after(async () => {
    await t.close(); // 先关闭再断言：断言失败时应用也不会一直开着，测试进程能正常结束
    assert.deepEqual(t.errors, []);
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

  it('粘贴的大图自动压缩成 WebP，长边不超过 1920；GIF 原样保存', async () => {
    await reset();
    const r = await t.page.evaluate(async () => {
      // 仿一张 4K 截图：渐变背景 + 大量文字 + 色块
      const c = document.createElement('canvas');
      c.width = 3840; c.height = 2160;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 3840, 2160);
      grad.addColorStop(0, '#e8eefc'); grad.addColorStop(1, '#fff6e0');
      g.fillStyle = grad; g.fillRect(0, 0, 3840, 2160);
      g.fillStyle = '#333'; g.font = '28px sans-serif';
      for (let y = 40; y < 2160; y += 40) g.fillText('FloatNote 截图测试 The quick brown fox jumps over the lazy dog 0123456789 '.repeat(3), 20, y);
      for (let i = 0; i < 60; i++) { g.fillStyle = `hsl(${i * 6},70%,60%)`; g.fillRect((i * 61) % 3700, (i * 97) % 2000, 120, 80); }
      const png = c.toDataURL('image/png');
      await insertImage(png);
      const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
      await insertImage(gif);
      const imgs = [...el.editor.querySelectorAll('img')];
      await Promise.all(imgs.map(i => i.decode().catch(() => {})));
      return { pngBytes: Math.floor((png.length - 22) * 3 / 4), srcs: imgs.map(i => i.getAttribute('src')), w: imgs[0].naturalWidth, h: imgs[0].naturalHeight };
    });
    assert.equal(r.srcs.length, 2);
    assert.match(r.srcs[0], /\.webp$/, '按粘贴顺序排列：先大图');
    assert.match(r.srcs[1], /\.gif$/, '再 GIF');
    await t.page.keyboard.type('图后文字');
    assert.match(await t.html(), /\.gif">(<br>)?图后文字/, '接着打字出现在图片后面');
    const dir = path.join(t.dir, 'images', 'a');
    const files = fs.readdirSync(dir);
    const webp = files.find(f => f.endsWith('.webp'));
    assert.ok(webp, '保存成 WebP：' + files.join(','));
    assert.ok(files.some(f => f.endsWith('.gif')), 'GIF 原样保存');
    assert.equal(Math.max(r.w, r.h), 1920, '长边缩到 1920');
    assert.equal(r.w / r.h, 16 / 9, '保持比例');
    const saved = fs.statSync(path.join(dir, webp)).size;
    assert.ok(saved < r.pngBytes / 3, `体积明显变小：原图 ${r.pngBytes} → ${saved} 字节`);
    console.log(`    图片压缩：${(r.pngBytes / 1048576).toFixed(2)}MB → ${(saved / 1024).toFixed(0)}KB`);
  });

  it('待办行：点行尾空白处打字在行尾，Home 键不会跑到复选框前面，点文字中间和复选框照常', async () => {
    const content = '<div class="todo"><input type="checkbox">&nbsp;品牌同步</div><div class="todo" data-indent="1"><input type="checkbox">&nbsp;缩进的待办</div>';
    const setup = () => t.page.evaluate((c) => { el.editor.innerHTML = c; }, content);
    const box = async (i) => t.page.locator('#editor > .todo').nth(i).boundingBox();
    // 行尾右侧空白处：光标直接出现在行尾，中途从不出现在复选框前面（否则会看到光标从头跳到尾）
    for (const i of [0, 1]) {
      await setup();
      await t.page.evaluate(() => {
        window.__caretLog = [];
        document.addEventListener('selectionchange', () => {
          const s = getSelection();
          if (!s.rangeCount) return;
          const line = (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement).closest('.todo');
          if (line) window.__caretLog.push(caretBeforeCheckbox(line) ? 'before' : 'ok');
        });
      });
      const b = await box(i);
      await t.page.mouse.click(b.x + b.width - 20, b.y + b.height / 2);
      await sleep(50);
      assert.ok(!(await t.page.evaluate(() => window.__caretLog)).includes('before'), '光标没有先跑到复选框前面');
      await t.page.keyboard.type('X');
      assert.match(await t.html(), i ? /缩进的待办X<\/div>/ : /品牌同步X<\/div>/);
    }
    // Home 键
    await setup();
    const b0 = await box(0);
    await t.page.mouse.click(b0.x + b0.width - 20, b0.y + b0.height / 2);
    await t.page.keyboard.press('Home');
    await t.page.keyboard.type('Y');
    assert.match(await t.html(), /^<div class="todo"><input type="checkbox">&nbsp;Y品牌同步<\/div>/);
    // 点在文字中间：不挪动
    await setup();
    const word = await t.page.evaluate(() => {
      const tn = el.editor.querySelector('.todo').lastChild;
      const r = document.createRange(); r.setStart(tn, 3); r.setEnd(tn, 4);
      const rc = r.getBoundingClientRect(); return { x: rc.left + 1, y: rc.top + rc.height / 2 };
    });
    await t.page.mouse.click(word.x, word.y);
    await t.page.keyboard.type('Z');
    assert.match(await t.html(), /&nbsp;品牌Z同步|&nbsp;品Z牌同步/);
    // 复选框本身照常勾选
    await setup();
    await t.page.locator('#editor .todo input').first().click();
    assert.equal(await t.page.locator('#editor .todo input').first().isChecked(), true);
  });
});
