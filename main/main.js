'use strict';

const { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain, clipboard, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// 透明窗口下的合成稳定性：禁用硬件加速可避免部分显卡驱动下的透明/半透明渲染异常
app.disableHardwareAcceleration();

let mainWindow = null;
let tray = null;
let isQuitting = false;
let ignoreMouse = true; // 默认透明区域穿透点击
let hideHintShown = false; // 是否已提示过“隐藏后如何唤回”
let winSize = { width: 700, height: 380 }; // 稳定窗口尺寸，避免高 DPI 下移动时尺寸漂移
let winPos = { x: 0, y: 0 }; // 自行累加的位置，避免回读 getBounds 引入舍入误差
let lastProgrammatic = 0; // 最近一次程序化 setBounds 的时间戳

/* 若上次保存的位置已不在任何显示器可见区域（拔掉副屏、分辨率变化等），
   把窗口移回主屏中央，避免“便笺不见了” */
function sanitizeBounds(b) {
  const width = Math.max(320, Math.round(b.width || 700));
  const height = Math.max(200, Math.round(b.height || 380));
  const displays = screen.getAllDisplays();
  const visible = displays.some(d => {
    const wa = d.workArea;
    const overlapX = Math.min(b.x + width, wa.x + wa.width) - Math.max(b.x, wa.x);
    const overlapY = Math.min(b.y + height, wa.y + wa.height) - Math.max(b.y, wa.y);
    return overlapX > 80 && overlapY > 60;
  });
  if (visible) {
    return { x: Math.round(b.x), y: Math.round(b.y), width, height };
  }
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    x: wa.x + Math.round((wa.width - width) / 2),
    y: wa.y + Math.round((wa.height - height) / 2),
    width,
    height
  };
}

const userDataDir = app.getPath('userData');
const dataFile = path.join(userDataDir, 'data.json');
const imagesDir = path.join(userDataDir, 'images');

function ensureDirs() {
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
}

function defaultSettings() {
  return {
    activeNoteId: null,
    opacity: 1,
    alwaysOnTop: true,
    hotkey: 'CommandOrControl+Alt+Space',
    bounds: null
  };
}

function loadData() {
  try {
    if (fs.existsSync(dataFile)) {
      const d = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
      d.settings = Object.assign(defaultSettings(), d.settings || {});
      d.notes = Array.isArray(d.notes) ? d.notes : [];
      return d;
    }
  } catch (e) {
    console.error('[loadData]', e);
  }
  return { version: 1, notes: [], settings: defaultSettings() };
}

function saveData(data) {
  try {
    ensureDirs();
    const tmp = dataFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, dataFile);
    return true;
  } catch (e) {
    console.error('[saveData]', e);
    return false;
  }
}

function createWindow() {
  const settings = loadData().settings;
  const b = sanitizeBounds(settings.bounds || { width: 700, height: 380 });
  winSize = { width: b.width, height: b.height };
  winPos = { x: b.x, y: b.y };

  mainWindow = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    minWidth: 320,
    minHeight: 200,
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: !!settings.alwaysOnTop,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    icon: path.join(__dirname, '..', 'assets', 'icon-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      transparent: true
    }
  });

  mainWindow.setAlwaysOnTop(!!settings.alwaysOnTop, 'floating');
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.showInactive();
  });

  // 关闭 = 隐藏（便签行为），除非真正退出
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // 持久化窗口位置/大小（防抖）
  let moveTimer = null;
  const persistBounds = () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const d = loadData();
      d.settings.bounds = mainWindow.getBounds();
      saveData(d);
    }, 600);
  };
  mainWindow.on('resize', () => {
    // 程序化移动/缩放会引起 ±1px 的 DPI 舍入抖动，若不忽略会形成“越拖越大”的正反馈
    if (Date.now() - lastProgrammatic > 400) {
      const rb = mainWindow.getBounds();
      if (Math.abs(rb.width - winSize.width) > 2 || Math.abs(rb.height - winSize.height) > 2) {
        winSize = { width: rb.width, height: rb.height };
      }
    }
    persistBounds();
  });
  mainWindow.on('move', () => {
    if (Date.now() - lastProgrammatic > 400) {
      const rb = mainWindow.getBounds();
      winPos = { x: rb.x, y: rb.y };
    }
    persistBounds();
  });

  // 退出前兜底保存窗口位置
  app.on('before-quit', () => {
    try {
      const d = loadData();
      d.settings.bounds = mainWindow.getBounds();
      saveData(d);
    } catch (e) {
      console.error('[quit:saveBounds]', e.message);
    }
  });
}

