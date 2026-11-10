'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchApp, note, sleep } = require('./helpers');

describe('后台唤醒与透明窗口鼠标交互', () => {
  let t;
  const info = () => t.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('sticky'));
    return { ignoring: win.__ignoringMouse, visible: win.isVisible(), minimized: win.isMinimized(), bounds: win.getBounds() };
  });
  const cursor = (x, y) => t.app.evaluate(({ screen }, p) => {
    screen.getCursorScreenPoint = () => p;
  }, { x, y });
  const waitIgnoring = async (value) => {
    for (let i = 0; i < 30; i++) {
      if ((await info()).ignoring === value) return;
      await sleep(30);
    }
    assert.equal((await info()).ignoring, value);
  };

  before(async () => {
    t = await launchApp({ seed: {
      notes: [note('a', '<div>可选中的正文</div>')],
      settings: { activeNoteId: 'a', bounds: { x: 300, y: 200, width: 700, height: 380 } }
    } });
    await cursor(0, 0);
    await sleep(100);
    await t.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const original = win.setIgnoreMouseEvents.bind(win);
      win.setIgnoreMouseEvents = (ignore, options) => {
        win.__ignoringMouse = ignore;
        original(ignore, options);
      };
      win.setIgnoreMouseEvents(true, { forward: true });
    });
    // 捕获真实注册的回调，不依赖测试机器能否模拟全局按键。
    await t.app.evaluate(({ globalShortcut }) => {
      const register = globalShortcut.register.bind(globalShortcut);
      globalShortcut.register = (acc, handler) => {
        globalThis.__toggleWindow = handler;
        return register(acc, handler);
      };
    });
    await t.page.evaluate(async () => window.api.registerHotkey((await window.api.getHotkey()).acc));
  });
  after(async () => {
    if (t) {
      await t.close();
      assert.deepEqual(t.errors, []);
    }
  });

  it('下层浏览器没有转发 mousemove 时，进入正文仍会关闭穿透，移出后恢复穿透', async () => {
    await cursor(450, 350);
    await waitIgnoring(false);
    await cursor(301, 201); // 窗口内、卡片外的透明阴影边距
    await waitIgnoring(true);
    await cursor(450, 350);
    await waitIgnoring(false);
  });

  it('选中文字时拖出卡片仍保留鼠标交互，松开后恢复透明边距穿透', async () => {
    await cursor(450, 350);
    await t.page.dispatchEvent('#editor', 'pointerdown', { pointerId: 1, button: 0 });
    await cursor(301, 201);
    await waitIgnoring(false);
    await t.page.dispatchEvent('#editor', 'pointerup', { pointerId: 1, button: 0 });
    await waitIgnoring(true);
  });

  it('可见但在后台的窗口，一次唤醒就到前台；前台再次触发才隐藏', async () => {
    await t.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.showInactive();
      win.isFocused = () => false;
    });
    await t.app.evaluate(() => globalThis.__toggleWindow());
    assert.equal((await info()).visible, true, '第一次唤醒不能先隐藏后台便笺');
    await t.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].isFocused = () => true; });
    await t.app.evaluate(() => globalThis.__toggleWindow());
    assert.equal((await info()).visible, false);
    await t.app.evaluate(() => globalThis.__toggleWindow());
    assert.equal((await info()).visible, true);
    await t.app.evaluate(({ BrowserWindow }) => { delete BrowserWindow.getAllWindows()[0].isFocused; });
  });

  it('最小化后一次唤醒即恢复', async () => {
    await t.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].minimize(); });
    await sleep(150);
    await t.app.evaluate(() => globalThis.__toggleWindow());
    assert.equal((await info()).minimized, false);
    assert.equal((await info()).visible, true);
  });

  it('贴边展开后鼠标不移动，也能直接选中正文', async () => {
    const wa = await t.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    await cursor(wa.x + 800, wa.y + 700);
    await t.app.evaluate(({ BrowserWindow }, wa) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.isFocused = () => false;
      win.setBounds({ x: wa.x - 14, y: wa.y + 200, width: 700, height: 380 });
    }, wa);
    await sleep(600);
    await t.page.evaluate(() => window.api.dragEnd());
    await t.page.waitForFunction(() => document.body.classList.contains('collapsed'));
    const strip = (await info()).bounds;
    await cursor(strip.x + 5, strip.y + 20);
    await t.page.waitForFunction(() => !document.body.classList.contains('collapsed'));
    await waitIgnoring(false);
    // 再次收起后用唤醒回调展开，同样不依赖鼠标移动事件。
    await cursor(wa.x + 800, wa.y + 700);
    await t.page.waitForFunction(() => document.body.classList.contains('collapsed'));
    await cursor(wa.x + 100, wa.y + 300);
    await t.app.evaluate(() => globalThis.__toggleWindow());
    await t.page.waitForFunction(() => !document.body.classList.contains('collapsed'));
    await waitIgnoring(false);
  });
});

