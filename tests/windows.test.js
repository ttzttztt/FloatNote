'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, note, sleep, flush } = require('./helpers');

/* 贴边收起由主进程轮询光标位置决定；测试里替换掉读光标和焦点的函数，任何系统上都能跑 */
const setCursor = (app, x, y) => app.evaluate(({ screen }, p) => { globalThis.__cursor = p; screen.getCursorScreenPoint = () => globalThis.__cursor; }, { x, y });
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
    assert.deepEqual(t.errors, []);
    await t.close();
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
});
