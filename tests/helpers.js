'use strict';

/* 端到端测试工具：用 Playwright 驱动真实的 Electron 应用。
   每个测试文件启动自己的应用实例，数据放在独立的临时目录（FLOATNOTE_USER_DATA），不碰真实便笺。 */
const { _electron } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function note(id, content = '', extra = {}) {
  return Object.assign({ id, title: '', tags: [], content, createdAt: Date.now(), updatedAt: Date.now() }, extra);
}

function seedData(dir, { notes = [], settings = {} } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const data = {
    version: 1,
    notes,
    settings: Object.assign({ opacity: 1, alwaysOnTop: true, bounds: { x: 200, y: 160, width: 700, height: 400 } }, settings)
  };
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(data));
}

/* 启动应用。seed 为 { notes, settings }；dir 复用已有数据目录（测试重启场景） */
async function launchApp({ seed, dir, env = {} } = {}) {
  const userData = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'floatnote-test-'));
  if (seed) seedData(userData, seed);
  // 界面语言固定为中文：测试里核对的都是中文文字，不能随运行环境的系统语言变（英文界面由 i18n.test.js 单独测）
  const launchEnv = Object.assign({}, process.env, { FLOATNOTE_USER_DATA: userData, FLOATNOTE_LANG: 'zh' }, env);
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [ROOT, '--no-sandbox'],
    cwd: ROOT,
    env: launchEnv
  });
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  };
  const watched = new Set();
  const watchOnce = (p) => { if (!watched.has(p)) { watched.add(p); watch(p); } };
  app.on('window', watchOnce);
  // 重启场景下桌面便笺窗口可能先出现，这里明确拿便笺本（主窗口）
  const isMain = (p) => !p.url().includes('mode=sticky');
  let page = await app.firstWindow();
  while (!isMain(page)) page = app.windows().find(isMain) || await app.waitForEvent('window', { timeout: 15000 });
  app.windows().forEach(watchOnce);
  await page.waitForFunction(() => typeof state !== 'undefined' && !!state.activeId);
  await sleep(300);
  return {
    app,
    page,
    dir: userData,
    errors,
    saved: () => JSON.parse(fs.readFileSync(path.join(userData, 'data.json'), 'utf-8')),
    // 本机设置（窗口位置、桌面便笺、快捷键等）存在 local.json，不随数据目录同步
    local: () => JSON.parse(fs.readFileSync(path.join(userData, 'local.json'), 'utf-8')),
    html: () => page.innerHTML('#editor'),
    close: () => app.close()
  };
}

/* 等数据落盘：渲染进程 500ms 防抖 + 主进程 300ms 防抖 */
const flush = () => sleep(1100);

function hasXdotool() {
  if (process.platform !== 'linux' || !process.env.DISPLAY) return false;
  try { execFileSync('which', ['xdotool'], { stdio: 'ignore' }); return true; } catch (_) { return false; }
}

module.exports = { launchApp, seedData, note, sleep, flush, hasXdotool, ROOT };