/* 全局快捷键：优先用户配置，冲突时按顺序回退到备用组合 */
const HOTKEY_CANDIDATES = [
  'CommandOrControl+Alt+Space',
  'CommandOrControl+Shift+Space',
  'CommandOrControl+Alt+F9'
];
let hotkeyInfo = { acc: HOTKEY_CANDIDATES[0], ok: false };

function registerHotkey(preferred) {
  globalShortcut.unregisterAll();
  const list = [];
  if (preferred) list.push(preferred);
  HOTKEY_CANDIDATES.forEach(acc => { if (!list.includes(acc)) list.push(acc); });

  for (const acc of list) {
    try {
      if (globalShortcut.register(acc, () => toggleWindow())) {
        hotkeyInfo = { acc, ok: true };
        console.log('[hotkey] registered:', acc);
        return hotkeyInfo;
      }
      console.warn('[hotkey] occupied, try next:', acc);
    } catch (e) {
      console.error('[hotkey] register error:', acc, e.message);
    }
  }
  hotkeyInfo = { acc: preferred || HOTKEY_CANDIDATES[0], ok: false };
  console.error('[hotkey] all candidates failed');
  return hotkeyInfo;
}

function toggleWindow() {
  if (mainWindow.isVisible()) mainWindow.hide();
  else showWindow();
}

function showWindow() {
  mainWindow.show();
  mainWindow.focus();
  if (mainWindow.isAlwaysOnTop()) mainWindow.moveTop();
}

/* 把窗口重新放回主屏中央（位置丢失时的兜底） */
function recenterWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = winSize.width;
  const height = winSize.height;
  winPos = {
    x: wa.x + Math.round((wa.width - width) / 2),
    y: wa.y + Math.round((wa.height - height) / 2)
  };
  lastProgrammatic = Date.now();
  mainWindow.setBounds({ x: winPos.x, y: winPos.y, width, height });
  showWindow();
}