describe('托盘唤醒与菜单显隐', () => {
  let t;
  const visible = () => t.app.evaluate(() => globalThis.__trayNoteWindows.map(w => w.isVisible()));
  const toggleFromMenu = () => t.app.evaluate(() => {
    globalThis.__trayMenu.items.find(item => item.label === '显示 / 隐藏便签').click();
  });

  before(async () => {
    t = await launchApp({ seed: {
      notes: [note('a', '<div>便笺本</div>'), note('b', '<div>桌面便笺</div>')],
      settings: { activeNoteId: 'a', stickies: { b: { x: 900, y: 150, width: 340, height: 280, onTop: true } } }
    } });
    await t.app.evaluate(({ BrowserWindow, Tray }) => {
      globalThis.__trayNoteWindows = BrowserWindow.getAllWindows();
      globalThis.__trayMain = globalThis.__trayNoteWindows.find(w => !w.webContents.getURL().includes('sticky'));
      const setContextMenu = Tray.prototype.setContextMenu;
      Tray.prototype.setContextMenu = function (menu) {
        globalThis.__trayMenu = menu;
        globalThis.__tray = this;
        return setContextMenu.call(this, menu);
      };
    });
    // 更新快捷键会重建真实托盘菜单，捕获其处理函数，避免依赖系统托盘的位置。
    const changed = await t.page.evaluate(() => window.api.setHotkey('toggle', 'CommandOrControl+Alt+Shift+F8'));
    assert.equal(changed.ok, true);
  });
  after(async () => {
    if (t) {
      await t.close();
      assert.deepEqual(t.errors, []);
    }
  });

  it('窗口已显示但因打开托盘失焦，菜单仍能隐藏所有便笺', async () => {
    await t.app.evaluate(() => { globalThis.__trayMain.isFocused = () => false; });
    await toggleFromMenu();
    assert.deepEqual(await visible(), [false, false]);
  });

  it('隐藏后再次点击菜单，显示便笺本和桌面便笺', async () => {
    await toggleFromMenu();
    assert.deepEqual(await visible(), [true, true]);
  });

  it('单击托盘始终唤起，不会因窗口原本有焦点而隐藏', async () => {
    await t.app.evaluate(() => {
      globalThis.__trayMain.isFocused = () => true;
      globalThis.__tray.emit('click');
    });
    assert.deepEqual(await visible(), [true, true]);
    await t.app.evaluate(() => {
      globalThis.__trayNoteWindows.forEach(w => w.hide());
      globalThis.__tray.emit('click');
    });
    assert.deepEqual(await visible(), [true, true]);
  });

  it('菜单在便笺本最小化时恢复窗口', async () => {
    await t.app.evaluate(() => globalThis.__trayMain.minimize());
    await sleep(150);
    await toggleFromMenu();
    assert.equal(await t.app.evaluate(() => globalThis.__trayMain.isMinimized()), false);
    assert.deepEqual(await visible(), [true, true]);
  });
});
