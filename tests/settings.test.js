'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { launchApp, note, sleep, flush, hasXdotool, ROOT } = require('./helpers');

describe('设置：快捷键与开机自启', () => {
  let t;
  const autostartDir = fs.mkdtempSync(path.join(os.tmpdir(), 'floatnote-autostart-'));
  before(async () => {
    t = await launchApp({
      seed: { notes: [note('a', '<div>内容</div>')], settings: { activeNoteId: 'a' } },
      env: { FLOATNOTE_AUTOSTART_DIR: autostartDir }
    });
    await t.page.click('#btn-settings');
  });
  after(async () => {
    assert.deepEqual(t.errors, []);
    await t.close();
  });

  const hk = () => t.page.evaluate(() => window.api.getHotkey());
  const record = async (sel, key) => {
    await t.page.click(sel);
    assert.equal(await t.page.textContent(sel), '请按下组合键…');
    await t.page.keyboard.press(key);
    await sleep(250);
  };

  it('录制新的唤起快捷键并保存', async () => {
    await record('#sm-hotkey-hint', 'Control+Alt+K');
    assert.equal((await hk()).acc, 'CommandOrControl+Alt+K');
    assert.equal(await t.page.textContent('#sm-hotkey-hint'), 'Ctrl+Alt+K');
    assert.ok(!(await t.page.locator('#settings-menu').evaluate(e => e.classList.contains('hidden'))), '录制时设置面板不被关掉');
    await flush();
    assert.equal(t.saved().settings.hotkey, 'CommandOrControl+Alt+K');
    const registered = await t.app.evaluate(({ globalShortcut }) => [globalShortcut.isRegistered('CommandOrControl+Alt+K'), globalShortcut.isRegistered('CommandOrControl+Alt+Space')]);
    assert.deepEqual(registered, [true, false], '新组合生效，旧组合释放');
  });

  it('只按 Shift+字母不行，必须带 Ctrl / Alt / Win', async () => {
    await t.page.click('#sm-capture-hint');
    await t.page.keyboard.press('Shift+Q');
    assert.match(await t.page.textContent('#sm-hotkey-tip'), /至少要带/);
    await t.page.keyboard.press('Escape');
    await sleep(200);
    assert.equal((await hk()).capture.acc, 'CommandOrControl+Alt+C', 'Esc 取消，保持原样');
  });

  it('和另一个快捷键重复时保留原设置并提示', async () => {
    await record('#sm-capture-hint', 'Control+Alt+K');
    assert.match(await t.page.textContent('#sm-hotkey-tip'), /重复/);
    assert.equal((await hk()).capture.acc, 'CommandOrControl+Alt+C');
  });

  it('新快捷键真的能唤起 / 隐藏', { skip: !hasXdotool() && '需要 Linux + xdotool' }, async () => {
    await t.page.keyboard.press('Escape');
    const visible = () => t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
    assert.equal(await visible(), true);
    execFileSync('xdotool', ['key', 'ctrl+alt+k']);
    await sleep(500);
    assert.equal(await visible(), false);
    execFileSync('xdotool', ['key', 'ctrl+alt+k']);
    await sleep(500);
    assert.equal(await visible(), true);
    await t.page.click('#btn-settings');
  });

  it('Backspace 恢复默认', async () => {
    await record('#sm-hotkey-hint', 'Backspace');
    assert.equal((await hk()).acc, 'CommandOrControl+Alt+Space');
  });

  it('开机自动启动（Linux 写 autostart 文件）', { skip: process.platform !== 'linux' && '其他系统会改到真实的登录项' }, async () => {
    const file = path.join(autostartDir, 'floatnote.desktop');
    assert.equal(await t.page.isChecked('#sm-autolaunch'), false);
    await t.page.click('#sm-autolaunch');
    await sleep(200);
    assert.ok(fs.existsSync(file));
    const exec = fs.readFileSync(file, 'utf-8').match(/^Exec=(.*)$/m)[1];
    assert.ok(exec.includes(require('electron')) && exec.includes(ROOT), '登记了 Electron 和项目路径：' + exec);
    await t.page.click('#sm-autolaunch');
    await sleep(200);
    assert.ok(!fs.existsSync(file));
  });
});
