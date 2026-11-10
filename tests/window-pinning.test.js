'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchApp, note, sleep, flush } = require('./helpers');

describe('窗口置顶设置与实际窗口一致', () => {
  let t;
  const start = async (alwaysOnTop = false, sticky = false) => {
    t = await launchApp({ seed: {
      notes: [note('a', '<div>便笺本</div>'), note('b', '<div>桌面便笺</div>')],
      settings: {
        activeNoteId: 'a', alwaysOnTop, bounds: { x: 300, y: 200, width: 700, height: 380 },
        stickies: sticky ? { b: { x: 1000, y: 200, width: 340, height: 280, onTop: false } } : {}
      }
    } });
  };
  const mainTop = () => t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find(w => !w.webContents.getURL().includes('sticky')).isAlwaysOnTop());
  afterEach(async () => { if (t) await close(); });
  const close = async () => { const current = t; t = null; await current.close(); assert.deepEqual(current.errors, []); };

  it('主进程置顶接口立即同步图钉、设置面板和磁盘，不依赖页面另行保存', async () => {
    await start();
    await t.page.evaluate(() => window.api.setAlwaysOnTop(true));
    await t.page.waitForFunction(() => state.settings.alwaysOnTop === true);
    assert.equal(await mainTop(), true);
    assert.equal(await t.page.getAttribute('#btn-pin', 'aria-pressed'), 'true');
    assert.equal(await t.page.isChecked('#sm-always-on-top'), true);
    await flush();
    assert.equal(t.saved().settings.alwaysOnTop, true);
    await close();
  });

  it('从其他窗口同步置顶设置时，同时更新原生窗口', async () => {
    await start(false, true);
    const sticky = t.app.windows().find(w => w.url().includes('sticky'));
    await sticky.evaluate(() => window.api.patchData({ settings: { set: { alwaysOnTop: true } } }));
    await t.page.waitForFunction(() => state.settings.alwaysOnTop === true);
    assert.equal(await mainTop(), true);
    assert.equal(await t.page.getAttribute('#btn-pin', 'aria-pressed'), 'true');
    await sticky.evaluate(() => window.api.patchData({ settings: { set: { alwaysOnTop: false } } }));
    await t.page.waitForFunction(() => state.settings.alwaysOnTop === false);
    assert.equal(await mainTop(), false);
    await close();
  });

  it('只点击原生置顶接口后重启，仍保持置顶', async () => {
    await start();
    await t.page.evaluate(() => window.api.setAlwaysOnTop(true));
    const dir = t.dir;
    await close();
    t = await launchApp({ dir });
    assert.equal(await mainTop(), true);
    assert.equal(await t.page.getAttribute('#btn-pin', 'aria-pressed'), 'true');
    await close();
  });

  it('图钉和设置面板使用同一份置顶状态', async () => {
    await start();
    await t.page.click('#btn-pin');
    await t.page.waitForFunction(() => state.settings.alwaysOnTop === true);
    assert.equal(await mainTop(), true);
    assert.equal(await t.page.isChecked('#sm-always-on-top'), true);
    await t.page.evaluate(() => {
      el.smAlwaysOnTop.checked = false;
      el.smAlwaysOnTop.dispatchEvent(new Event('change'));
    });
    await t.page.waitForFunction(() => state.settings.alwaysOnTop === false);
    assert.equal(await mainTop(), false);
    assert.equal(await t.page.getAttribute('#btn-pin', 'aria-pressed'), 'false');
    await close();
  });

  it('外部数据文件同步置顶设置时，立即更新窗口层级和图钉', async () => {
    await start();
    await flush();
    const file = path.join(t.dir, 'data.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.settings.alwaysOnTop = true;
    data.settingsMtime = Date.now() + 1000;
    fs.writeFileSync(file, JSON.stringify(data));
    await t.page.waitForFunction(() => state.settings.alwaysOnTop === true, undefined, { timeout: 5000 });
    assert.equal(await mainTop(), true);
    assert.equal(await t.page.getAttribute('#btn-pin', 'aria-pressed'), 'true');
    await close();
  });

  it('隐藏再唤醒时重新应用便笺本与桌面便笺各自的置顶选择', async () => {
    await start(true, true);
    for (const top of [true, false]) {
      await t.page.evaluate(value => window.api.setAlwaysOnTop(value), top);
      await t.app.evaluate(({ BrowserWindow, app }, top) => {
        const notes = BrowserWindow.getAllWindows();
        const main = notes.find(w => !w.webContents.getURL().includes('sticky'));
        const sticky = notes.find(w => w.webContents.getURL().includes('sticky'));
        main.setAlwaysOnTop(!top); // 模拟窗口层级被其他系统操作改变
        sticky.setAlwaysOnTop(true);
        notes.forEach(w => w.hide());
        app.emit('second-instance');
      }, top);
      assert.equal(await mainTop(), top);
      assert.equal(await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
        .find(w => w.webContents.getURL().includes('sticky')).isAlwaysOnTop()), false);
    }
    await close();
  });

  it('桌面便笺因贴边临时置顶时，不会把图钉误认成用户开启的置顶', async () => {
    await start(false, true);
    const sticky = t.app.windows().find(w => w.url().includes('sticky'));
    await t.app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('sticky'));
      const wa = screen.getPrimaryDisplay().workArea;
      win.setBounds({ x: wa.x - 14, y: wa.y + 200, width: 340, height: 280 });
      screen.getCursorScreenPoint = () => ({ x: wa.x + 100, y: wa.y + 300 });
    });
    await sleep(600);
    await sticky.evaluate(() => window.api.dragEnd());
    await sticky.waitForFunction(() => document.body.classList.contains('docked'));
    await sticky.reload();
    await sticky.waitForFunction(() => typeof state !== 'undefined' && state.activeId === 'b');
    assert.equal(await sticky.evaluate(() => stickyOnTop), false);
    assert.equal(await sticky.getAttribute('#btn-pin', 'aria-pressed'), 'false');
    await sticky.evaluate(() => window.api.patchData({ settings: { set: { dockEnabled: false } } }));
    await sticky.waitForFunction(() => !document.body.classList.contains('docked'));
    assert.equal(await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(w => w.webContents.getURL().includes('sticky')).isAlwaysOnTop()), false);
    await close();
  });
});