function prettyHotkey(acc) {
  return String(acc || '')
    .replace('CommandOrControl', 'Ctrl')
    .replace('Control', 'Ctrl')
    .replace('Command', 'Cmd');
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon-32.png'));
  tray = new Tray(icon);
  tray.setToolTip('FloatNote 便签');
  const menu = Menu.buildFromTemplate([
    { label: hotkeyInfo.ok ? '快捷键 ' + prettyHotkey(hotkeyInfo.acc) : '快捷键注册失败', enabled: false },
    { type: 'separator' },
    { label: '显示 / 隐藏便签', click: () => toggleWindow() },
    { label: '新建便签', click: () => { showWindow(); mainWindow.webContents.send('cmd:new-note'); } },
    { label: '找回窗口（移到屏幕中央）', click: () => recenterWindow() },
    { type: 'separator' },
    { label: '退出 FloatNote', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => toggleWindow());
  tray.on('double-click', () => showWindow());
}

function registerIpc() {
  ipcMain.handle('data:load', () => loadData());
  ipcMain.handle('data:save', (e, data) => {
    // 渲染进程持有的 settings.bounds 是启动时的快照（可能为 null），
    // 直接落盘会覆盖主进程写入的窗口位置，这里保留已有 bounds。
    const prev = loadData();
    const next = { notes: data.notes || [], settings: Object.assign({}, data.settings || {}) };
    if (next.settings.bounds == null) next.settings.bounds = prev.settings && prev.settings.bounds;
    return saveData(next);
  });

  ipcMain.handle('image:save', (e, { noteId, dataUrl }) => {
    ensureDirs();
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(dataUrl || ''));
    if (!m) throw new Error('invalid image data');
    const mime = m[1].toLowerCase();
    const ext = mime === 'image/jpeg' ? '.jpg'
      : mime === 'image/gif' ? '.gif'
      : mime === 'image/webp' ? '.webp'
      : '.png';
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const dir = path.join(imagesDir, String(noteId));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, id + ext);
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
    return pathToFileURL(file).href;
  });

  // Electron 45 起剪贴板改为异步 API（read/write + ClipboardItem），不再提供 readImage
  ipcMain.handle('clipboard:readImage', async () => {
    try {
      const items = await clipboard.read();
      for (const item of items) {
        const type = (item.types || []).find(t => t.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type);
        const buf = Buffer.from(await blob.arrayBuffer());
        return 'data:' + type + ';base64,' + buf.toString('base64');
      }
    } catch (err) {
      console.error('[clipboard:readImage]', err.message);
    }
    return null;
  });

  ipcMain.handle('win:setAlwaysOnTop', (e, v) => {
    mainWindow.setAlwaysOnTop(!!v, 'floating');
    return !!v;
  });
  ipcMain.handle('win:hide', () => {
    mainWindow.hide();
    // 首次隐藏时提示如何唤回，避免用户以为窗口“消失”了
    if (!hideHintShown && tray) {
      hideHintShown = true;
      try {
        tray.displayBalloon({
          title: 'FloatNote 已隐藏',
          content: '按 ' + (hotkeyInfo.ok ? prettyHotkey(hotkeyInfo.acc) : '全局快捷键') + ' 或点击托盘图标即可唤回'
        });
      } catch (err) {
        console.warn('[tray] balloon failed:', err.message);
      }
    }
  });
  ipcMain.handle('win:minimize', () => mainWindow.minimize());
  ipcMain.handle('win:close', () => mainWindow.hide());
  ipcMain.handle('win:resize', (e, { width, height }) => {
    const w = Math.max(300, Math.round(width));
    const h = Math.max(260, Math.round(height));
    winSize = { width: w, height: h };
    lastProgrammatic = Date.now();
    mainWindow.setBounds({ x: winPos.x, y: winPos.y, width: w, height: h });
  });
  // 注意：Windows 在非整数缩放（如 150%）下，setPosition 会让窗口尺寸逐次 +1px 漂移，
  // 因此移动时显式带上稳定的宽高，并用自维护的坐标累加，避免“越拖越大”。
  ipcMain.handle('win:moveBy', (e, { dx, dy }) => {
    winPos = {
      x: winPos.x + Math.round(dx),
      y: winPos.y + Math.round(dy)
    };
    lastProgrammatic = Date.now();
    mainWindow.setBounds({
      x: winPos.x,
      y: winPos.y,
      width: winSize.width,
      height: winSize.height
    });
  });
  ipcMain.handle('win:setIgnoreMouse', (e, ignore) => {
    ignoreMouse = !!ignore;
    mainWindow.setIgnoreMouseEvents(ignoreMouse, { forward: true });
    return ignoreMouse;
  });
  ipcMain.handle('win:registerHotkey', (e, acc) => registerHotkey(acc));
  ipcMain.handle('win:getHotkey', () => hotkeyInfo);
  ipcMain.handle('win:quit', () => { isQuitting = true; app.quit(); });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    createWindow();
    registerIpc();
    registerHotkey(loadData().settings.hotkey || HOTKEY_CANDIDATES[0]);
    createTray();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', (e) => {
    // 保持常驻（由托盘退出）
  });
}
