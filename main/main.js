'use strict';

const {
  app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain, clipboard, nativeImage, screen, Notification, shell, dialog,
  protocol, net
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

// 透明窗口下的合成稳定性：禁用硬件加速可避免部分显卡驱动下的透明/半透明渲染异常
app.disableHardwareAcceleration();

// 便笺图片地址 fnimg://<便笺>/<文件>：与数据目录位置无关（换目录、换电脑都能显示）
protocol.registerSchemesAsPrivileged([
  { scheme: 'fnimg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

function registerImageProtocol() {
  protocol.handle('fnimg', (req) => {
    try {
      const u = new URL(req.url);
      const id = u.hostname;
      const file = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
      // 只允许读数据目录 images/ 下的文件，防止 ../ 之类越界
      if (!/^[a-z0-9]+$/.test(id) || !/^[\w.-]+$/.test(file) || file.startsWith('.')) return new Response('bad request', { status: 400 });
      const full = path.join(imagesDir, id, file);
      if (!full.startsWith(imagesDir + path.sep)) return new Response('forbidden', { status: 403 });
      return net.fetch(pathToFileURL(full).toString());
    } catch (_) {
      return new Response('not found', { status: 404 });
    }
  });
}

const GUTTER = 14; // 卡片四周留给投影的透明边距（与 styles.css 的 --gutter 一致）
const INDEX_HTML = path.join(__dirname, '..', 'renderer', 'index.html');
const ASSETS = path.join(__dirname, '..', 'assets');
const APP_ICON = path.join(ASSETS, process.platform === 'win32' ? 'icon.ico' : 'icon-256.png');

let tray = null;
let isQuitting = false;
let hideHintShown = false; // 是否已提示过“隐藏后如何唤回”

/* ============ 数据：主进程持有唯一一份，渲染进程只发增量 ============
   两类目录：
   - 本机目录 userData（固定为 <appData>/floatnote）：本机设置 local.json、数据位置 location.json、每日备份、Chromium 缓存。
     打包后的应用默认会用产品名 FloatNote 命名目录，在 macOS / Linux 上与开发时的 floatnote 不同，所以显式固定。
   - 数据目录（默认就是本机目录，可在设置里改到 OneDrive / 坚果云等同步文件夹）：data.json 与 images/。
   自动化测试用 FLOATNOTE_USER_DATA 指向独立的临时目录，不碰真实便笺。 */
app.setPath('userData', process.env.FLOATNOTE_USER_DATA || path.join(app.getPath('appData'), 'floatnote'));
const userDataDir = app.getPath('userData');
const locationFile = path.join(userDataDir, 'location.json');
const localFile = path.join(userDataDir, 'local.json');

function readLocation() {
  try {
    const d = JSON.parse(fs.readFileSync(locationFile, 'utf-8'));
    if (d && typeof d.dataDir === 'string' && d.dataDir) return d.dataDir;
  } catch (_) { /* 没有就用默认 */ }
  return null;
}

let dataDir;
let dataFile;
let imagesDir;
function setDataPaths(dir) {
  dataDir = path.resolve(dir);
  dataFile = path.join(dataDir, 'data.json');
  imagesDir = path.join(dataDir, 'images');
}
setDataPaths(readLocation() || userDataDir);
const isCustomDataDir = () => dataDir !== path.resolve(userDataDir);

// 由主进程维护、渲染进程不会改写的设置项
const MAIN_OWNED_SETTINGS = ['bounds', 'stickies', 'dock', 'hotkey', 'captureHotkey'];
// 每台电脑各自的设置：存在本机 local.json，不随数据目录同步
const LOCAL_SETTINGS = ['bounds', 'stickies', 'dock', 'hotkey', 'captureHotkey', 'activeNoteId'];

function ensureDirs() {
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
}

function defaultSettings() {
  return {
    activeNoteId: null,
    opacity: 1,
    alwaysOnTop: true,
    hotkey: 'CommandOrControl+Alt+Space',
    bounds: null,
    stickies: {},
    dock: null
  };
}

/* 旧版本把图片存成本机绝对路径 file:///…/images/<便笺>/<文件>，换数据目录或换一台电脑就失效；
   统一改成与位置无关的 fnimg://<便笺>/<文件>，由主进程按当前数据目录读取 */
const IMG_FILE_URL_RE = /file:\/\/\/[^"'\s<>]*?\/images\/([a-z0-9]+)\/([\w.-]+)/gi;
function migrateImageUrls(note) {
  if (note && typeof note.content === 'string' && note.content.includes('file:')) {
    note.content = note.content.replace(IMG_FILE_URL_RE, (m, id, f) => `fnimg://${id.toLowerCase()}/${f}`);
  }
}

const TOMBSTONE_MS = 60 * 24 * 3600 * 1000; // 删除记录保留 60 天，防止另一台电脑把删掉的便笺带回来

function normalizeData(d) {
  if (!d || typeof d !== 'object') d = {};
  d.settings = Object.assign(defaultSettings(), d.settings || {});
  if (!d.settings.stickies || typeof d.settings.stickies !== 'object') d.settings.stickies = {};
  d.notes = Array.isArray(d.notes) ? d.notes : [];
  d.deleted = d.deleted && typeof d.deleted === 'object' ? d.deleted : {};
  const now = Date.now();
  for (const [id, ts] of Object.entries(d.deleted)) if (now - ts > TOMBSTONE_MS) delete d.deleted[id];
  d.settingsMtime = Number(d.settingsMtime) || 0;
  d.orderMtime = Number(d.orderMtime) || 0;
  d.notes.forEach(migrateImageUrls);
  return d;
}

const isOurData = (d) => d && typeof d === 'object' && Array.isArray(d.notes) && d.settings && typeof d.settings === 'object';

let recoveredFrom = null; // 启动时数据文件损坏、从哪份备份恢复的（用于提示）
let restoring = false;     // 正在恢复备份 / 切换数据目录：期间忽略窗口发来的增量（重新加载前的旧改动不能混进来）

function readLocal() {
  try { return JSON.parse(fs.readFileSync(localFile, 'utf-8')) || null; } catch (_) { return null; }
}

/* 读共享数据（data.json）。损坏时改名留档并从最近的备份恢复，绝不拿一份空数据把它覆盖掉 */
function readSharedData() {
  if (fs.existsSync(dataFile)) {
    try {
      return normalizeData(JSON.parse(fs.readFileSync(dataFile, 'utf-8')));
    } catch (e) {
      console.error('[loadData] data.json 损坏:', e.message);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      try { fs.renameSync(dataFile, path.join(dataDir, `data.corrupt-${stamp}.json`)); } catch (_) { /* ignore */ }
      for (const b of listBackups()) {
        try {
          const d = normalizeData(JSON.parse(fs.readFileSync(b.file, 'utf-8')));
          recoveredFrom = b.label;
          return d;
        } catch (_) { /* 这份也坏了，试下一份 */ }
      }
    }
  }
  return normalizeData({ version: 1, notes: [] });
}

/* 共享数据 + 本机设置。旧版本的 data.json 里带着本机设置，本机还没有 local.json 时沿用它们（迁移） */
function loadData() {
  const d = readSharedData();
  const local = readLocal();
  if (local) for (const k of LOCAL_SETTINGS) if (k in local) d.settings[k] = local[k];
  if (!d.settings.stickies || typeof d.settings.stickies !== 'object') d.settings.stickies = {};
  if (recoveredFrom) saveData(d);
  return d;
}

/* 拆成共享部分和本机部分 */
function splitData(data) {
  const shared = { version: 1, notes: data.notes, deleted: data.deleted || {}, settingsMtime: data.settingsMtime || 0, orderMtime: data.orderMtime || 0, settings: {} };
  const local = {};
  for (const [k, v] of Object.entries(data.settings || {})) (LOCAL_SETTINGS.includes(k) ? local : shared.settings)[k] = v;
  return { shared, local };
}

function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

let lastWrite = null; // 本进程最后一次写 data.json 后的 mtime / size：监视文件时据此区分“是我写的”还是“别处改的”

function saveData(data) {
  try {
    ensureDirs();
    const { shared, local } = splitData(data);
    writeJsonAtomic(dataFile, shared);
    const st = fs.statSync(dataFile);
    lastWrite = { mtimeMs: st.mtimeMs, size: st.size, hash: canonical(shared) };
    writeJsonAtomic(localFile, local);
    return true;
  } catch (e) {
    console.error('[saveData]', e);
    return false;
  }
}

/* ============ 自动备份：每天一份，保留最近 7 天（放在本机目录，不随同步文件夹走） ============ */
const backupDir = path.join(userDataDir, 'backups');
const KEEP_BACKUPS = 7;
const BACKUP_RE = /^data-(\d{4})-(\d{2})-(\d{2})\.json$/;

function listBackups() {
  try {
    return fs.readdirSync(backupDir)
      .filter(f => BACKUP_RE.test(f))
      .sort()
      .reverse()
      .map(f => {
        const [, y, m, d] = BACKUP_RE.exec(f);
        return { file: path.join(backupDir, f), name: f, label: `${y}年${Number(m)}月${Number(d)}日` };
      });
  } catch (_) {
    return [];
  }
}

function dailyBackup() {
  try {
    if (!fs.existsSync(dataFile)) return;
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const d = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    const name = `data-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
    const target = path.join(backupDir, name);
    if (!fs.existsSync(target)) fs.copyFileSync(dataFile, target);
    listBackups().slice(KEEP_BACKUPS).forEach(b => { try { fs.unlinkSync(b.file); } catch (_) { /* ignore */ } });
    rebuildTrayMenu();
  } catch (e) {
    console.error('[backup]', e.message);
  }
}

/* 用某份备份替换当前全部数据（替换前把当前数据另存一份，万一选错还能找回） */
async function restoreBackup(b) {
  let backupData;
  try {
    backupData = normalizeData(JSON.parse(fs.readFileSync(b.file, 'utf-8')));
  } catch (e) {
    dialog.showMessageBox({ type: 'error', message: '这份备份无法读取', detail: e.message });
    return;
  }
  const live = backupData.notes.filter(n => !n.trashed).length;
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['恢复', '取消'],
    defaultId: 1,
    cancelId: 1,
    message: `用 ${b.label} 的备份替换现在的所有便笺？`,
    detail: `备份里有 ${live} 张便笺。现在的数据会先另存为 backups/before-restore-*.json，选错了还能找回。`
  });
  if (response !== 0) return;
  flushStore();
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(dataFile, path.join(backupDir, `before-restore-${stamp}.json`));
  } catch (_) { /* ignore */ }
  // 本机设置（窗口位置、桌面便笺、快捷键等）沿用当前的，其余全部换成备份
  for (const k of LOCAL_SETTINGS) backupData.settings[k] = store.settings[k];
  backupData.settingsMtime = Date.now();
  backupData.notes.forEach(n => { n.mtime = Date.now(); }); // 让同步的其他设备也以备份为准
  store = backupData;
  flushStore();
  reloadAllWindows();
  notify('已从备份恢复', `${b.label}，共 ${live} 张便笺`);
}

/* ============ 清理没有便笺在用的图片 ============
   默认目录：跳过 10 分钟内的新文件。同步文件夹：图片可能比 data.json 先同步过来，只清理 7 天以上的。 */
function cleanupImages() {
  try {
    if (!fs.existsSync(imagesDir)) return;
    const recent = Date.now() - (isCustomDataDir() ? 7 * 24 * 3600 * 1000 : 10 * 60 * 1000);
    let removed = 0;
    for (const dir of fs.readdirSync(imagesDir)) {
      const full = path.join(imagesDir, dir);
      if (!fs.statSync(full).isDirectory()) continue;
      const note = store.notes.find(n => n.id === dir); // 「最近删除」里的便笺也算在用
      const files = fs.readdirSync(full);
      for (const f of files) {
        const fp = path.join(full, f);
        const st = fs.statSync(fp);
        if (st.mtimeMs > recent) continue;
        if (!note || !String(note.content || '').includes(f)) {
          fs.unlinkSync(fp);
          removed++;
        }
      }
      if (!fs.readdirSync(full).length) fs.rmdirSync(full);
    }
    if (removed) console.log('[cleanupImages] removed', removed);
  } catch (e) {
    console.error('[cleanupImages]', e.message);
  }
}

/* 「最近删除」里超过 30 天的便笺彻底删除 */
const TRASH_MS = 30 * 24 * 3600 * 1000;
function purgeOldTrash() {
  const before = store.notes.length;
  store.notes = store.notes.filter(n => {
    const expired = n.trashed && Date.now() - n.trashed >= TRASH_MS;
    if (expired) store.deleted[n.id] = Date.now();
    return !expired;
  });
  if (store.notes.length !== before) scheduleStoreSave();
}

let store = null;
let storeTimer = null;
function scheduleStoreSave(delay = 300) {
  clearTimeout(storeTimer);
  storeTimer = setTimeout(flushStore, delay);
}
function flushStore() {
  clearTimeout(storeTimer);
  storeTimer = null;
  if (store) saveData(store);
}

/* 增量格式：
   { upserts: [{ id, set: {...}, unset: [...] }], deletes: [id], order: [id] | null,
     settings: { set: {...}, unset: [...] } | null }
   主进程顺带记下修改时间（便笺 mtime、共享设置 settingsMtime）与删除记录，供多设备合并时判断谁新谁旧 */
function applyPatch(patch) {
  if (!patch) return;
  const now = Date.now();
  for (const u of patch.upserts || []) {
    let n = store.notes.find(x => x.id === u.id);
    if (!n) { n = { id: u.id }; store.notes.push(n); }
    Object.assign(n, u.set || {});
    (u.unset || []).forEach(k => { delete n[k]; });
    n.mtime = now;
    delete store.deleted[n.id];
    if (n.trashed) closeSticky(n.id, false);
  }
  if (patch.deletes && patch.deletes.length) {
    const del = new Set(patch.deletes);
    store.notes = store.notes.filter(n => !del.has(n.id));
    del.forEach(id => { store.deleted[id] = now; closeSticky(id, false); });
  }
  if (Array.isArray(patch.order)) {
    const rank = new Map(patch.order.map((id, i) => [id, i]));
    store.notes.sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : 1e9) - (rank.has(b.id) ? rank.get(b.id) : 1e9));
    store.orderMtime = now;
  }
  if (patch.settings) {
    const set = Object.assign({}, patch.settings.set || {});
    MAIN_OWNED_SETTINGS.forEach(k => delete set[k]);
    Object.assign(store.settings, set);
    (patch.settings.unset || []).forEach(k => { if (!MAIN_OWNED_SETTINGS.includes(k)) delete store.settings[k]; });
    const keys = [...Object.keys(set), ...(patch.settings.unset || [])];
    if (keys.some(k => !LOCAL_SETTINGS.includes(k))) store.settingsMtime = now;
  }
}

/* ============ 多设备同步：数据目录放在同步文件夹里时，合并其他设备的修改 ============
   每 2 秒检查 data.json；发现不是自己写的，就按便笺逐张合并（两边都改过的取最后修改的），
   删除记录防止删掉的便笺被带回来。同步软件产生的冲突副本（data (1).json 等）也会合并后改名为 .merged。 */
function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

const noteTime = (n) => Math.max(n.mtime || 0, n.updatedAt || 0, n.trashed || 0);

/* 用于判断“两份数据是否一样”：便笺按编号排序后比较，顺序不同不算不同
   （否则两台电脑顺序不一致时会各自写回自己的顺序，来回触发） */
function canonical(shared) {
  return stableStringify(Object.assign({}, shared, {
    notes: [...shared.notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    orderMtime: 0
  }));
}

/* 把 other 合并进 target，返回给各窗口的增量（没有变化返回 null） */
function mergeInto(target, other) {
  const patch = { upserts: [], deletes: [], order: null, settings: null };
  for (const [id, ts] of Object.entries(other.deleted || {})) {
    if (!target.deleted[id] || target.deleted[id] < ts) target.deleted[id] = ts;
  }
  const byId = new Map(target.notes.map(n => [n.id, n]));
  let added = false;
  for (const o of other.notes) {
    const del = target.deleted[o.id];
    if (del && del >= noteTime(o)) continue; // 已经删掉了，不复活
    const l = byId.get(o.id);
    if (!l) {
      const n = Object.assign({}, o);
      target.notes.push(n);
      byId.set(n.id, n);
      delete target.deleted[n.id];
      patch.upserts.push({ id: n.id, set: Object.assign({}, n), unset: [] });
      added = true;
    } else if (noteTime(o) > noteTime(l) && stableStringify(o) !== stableStringify(l)) {
      const unset = Object.keys(l).filter(k => !(k in o));
      unset.forEach(k => { delete l[k]; });
      Object.assign(l, o);
      patch.upserts.push({ id: l.id, set: Object.assign({}, o), unset });
    }
  }
  for (const l of [...target.notes]) {
    const del = target.deleted[l.id];
    if (del && del >= noteTime(l)) {
      target.notes.splice(target.notes.indexOf(l), 1);
      patch.deletes.push(l.id);
      closeSticky(l.id, false);
    }
  }
  // 排列顺序（置顶、拖动排序）：以最后调整的一方为准；对方没有的便笺接在后面
  if ((other.orderMtime || 0) > (target.orderMtime || 0)) {
    const rank = new Map(other.notes.map((n, i) => [n.id, i]));
    const before = target.notes.map(n => n.id).join(',');
    target.notes.sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : 1e9) - (rank.has(b.id) ? rank.get(b.id) : 1e9));
    target.orderMtime = other.orderMtime;
    if (target.notes.map(n => n.id).join(',') !== before) added = true;
  }
  if (added) patch.order = target.notes.map(n => n.id);
  if ((other.settingsMtime || 0) > (target.settingsMtime || 0)) {
    const set = {};
    for (const [k, v] of Object.entries(other.settings || {})) {
      if (LOCAL_SETTINGS.includes(k) || MAIN_OWNED_SETTINGS.includes(k)) continue;
      if (stableStringify(target.settings[k]) !== stableStringify(v)) { set[k] = v; target.settings[k] = v; }
    }
    target.settingsMtime = other.settingsMtime;
    if (Object.keys(set).length) patch.settings = { set, unset: [] };
  }
  return patch.upserts.length || patch.deletes.length || patch.settings ? patch : null;
}

/* 合并一份外来数据，必要时写回 data.json。
   compareWith：与哪份数据比较来决定要不要写回——合并 data.json 时就是它本身（一样就不写，避免两台电脑来回触发）；
   合并冲突副本时要和 data.json 比较，否则副本里的新内容只进了本机内存，另一台电脑永远看不到 */
function applyExternal(other, compareWith = other) {
  const patch = mergeInto(store, other);
  if (patch) broadcast('data:patched', patch);
  const mine = canonical(splitData(store).shared);
  const theirs = compareWith ? canonical(splitData(compareWith).shared) : null;
  if (mine !== theirs) flushStore();
  else if (patch) lastWrite = Object.assign({}, lastWrite, { hash: mine });
  return !!patch;
}

function readDataFileQuiet() {
  try {
    const d = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    return isOurData(d) ? normalizeData(d) : null;
  } catch (_) {
    return null;
  }
}

let watchedFile = null;
let mergeTimer = null;
let mergeRetries = 0;
let conflictTimer = null;

function startDataWatch() {
  stopDataWatch();
  watchedFile = dataFile;
  fs.watchFile(watchedFile, { interval: 2000 }, (cur) => {
    if (!cur.mtimeMs || restoring) return;
    if (lastWrite && cur.mtimeMs === lastWrite.mtimeMs && cur.size === lastWrite.size) return; // 自己写的
    clearTimeout(mergeTimer);
    mergeTimer = setTimeout(mergeExternalFile, 400);
  });
  if (isCustomDataDir()) conflictTimer = setInterval(mergeConflictCopies, 10000);
}

function stopDataWatch() {
  if (watchedFile) fs.unwatchFile(watchedFile);
  watchedFile = null;
  clearTimeout(mergeTimer);
  clearInterval(conflictTimer);
  conflictTimer = null;
}

function mergeExternalFile() {
  let other;
  try {
    other = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    if (!isOurData(other)) throw new Error('not FloatNote data');
  } catch (e) {
    // 同步软件可能还没写完：稍后重试几次
    if (++mergeRetries <= 5) mergeTimer = setTimeout(mergeExternalFile, 2000);
    return;
  }
  mergeRetries = 0;
  const other2 = normalizeData(other);
  if (lastWrite && canonical(splitData(other2).shared) === lastWrite.hash) return;
  if (applyExternal(other2)) console.log('[sync] merged changes from', dataFile);
}

/* 同步软件冲突时会另存一份（data (1).json、data-电脑名.json、data_冲突副本.json 等）：合并后改名 .merged */
function mergeConflictCopies() {
  if (restoring) return;
  let files;
  try { files = fs.readdirSync(dataDir); } catch (_) { return; }
  for (const f of files) {
    if (f === 'data.json' || !/^data.*\.json$/i.test(f) || /^data\.corrupt-/i.test(f)) continue;
    const full = path.join(dataDir, f);
    try {
      const other = JSON.parse(fs.readFileSync(full, 'utf-8'));
      if (!isOurData(other)) continue; // 不是便笺数据，不碰
      applyExternal(normalizeData(other), readDataFileQuiet());
      fs.renameSync(full, full + '.merged');
      console.log('[sync] merged conflict copy', f);
    } catch (_) { /* 读不了就下次再试 */ }
  }
}

/* ============ 更改数据目录 ============ */
function reloadAllWindows(delay = 0) {
  restoring = true; // 从现在起忽略窗口发来的增量：旧页面里的改动不能混进新数据
  if (delay) { setTimeout(() => reloadAllWindows(0), delay); return; }
  const main = mainCtx && !mainCtx.win.isDestroyed() ? mainCtx : null;
  for (const c of allWindows()) if (c !== main) c.win.webContents.reload();
  if (main) {
    main.win.webContents.once('did-finish-load', () => { restoring = false; });
    main.win.webContents.reload();
  } else {
    restoring = false;
  }
}

const liveCount = (d) => d.notes.filter(n => !n.trashed).length;

/* mode：move（目标为空：复制过去）/ merge（合并两边）/ theirs（只用目标里的） */
function changeDataDir(dir, mode = 'move') {
  dir = path.resolve(dir);
  if (dir === dataDir) return { ok: true, dir, same: true };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.floatnote-write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (e) {
    return { ok: false, error: '这个文件夹无法写入：' + e.message };
  }
  flushStore();
  const targetFile = path.join(dir, 'data.json');
  const copyImages = () => {
    if (fs.existsSync(imagesDir)) fs.cpSync(imagesDir, path.join(dir, 'images'), { recursive: true, force: false, errorOnExist: false });
  };
  let next = store;
  if (fs.existsSync(targetFile)) {
    let other;
    try {
      other = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
      if (!isOurData(other)) throw new Error('不是 FloatNote 的数据');
    } catch (e) {
      return { ok: false, error: '那里的 data.json 无法读取：' + e.message };
    }
    other = normalizeData(other);
    if (mode === 'theirs') {
      for (const k of LOCAL_SETTINGS) other.settings[k] = store.settings[k];
      next = other;
    } else {
      mode = 'merge';
      mergeInto(store, other);
      copyImages();
    }
  } else {
    mode = 'move';
    copyImages();
  }
  stopDataWatch();
  setDataPaths(dir);
  store = next;
  flushStore();
  try {
    if (isCustomDataDir()) writeJsonAtomic(locationFile, { dataDir });
    else if (fs.existsSync(locationFile)) fs.unlinkSync(locationFile);
  } catch (e) {
    console.error('[changeDataDir] location', e.message);
  }
  startDataWatch();
  reloadAllWindows(150); // 稍等再刷新窗口：先让“切换成功”的结果送回页面
  rebuildTrayMenu();
  return { ok: true, dir: dataDir, mode };
}

/* 设置里点「更改」/「恢复默认」：选文件夹并按情况确认 */
async function pickDataDir(win, toDefault) {
  let dir;
  if (toDefault) {
    dir = userDataDir;
  } else {
    const r = await dialog.showOpenDialog(win, {
      title: '选择便笺保存位置',
      buttonLabel: '保存到这里',
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    dir = r.filePaths[0];
  }
  if (path.resolve(dir) === dataDir) return { ok: true, dir: dataDir, same: true };
  const targetFile = path.join(dir, 'data.json');
  let mode = 'move';
  if (fs.existsSync(targetFile)) {
    let n = 0;
    try { n = liveCount(normalizeData(JSON.parse(fs.readFileSync(targetFile, 'utf-8')))); } catch (e) {
      await dialog.showMessageBox(win, { type: 'error', message: '那里的 data.json 无法读取', detail: e.message });
      return { ok: false, canceled: true };
    }
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['合并两边的便笺', '只用那里的便笺', '取消'],
      defaultId: 0,
      cancelId: 2,
      message: `这个文件夹里已经有 ${n} 张便笺`,
      detail: '合并：两边的便笺都保留，同一张便笺以最后修改的为准。\n只用那里的：本机现在的便笺不带过去（仍留在原位置，随时可以切回来）。'
    });
    if (response === 2) return { ok: false, canceled: true };
    mode = response === 0 ? 'merge' : 'theirs';
  } else {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['复制过去并使用', '取消'],
      defaultId: 0,
      cancelId: 1,
      message: '把便笺保存到这个文件夹？',
      detail: `${dir}\n\n现有的便笺和图片会复制过去，之后的修改都保存在那里；原位置的文件保留不动。\n放在 OneDrive、坚果云、iCloud 等同步文件夹里，多台电脑就能共用便笺。`
    });
    if (response !== 0) return { ok: false, canceled: true };
  }
  return changeDataDir(dir, mode);
}

/* ============ 窗口：主窗口 + 若干“贴在桌面”的便笺窗口 ============ */
const wins = new Map(); // webContents.id -> ctx
let mainCtx = null;

function ctxOf(e) { return wins.get(e.sender.id) || null; }
function broadcast(channel, payload, exceptId) {
  for (const [id, ctx] of wins) {
    if (id !== exceptId && !ctx.win.isDestroyed()) ctx.win.webContents.send(channel, payload);
  }
}

/* 若位置已不在任何显示器可见区域（拔掉副屏、分辨率变化等），移回主屏中央 */
function sanitizeBounds(b, minW = 320, minH = 200) {
  const width = Math.max(minW, Math.round(b.width || 700));
  const height = Math.max(minH, Math.round(b.height || 380));
  const visible = screen.getAllDisplays().some(d => {
    const wa = d.workArea;
    const overlapX = Math.min(b.x + width, wa.x + wa.width) - Math.max(b.x, wa.x);
    const overlapY = Math.min(b.y + height, wa.y + wa.height) - Math.max(b.y, wa.y);
    return overlapX > 80 && overlapY > 60;
  });
  if (visible && Number.isFinite(b.x) && Number.isFinite(b.y)) {
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

/* 展开状态下的完整窗口区域（收起时窗口实际只是一条细边） */
function fullBounds(ctx) {
  return { x: ctx.pos.x, y: ctx.pos.y, width: ctx.size.width, height: ctx.size.height };
}

function setCtxBounds(ctx, b) {
  ctx.lastProgrammatic = Date.now();
  ctx.win.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
}

function createNoteWindow({ kind, noteId = null, bounds, onTop }) {
  const isSticky = kind === 'sticky';
  const minW = isSticky ? 240 : 320;
  const minH = isSticky ? 180 : 200;
  const b = sanitizeBounds(bounds || { width: 700, height: 380 }, minW, minH);

  const win = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    minWidth: minW,
    minHeight: minH,
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: !!onTop,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      transparent: true
    }
  });

  const wcId = win.webContents.id;
  const ctx = {
    win, kind, noteId,
    size: { width: b.width, height: b.height }, // 稳定尺寸，避免高 DPI 下移动时尺寸漂移
    pos: { x: b.x, y: b.y },                    // 自行累加的位置，避免回读 getBounds 的舍入误差
    lastProgrammatic: 0,
    minSize: { width: minW, height: minH },
    dragging: false,
    dock: null,       // { edge }
    collapsed: false,
    dockTimer: null,
    outSince: 0
  };
  wins.set(wcId, ctx);

  win.setAlwaysOnTop(!!onTop, 'floating');
  win.setIgnoreMouseEvents(true, { forward: true });
  // 便笺里的链接只能经 Ctrl+单击 交给系统浏览器打开；窗口本身不允许跳转或弹出新窗口
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(INDEX_HTML, isSticky ? { query: { mode: 'sticky', note: noteId } } : {});
  win.once('ready-to-show', () => {
    win.showInactive();
    if (getDockRecord(ctx)) {
      // 上次是贴边收起状态：恢复
      if (tryDock(ctx)) collapse(ctx);
    }
  });

  // 主窗口关闭 = 隐藏（便签行为），除非真正退出
  win.on('close', (e) => {
    if (!isSticky && !isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    stopDockWatch(ctx);
    wins.delete(wcId);
  });

  // 持久化窗口位置/大小（防抖）
  let persistTimer = null;
  const persistBounds = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      if (isSticky) {
        const s = store.settings.stickies[noteId];
        if (s) Object.assign(s, fullBounds(ctx));
      } else {
        store.settings.bounds = fullBounds(ctx);
      }
      scheduleStoreSave();
    }, 600);
  };
  win.on('resize', () => {
    // 程序化移动/缩放会引起 ±1px 的 DPI 舍入抖动，若不忽略会形成“越拖越大”的正反馈
    if (!ctx.collapsed && Date.now() - ctx.lastProgrammatic > 400) {
      const rb = win.getBounds();
      if (Math.abs(rb.width - ctx.size.width) > 2 || Math.abs(rb.height - ctx.size.height) > 2) {
        ctx.size = { width: rb.width, height: rb.height };
      }
    }
    persistBounds();
  });
  win.on('move', () => {
    if (!ctx.collapsed && Date.now() - ctx.lastProgrammatic > 400) {
      const rb = win.getBounds();
      ctx.pos = { x: rb.x, y: rb.y };
    }
    persistBounds();
  });

  return ctx;
}

function createMainWindow() {
  mainCtx = createNoteWindow({
    kind: 'main',
    bounds: store.settings.bounds || { width: 700, height: 380 },
    onTop: !!store.settings.alwaysOnTop
  });
}

/* ============ 贴到桌面 ============ */
function stickyCtx(noteId) {
  for (const ctx of wins.values()) if (ctx.kind === 'sticky' && ctx.noteId === noteId) return ctx;
  return null;
}

function broadcastStickies() {
  broadcast('sticky:list', Object.keys(store.settings.stickies));
}

function openSticky(noteId, at) {
  if (!store.notes.some(n => n.id === noteId)) return false;
  const existing = stickyCtx(noteId);
  if (existing) {
    existing.win.show();
    existing.win.focus();
    return true;
  }
  let rec = store.settings.stickies[noteId];
  if (!rec || at) {
    const p = at || screen.getCursorScreenPoint();
    rec = {
      x: Math.round(p.x - 70), // 让鼠标大致落在新便笺标题附近
      y: Math.round(p.y - 30),
      width: 340,
      height: 280,
      onTop: true
    };
    store.settings.stickies[noteId] = rec;
    scheduleStoreSave();
  }
  const ctx = createNoteWindow({ kind: 'sticky', noteId, bounds: rec, onTop: rec.onTop !== false });
  // sanitize 可能挪动了位置，回写一次
  Object.assign(rec, fullBounds(ctx));
  broadcastStickies();
  return true;
}

function closeSticky(noteId, persist = true) {
  const ctx = stickyCtx(noteId);
  if (store.settings.stickies[noteId]) {
    delete store.settings.stickies[noteId];
    if (persist) scheduleStoreSave();
  }
  if (ctx && !ctx.win.isDestroyed()) ctx.win.destroy();
  broadcastStickies();
}

function restoreStickies() {
  for (const id of Object.keys(store.settings.stickies)) {
    if (store.notes.some(n => n.id === id)) openSticky(id);
    else delete store.settings.stickies[id];
  }
}

/* ============ 贴边收起（便笺本和桌面便笺都可以） ============ */
const STRIP = 26;     // 收起后细边的厚度
const STRIP_LEN = 112; // 收起后细边的长度
const STRIP_GAP = 6;   // 同一条边上多条细边之间的间距

/* 贴边状态存在哪：便笺本在 settings.dock，桌面便笺在各自的 stickies[id].dock */
function getDockRecord(ctx) {
  if (ctx.kind === 'main') return store.settings.dock || null;
  const rec = store.settings.stickies[ctx.noteId];
  return (rec && rec.dock) || null;
}
function setDockRecord(ctx, edge) {
  if (ctx.kind === 'main') {
    store.settings.dock = edge;
    store.settings.bounds = fullBounds(ctx);
  } else {
    const rec = store.settings.stickies[ctx.noteId];
    if (rec) { rec.dock = edge || undefined; Object.assign(rec, fullBounds(ctx)); }
  }
  scheduleStoreSave();
}

/* 用户自己设的置顶（便笺本看设置，桌面便笺各自记） */
function userOnTop(ctx) {
  if (ctx.kind === 'main') return !!store.settings.alwaysOnTop;
  const rec = store.settings.stickies[ctx.noteId];
  return !rec || rec.onTop !== false;
}

/* 贴边期间强制用更高的置顶层级：收起的细边要一直露在屏幕边上，被浏览器等窗口盖住就没法碰到了；
   取消贴边后恢复用户自己的置顶设置 */
function applyOnTop(ctx) {
  if (ctx.win.isDestroyed()) return;
  if (ctx.dock) {
    ctx.win.setAlwaysOnTop(true, 'screen-saver');
    ctx.win.moveTop();
  } else {
    ctx.win.setAlwaysOnTop(userOnTop(ctx), 'floating');
  }
}

function hasDisplayBeyond(x, y) {
  return screen.getAllDisplays().some(d => {
    const b = d.bounds;
    return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
  });
}

function workAreaOf(ctx) {
  return screen.getDisplayMatching(fullBounds(ctx)).workArea;
}

/* 拖动结束时调用：卡片贴到屏幕左/右/上边缘则进入贴边状态，否则退出 */
function tryDock(ctx) {
  if (store.settings.dockEnabled === false) return false;
  const { x, y } = ctx.pos;
  const { width: w, height: h } = ctx.size;
  const wa = workAreaOf(ctx);
  const cy = y + h / 2;
  const cx = x + w / 2;
  let edge = null;
  // 与另一块屏幕相邻的边不收起，否则跨屏拖动时会被“吸住”
  if (x + GUTTER <= wa.x + 4 && !hasDisplayBeyond(wa.x - 8, cy)) edge = 'left';
  else if (x + w - GUTTER >= wa.x + wa.width - 4 && !hasDisplayBeyond(wa.x + wa.width + 8, cy)) edge = 'right';
  else if (y + GUTTER <= wa.y + 4 && !hasDisplayBeyond(cx, wa.y - 8)) edge = 'top';

  if (!edge) {
    if (ctx.dock) undock(ctx);
    return false;
  }
  // 吸附：卡片正好贴住屏幕边缘，另一方向限制在工作区内
  if (edge === 'left') ctx.pos.x = wa.x - GUTTER;
  if (edge === 'right') ctx.pos.x = wa.x + wa.width - w + GUTTER;
  if (edge === 'top') ctx.pos.y = wa.y - GUTTER;
  if (edge !== 'top') ctx.pos.y = Math.min(Math.max(ctx.pos.y, wa.y - GUTTER), wa.y + wa.height - h + GUTTER);
  else ctx.pos.x = Math.min(Math.max(ctx.pos.x, wa.x - GUTTER), wa.x + wa.width - w + GUTTER);
  setCtxBounds(ctx, fullBounds(ctx));

  ctx.dock = { edge };
  ctx.collapsed = false;
  setDockRecord(ctx, edge);
  applyOnTop(ctx);
  sendDockState(ctx);
  startDockWatch(ctx);
  return true;
}

function undock(ctx) {
  if (ctx.collapsed) expand(ctx);
  ctx.dock = null;
  stopDockWatch(ctx);
  setDockRecord(ctx, null);
  applyOnTop(ctx);
  sendDockState(ctx);
}

function stripBounds(ctx) {
  const wa = workAreaOf(ctx);
  const f = fullBounds(ctx);
  const edge = ctx.dock.edge;
  const vertical = edge !== 'top';
  const len = vertical ? STRIP_LEN : STRIP_LEN + 40;
  const lo = vertical ? wa.y : wa.x;
  const hi = (vertical ? wa.y + wa.height : wa.x + wa.width) - len;
  const clamp = (v) => Math.min(Math.max(v, lo), hi);
  let start = clamp(vertical ? f.y + GUTTER + 28 : f.x + GUTTER + 36);

  // 同一条边上已经收起的其他细边：避开它们，依次往后排，不叠在一起
  const taken = allWindows()
    .filter(c => c !== ctx && c.collapsed && c.dock && c.dock.edge === edge && workAreaOf(c).x === wa.x && workAreaOf(c).y === wa.y)
    .map(c => { const b = c.win.getBounds(); return vertical ? [b.y, b.y + b.height] : [b.x, b.x + b.width]; })
    .sort((a, b) => a[0] - b[0]);
  const overlaps = (s) => taken.find(([a, b]) => s < b + STRIP_GAP && s + len + STRIP_GAP > a);
  for (let i = 0; i < taken.length + 1; i++) {
    const hit = overlaps(start);
    if (!hit) break;
    start = hit[1] + STRIP_GAP;
    if (start > hi) { start = clamp(lo); } // 排到底了就从头找空位
  }
  start = clamp(start);

  switch (edge) {
    case 'left': return { x: wa.x, y: start, width: STRIP, height: len };
    case 'right': return { x: wa.x + wa.width - STRIP, y: start, width: STRIP, height: len };
    default: return { x: start, y: wa.y, width: len, height: STRIP };
  }
}

function collapse(ctx) {
  if (!ctx.dock || ctx.collapsed) return;
  ctx.collapsed = true;
  sendDockState(ctx); // 先让页面切到“细边”样式，避免缩小时闪出内容
  ctx.win.setIgnoreMouseEvents(false);
  ctx.win.setMinimumSize(1, 1); // 否则会被窗口最小尺寸撑大，收不成细边
  setCtxBounds(ctx, stripBounds(ctx));
  applyOnTop(ctx);
}

function expand(ctx) {
  if (!ctx.collapsed) return;
  ctx.collapsed = false;
  ctx.outSince = 0;
  ctx.win.setMinimumSize(ctx.minSize.width, ctx.minSize.height);
  setCtxBounds(ctx, fullBounds(ctx));
  ctx.win.setIgnoreMouseEvents(true, { forward: true });
  sendDockState(ctx);
}

function sendDockState(ctx) {
  if (ctx.win.isDestroyed()) return;
  ctx.win.webContents.send('dock:state', ctx.dock ? { edge: ctx.dock.edge, collapsed: ctx.collapsed } : null);
}

/* 透明窗口在鼠标离开后收不到事件，所以由主进程轮询光标位置决定展开/收起 */
function startDockWatch(ctx) {
  if (ctx.dockTimer) return;
  ctx.dockTimer = setInterval(() => {
    if (ctx.win.isDestroyed() || !ctx.dock || !ctx.win.isVisible() || ctx.dragging) return;
    const p = screen.getCursorScreenPoint();
    const b = ctx.win.getBounds();
    const inset = ctx.collapsed ? 0 : GUTTER;
    const inside = p.x >= b.x + inset && p.x < b.x + b.width - inset && p.y >= b.y + inset && p.y < b.y + b.height - inset;
    if (ctx.collapsed) {
      if (inside) { expand(ctx); applyOnTop(ctx); return; }
      // 别的置顶窗口（如全屏浏览器）被激活后可能压在细边上面，隔一会儿把细边提回最上层
      if (Date.now() - (ctx.lastRaise || 0) > 1500) { ctx.lastRaise = Date.now(); ctx.win.moveTop(); }
      return;
    }
    if (inside || ctx.menuOpen) { ctx.outSince = 0; return; }
    if (!ctx.outSince) ctx.outSince = Date.now();
    // 窗口有焦点（正在打字）时不因鼠标移开而收起，失去焦点后再收
    if (!ctx.win.isFocused() && Date.now() - ctx.outSince > 450) collapse(ctx);
  }, 120);
}

function stopDockWatch(ctx) {
  clearInterval(ctx.dockTimer);
  ctx.dockTimer = null;
}

/* ============ 显示 / 隐藏 ============ */
function allWindows() {
  return [...wins.values()].filter(c => !c.win.isDestroyed());
}

function toggleWindow() {
  if (mainCtx.win.isVisible() && !mainCtx.collapsed) hideAll();
  else showWindow();
}

function hideAll() {
  allWindows().forEach(c => c.win.hide());
}

function showWindow() {
  if (mainCtx.collapsed) expand(mainCtx);
  allWindows().forEach(c => { if (c !== mainCtx && !c.win.isVisible()) c.win.showInactive(); });
  mainCtx.win.show();
  mainCtx.win.focus();
  if (mainCtx.win.isAlwaysOnTop()) mainCtx.win.moveTop();
}

/* 把主窗口放回主屏中央（位置丢失时的兜底） */
function recenterWindow() {
  if (mainCtx.dock) undock(mainCtx);
  const wa = screen.getPrimaryDisplay().workArea;
  const { width, height } = mainCtx.size;
  mainCtx.pos = {
    x: wa.x + Math.round((wa.width - width) / 2),
    y: wa.y + Math.round((wa.height - height) / 2)
  };
  setCtxBounds(mainCtx, fullBounds(mainCtx));
  showWindow();
}

/* ============ 全局快捷键 ============ */
function prettyHotkey(acc) {
  return String(acc || '')
    .replace('CommandOrControl', 'Ctrl')
    .replace('Control', 'Ctrl')
    .replace('Command', 'Cmd');
}

/* 按顺序尝试注册，冲突时回退到备用组合；只注销本组自己的快捷键 */
function registerWithFallback(preferred, candidates, handler, prev) {
  if (prev && prev.ok) {
    try { globalShortcut.unregister(prev.acc); } catch (_) { /* ignore */ }
  }
  const list = [];
  if (preferred) list.push(preferred);
  candidates.forEach(acc => { if (!list.includes(acc)) list.push(acc); });
  for (const acc of list) {
    try {
      if (globalShortcut.register(acc, handler)) {
        console.log('[hotkey] registered:', acc);
        return { acc, ok: true };
      }
      console.warn('[hotkey] occupied, try next:', acc);
    } catch (e) {
      console.error('[hotkey] register error:', acc, e.message);
    }
  }
  return { acc: preferred || candidates[0], ok: false };
}

const HOTKEY_CANDIDATES = ['CommandOrControl+Alt+Space', 'CommandOrControl+Shift+Space', 'CommandOrControl+Alt+F9'];
const CAPTURE_CANDIDATES = ['CommandOrControl+Alt+C', 'CommandOrControl+Shift+Alt+C', 'CommandOrControl+Alt+F10'];
let hotkeyInfo = { acc: HOTKEY_CANDIDATES[0], ok: false };
let captureInfo = { acc: CAPTURE_CANDIDATES[0], ok: false };

function registerHotkey(preferred) {
  hotkeyInfo = registerWithFallback(preferred, HOTKEY_CANDIDATES, () => toggleWindow(), hotkeyInfo);
  return hotkeyInfo;
}

/* 设置里改快捷键：只尝试这一个组合，失败（被占用 / 与另一个重复 / 写法不对）就保留原来的 */
function setHotkey(which, acc) {
  const isToggle = which === 'toggle';
  const cur = isToggle ? hotkeyInfo : captureInfo;
  const other = isToggle ? captureInfo : hotkeyInfo;
  const handler = isToggle ? () => toggleWindow() : () => { quickCapture(); };
  const target = acc || (isToggle ? HOTKEY_CANDIDATES[0] : CAPTURE_CANDIDATES[0]); // 空 = 恢复默认
  if (target === cur.acc && cur.ok) return { ok: true, info: cur };
  if (other.ok && other.acc === target) return { ok: false, reason: 'duplicate', info: cur };
  if (cur.ok) { try { globalShortcut.unregister(cur.acc); } catch (_) { /* ignore */ } }
  let ok = false;
  try { ok = globalShortcut.register(target, handler); } catch (_) { ok = false; }
  if (!ok) {
    if (cur.ok) { try { globalShortcut.register(cur.acc, handler); } catch (_) { /* ignore */ } }
    return { ok: false, reason: 'occupied', info: cur };
  }
  const info = { acc: target, ok: true };
  if (isToggle) { hotkeyInfo = info; store.settings.hotkey = target; }
  else { captureInfo = info; store.settings.captureHotkey = target; }
  scheduleStoreSave();
  rebuildTrayMenu();
  broadcast('hotkey:changed', Object.assign({}, hotkeyInfo, { capture: captureInfo }));
  return { ok: true, info };
}

/* 录制新快捷键期间暂停全局快捷键，否则按到现有组合会直接触发（比如把窗口隐藏掉） */
let hotkeysSuspended = false;
function suspendHotkeys(on) {
  if (on === hotkeysSuspended) return;
  hotkeysSuspended = on;
  if (on) {
    globalShortcut.unregisterAll();
  } else {
    const re = (info, handler) => { if (info.ok) { try { globalShortcut.register(info.acc, handler); } catch (_) { /* ignore */ } } };
    re(hotkeyInfo, () => toggleWindow());
    re(captureInfo, () => { quickCapture(); });
  }
}

/* ============ 开机自启动 ============
   Windows / macOS 用系统登录项；Linux 在 ~/.config/autostart 写 .desktop 文件。
   开发模式（未打包）下要把项目路径作为参数一起登记，否则开机启动的是一个空的 Electron。 */
function loginItemOptions() {
  const args = app.isPackaged ? [] : [path.resolve(app.getAppPath())];
  return { path: process.execPath, args };
}

function linuxAutostartFile() {
  const dir = process.env.FLOATNOTE_AUTOSTART_DIR ||
    path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart');
  return path.join(dir, 'floatnote.desktop');
}

function getAutoLaunch() {
  try {
    if (process.platform === 'linux') return fs.existsSync(linuxAutostartFile());
    return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
  } catch (_) {
    return false;
  }
}

function setAutoLaunch(on) {
  try {
    if (process.platform === 'linux') {
      const file = linuxAutostartFile();
      if (on) {
        const exe = process.env.APPIMAGE || process.execPath; // AppImage 要登记 AppImage 本身
        const q = (v) => '"' + String(v).replace(/(["\\`$])/g, '\\$1') + '"';
        const exec = [exe, ...loginItemOptions().args].map(q).join(' ');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, ['[Desktop Entry]', 'Type=Application', 'Name=FloatNote', 'Comment=桌面便签', `Exec=${exec}`, 'X-GNOME-Autostart-enabled=true', ''].join('\n'));
      } else if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } else {
      app.setLoginItemSettings(Object.assign({ openAtLogin: !!on }, loginItemOptions()));
    }
  } catch (e) {
    console.error('[autoLaunch]', e.message);
  }
  return getAutoLaunch();
}

function registerCaptureHotkey(preferred) {
  captureInfo = registerWithFallback(preferred, CAPTURE_CANDIDATES, () => { quickCapture(); }, captureInfo);
  return captureInfo;
}

/* ============ 快速捕捉：在任意程序里选中文字，按快捷键追加到当前便笺 ============ */
/* Windows：先记下前台窗口标题，等用户松开 Ctrl/Alt/Shift 后模拟 Ctrl+C 复制选中内容。
   其他系统：直接使用剪贴板里已有的文字（先 Ctrl+C，再按捕捉快捷键）。 */
const CAPTURE_PS1 = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "Add-Type -Namespace FloatNote -Name U32 -MemberDefinition @'",
  '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);',
  '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);',
  "'@",
  '$h = [FloatNote.U32]::GetForegroundWindow()',
  '$sb = New-Object System.Text.StringBuilder 512',
  '[void][FloatNote.U32]::GetWindowText($h, $sb, 512)',
  '$procId = 0',
  '[void][FloatNote.U32]::GetWindowThreadProcessId($h, [ref]$procId)',
  "$name = ''",
  'try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}',
  '# 等快捷键的修饰键松开，否则模拟的 Ctrl+C 会变成 Ctrl+Alt+C',
  '$t = 0',
  'while (((([FloatNote.U32]::GetAsyncKeyState(0x11) -band 0x8000) -ne 0) -or (([FloatNote.U32]::GetAsyncKeyState(0x12) -band 0x8000) -ne 0) -or (([FloatNote.U32]::GetAsyncKeyState(0x10) -band 0x8000) -ne 0)) -and $t -lt 60) { Start-Sleep -Milliseconds 25; $t++ }',
  'Add-Type -AssemblyName System.Windows.Forms',
  "[System.Windows.Forms.SendKeys]::SendWait('^c')",
  'Write-Output ($name + "`t" + $sb.ToString())'
].join('\r\n');

let capturePs1Path = null;
function ensureCaptureScript() {
  if (capturePs1Path && fs.existsSync(capturePs1Path)) return capturePs1Path;
  capturePs1Path = path.join(os.tmpdir(), 'floatnote-capture.ps1');
  // 带 BOM 的 UTF-8，Windows PowerShell 5 才能正确识别中文注释
  fs.writeFileSync(capturePs1Path, '﻿' + CAPTURE_PS1, 'utf-8');
  return capturePs1Path;
}

function runCaptureHelper() {
  return new Promise((resolve) => {
    try {
      execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ensureCaptureScript()],
        { windowsHide: true, timeout: 5000 },
        (err, stdout) => {
          if (err) { console.warn('[capture] helper failed:', err.message); resolve(null); return; }
          const line = String(stdout || '').trim().split(/\r?\n/).pop() || '';
          const [proc, ...rest] = line.split('\t');
          resolve({ process: proc || '', title: rest.join('\t').trim() });
        });
    } catch (e) {
      console.warn('[capture] helper error:', e.message);
      resolve(null);
    }
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let capturing = false;

async function quickCapture() {
  if (capturing) return;
  capturing = true;
  try {
    let before = '';
    let savedItems = null;
    try { before = await clipboard.readText(); } catch (_) { /* ignore */ }
    try { savedItems = await clipboard.read(); } catch (_) { /* ignore */ }

    let text = '';
    let source = '';
    let copied = false;
    if (process.platform === 'win32') {
      const fg = await runCaptureHelper();
      if (fg) source = fg.title || fg.process || '';
      if (/^FloatNote$/i.test(fg && fg.title)) source = '';
      for (let i = 0; i < 16; i++) {
        await sleep(50);
        let now = '';
        try { now = await clipboard.readText(); } catch (_) { /* ignore */ }
        if (now && now !== before) { text = now; copied = true; break; }
      }
    }
    if (!copied) text = before; // 没有选中内容 / 非 Windows：用剪贴板已有的文字
    // 模拟复制改动了剪贴板：捕捉完把原内容放回去
    if (copied && savedItems && savedItems.length) {
      try { await clipboard.write(savedItems); } catch (_) { /* ignore */ }
    }

    text = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!text) {
      notify('没有可捕捉的文字', '先在其他程序里选中文字，再按 ' + prettyHotkey(captureInfo.ok ? captureInfo.acc : '') + '。');
      return;
    }
    if (text.length > 5000) text = text.slice(0, 5000) + '…';
    const payload = { text, source: source.slice(0, 80), at: Date.now(), fromClipboard: !copied };
    if (mainCtx && !mainCtx.win.isDestroyed()) mainCtx.win.webContents.send('capture:add', payload);
    if (!mainCtx.win.isVisible() || mainCtx.collapsed) {
      const preview = text.length > 40 ? text.slice(0, 40) + '…' : text;
      notify('已捕捉到便笺', preview);
    }
  } finally {
    capturing = false;
  }
}

function notify(title, content) {
  try {
    if (process.platform === 'win32' && tray) {
      tray.displayBalloon({ title, content });
    } else if (Notification.isSupported()) {
      new Notification({ title, body: content, silent: true }).show();
    }
  } catch (e) {
    console.warn('[notify]', e.message);
  }
}

/* ============ 自动更新：从 GitHub Releases 下载新版本 ============
   安装版启动 15 秒后、之后每 6 小时检查一次；有新版本就在后台下载，下载完提示「重启更新」，
   不点的话下次退出时自动安装。开发版（pnpm start）和便携版不能自动更新。 */
let autoUpdater = null;
const updateState = { status: 'idle', version: null, percent: 0, error: null };
// status：dev / portable / unsupported / idle / checking / downloading / ready / latest / error

function setUpdateState(patch) {
  Object.assign(updateState, patch);
  broadcast('update:state', Object.assign({}, updateState));
  rebuildTrayMenu();
}

function initAutoUpdate() {
  if (!app.isPackaged || process.env.FLOATNOTE_DISABLE_UPDATE) { updateState.status = 'dev'; return; }
  if (process.env.PORTABLE_EXECUTABLE_FILE) { updateState.status = 'portable'; return; }
  if (process.platform === 'linux' && !process.env.APPIMAGE) { updateState.status = 'unsupported'; return; }
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    updateState.status = 'error';
    updateState.error = e.message;
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => setUpdateState({ status: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.floor(p.percent || 0);
    if (percent !== updateState.percent) setUpdateState({ status: 'downloading', percent });
  });
  autoUpdater.on('update-not-available', () => setUpdateState({ status: 'latest' }));
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({ status: 'ready', version: info.version, percent: 100 });
    notify('FloatNote 新版本已就绪', `v${info.version} 已下载，重启即可更新（不重启的话下次退出时自动安装）`);
  });
  autoUpdater.on('error', (e) => onUpdateError(e));
  setTimeout(checkForUpdate, 15000);
  setInterval(checkForUpdate, 6 * 3600 * 1000);
}

function checkForUpdate() {
  if (!autoUpdater || ['checking', 'downloading', 'ready'].includes(updateState.status)) return Object.assign({}, updateState);
  autoUpdater.checkForUpdates().catch(onUpdateError);
  return Object.assign({}, updateState, { status: 'checking' });
}

function onUpdateError(e) {
  const msg = String((e && e.message) || e);
  // 仓库里还没发布过任何版本：不算失败
  if (/No published versions/i.test(msg)) { setUpdateState({ status: 'latest', error: null }); return; }
  setUpdateState({ status: 'error', error: msg.split('\n')[0].slice(0, 300) });
}

function installUpdate() {
  if (!autoUpdater || updateState.status !== 'ready') return false;
  isQuitting = true;
  flushStore();
  autoUpdater.quitAndInstall(false, true); // 静默安装后自动重新打开
  return true;
}

/* ============ 托盘 ============ */
function createTray() {
  // Windows 用 .ico：里面有 16–256 各尺寸单独渲染的图，系统按显示缩放挑最清晰的那张
  const icon = nativeImage.createFromPath(process.platform === 'win32' ? APP_ICON : path.join(ASSETS, 'icon-32.png'));
  tray = new Tray(icon);
  tray.setToolTip('FloatNote 便签');
  rebuildTrayMenu();
  tray.on('click', () => toggleWindow());
  tray.on('double-click', () => showWindow());
}

function rebuildTrayMenu() {
  if (!tray) return;
  const backups = listBackups();
  const menu = Menu.buildFromTemplate([
    { label: hotkeyInfo.ok ? '快捷键 ' + prettyHotkey(hotkeyInfo.acc) : '快捷键注册失败', enabled: false },
    { label: captureInfo.ok ? '快速捕捉 ' + prettyHotkey(captureInfo.acc) : '快速捕捉快捷键注册失败', enabled: false },
    { type: 'separator' },
    { label: '显示 / 隐藏便签', click: () => toggleWindow() },
    { label: '新建便签', click: () => { showWindow(); mainCtx.win.webContents.send('cmd:new-note'); } },
    { label: '找回窗口（移到屏幕中央）', click: () => recenterWindow() },
    ...(updateState.status === 'ready'
      ? [{ type: 'separator' }, { label: `重启并更新到 v${updateState.version}`, click: () => installUpdate() }]
      : []),
    { type: 'separator' },
    {
      label: '从备份恢复',
      submenu: backups.length
        ? backups.map(b => ({ label: b.label, click: () => restoreBackup(b) }))
        : [{ label: '还没有备份（每天首次启动时自动备份）', enabled: false }]
    },
    { label: '打开数据文件夹', click: () => shell.openPath(dataDir) },
    { type: 'separator' },
    { label: '退出 FloatNote', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}

/* ============ IPC ============ */
function registerIpc() {
  ipcMain.handle('data:load', () => store);
  ipcMain.handle('data:patch', (e, patch) => {
    if (restoring) return false;
    applyPatch(patch);
    scheduleStoreSave();
    broadcast('data:patched', patch, e.sender.id);
    return true;
  });

  ipcMain.handle('shell:openExternal', (e, url) => {
    // 只放行网页和邮件链接，避免便笺内容里混进 file: / 自定义协议被执行
    if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) return shell.openExternal(url);
    return false;
  });

  ipcMain.handle('win:context', (e) => {
    const ctx = ctxOf(e);
    if (!ctx) return { kind: 'main' };
    return {
      kind: ctx.kind,
      noteId: ctx.noteId,
      onTop: ctx.win.isAlwaysOnTop(),
      dock: ctx.dock ? { edge: ctx.dock.edge, collapsed: ctx.collapsed } : null,
      stickies: Object.keys(store.settings.stickies)
    };
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
    return `fnimg://${String(noteId).toLowerCase()}/${id + ext}`;
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
    const ctx = ctxOf(e);
    if (!ctx) return false;
    // 记下用户的选择；贴边期间仍保持最上层，取消贴边后按这个选择来
    if (ctx.kind === 'sticky' && store.settings.stickies[ctx.noteId]) {
      store.settings.stickies[ctx.noteId].onTop = !!v;
      scheduleStoreSave();
    } else if (ctx.kind === 'main') {
      store.settings.alwaysOnTop = !!v;
    }
    applyOnTop(ctx);
    return !!v;
  });
  ipcMain.handle('win:hide', (e) => {
    const ctx = ctxOf(e);
    if (!ctx) return;
    // 只隐藏发起的这个窗口：桌面便笺不跟着便笺本一起消失（全局快捷键才会一起显示 / 隐藏）
    ctx.win.hide();
    // 首次隐藏时提示如何唤回，避免用户以为窗口“消失”了
    if (!hideHintShown && tray) {
      hideHintShown = true;
      notify('FloatNote 已隐藏', '按 ' + (hotkeyInfo.ok ? prettyHotkey(hotkeyInfo.acc) : '全局快捷键') + ' 或点击托盘图标即可唤回');
    }
  });
  ipcMain.handle('win:minimize', (e) => { const c = ctxOf(e); if (c) c.win.minimize(); });
  ipcMain.handle('win:close', (e) => { const c = ctxOf(e); if (c) c.win.hide(); });
  ipcMain.handle('win:resize', (e, { width, height }) => {
    const ctx = ctxOf(e);
    if (!ctx || ctx.collapsed) return;
    const minW = ctx.kind === 'sticky' ? 240 : 300;
    const minH = ctx.kind === 'sticky' ? 180 : 260;
    ctx.size = { width: Math.max(minW, Math.round(width)), height: Math.max(minH, Math.round(height)) };
    setCtxBounds(ctx, fullBounds(ctx));
  });
  // 注意：Windows 在非整数缩放（如 150%）下，setPosition 会让窗口尺寸逐次 +1px 漂移，
  // 因此移动时显式带上稳定的宽高，并用自维护的坐标累加，避免“越拖越大”。
  ipcMain.handle('win:moveBy', (e, { dx, dy }) => {
    const ctx = ctxOf(e);
    if (!ctx || ctx.collapsed) return;
    ctx.pos = { x: ctx.pos.x + Math.round(dx), y: ctx.pos.y + Math.round(dy) };
    setCtxBounds(ctx, fullBounds(ctx));
  });
  ipcMain.handle('win:dragStart', (e) => { const c = ctxOf(e); if (c) c.dragging = true; });
  ipcMain.handle('win:dragEnd', (e) => {
    const ctx = ctxOf(e);
    if (!ctx) return;
    ctx.dragging = false;
    // 以窗口实际位置为准再判断（位置可能被系统或其他途径改过，自维护的坐标未必同步）
    if (!ctx.collapsed) { const b = ctx.win.getBounds(); ctx.pos = { x: b.x, y: b.y }; }
    tryDock(ctx);
  });
  ipcMain.handle('win:menuOpen', (e, open) => { const c = ctxOf(e); if (c) c.menuOpen = !!open; });
  ipcMain.handle('win:setIgnoreMouse', (e, ignore) => {
    const ctx = ctxOf(e);
    if (!ctx || ctx.collapsed) return false;
    ctx.win.setIgnoreMouseEvents(!!ignore, { forward: true });
    return !!ignore;
  });
  ipcMain.handle('win:registerHotkey', (e, acc) => registerHotkey(acc));
  ipcMain.handle('win:getHotkey', () => Object.assign({}, hotkeyInfo, { capture: captureInfo }));
  ipcMain.handle('hotkey:set', (e, { which, acc }) => setHotkey(which, acc));
  ipcMain.handle('hotkey:suspend', (e, on) => suspendHotkeys(!!on));
  ipcMain.handle('app:getAutoLaunch', () => getAutoLaunch());
  ipcMain.handle('app:info', () => ({ version: app.getVersion() }));
  ipcMain.handle('data:getDir', () => ({ dir: dataDir, isDefault: !isCustomDataDir() }));
  ipcMain.handle('data:pickDir', (e) => pickDataDir(BrowserWindow.fromWebContents(e.sender), false));
  ipcMain.handle('data:resetDir', (e) => pickDataDir(BrowserWindow.fromWebContents(e.sender), true));
  ipcMain.handle('data:setDir', (e, { dir, mode }) => changeDataDir(dir, mode)); // 不弹窗的版本（测试用）
  ipcMain.handle('data:openDir', () => shell.openPath(dataDir));
  ipcMain.handle('update:get', () => Object.assign({}, updateState));
  ipcMain.handle('update:check', () => checkForUpdate());
  ipcMain.handle('update:install', () => installUpdate());
  ipcMain.handle('app:setAutoLaunch', (e, on) => setAutoLaunch(!!on));
  ipcMain.handle('win:quit', () => { isQuitting = true; app.quit(); });

  ipcMain.handle('dock:expand', (e) => { const c = ctxOf(e); if (c) expand(c); });
  ipcMain.handle('dock:setEnabled', (e, on) => {
    store.settings.dockEnabled = !!on;
    if (!on) allWindows().forEach(c => { if (c.dock) undock(c); });
    scheduleStoreSave();
  });

  ipcMain.handle('sticky:open', (e, { noteId, x, y }) => {
    const at = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    return openSticky(noteId, at);
  });
  ipcMain.handle('sticky:close', (e, noteId) => {
    const ctx = ctxOf(e);
    closeSticky(noteId || (ctx && ctx.noteId));
    if (mainCtx && ctx !== mainCtx && !mainCtx.win.isVisible()) showWindow();
  });
  ipcMain.handle('sticky:focus', (e, noteId) => openSticky(noteId));
}

/* ============ 启动 ============ */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    store = loadData();
    purgeOldTrash();
    registerImageProtocol();
    registerIpc();
    createMainWindow();
    restoreStickies();
    registerHotkey(store.settings.hotkey || HOTKEY_CANDIDATES[0]);
    registerCaptureHotkey(store.settings.captureHotkey || CAPTURE_CANDIDATES[0]);
    createTray();
    dailyBackup();
    setInterval(dailyBackup, 3 * 3600 * 1000); // 跨天不关机也会备份
    initAutoUpdate();
    if (!fs.existsSync(dataFile)) flushStore(); // 首次运行：先落一份，便于监视
    startDataWatch();
    if (isCustomDataDir()) mergeConflictCopies();
    setTimeout(cleanupImages, Number(process.env.FLOATNOTE_CLEANUP_DELAY) || 15000);
    if (recoveredFrom) notify('数据文件损坏，已自动恢复', `已从 ${recoveredFrom} 的备份恢复。损坏的文件已改名保留在数据文件夹中。`);
  });

  // 退出前兜底保存窗口位置与数据
  app.on('before-quit', () => {
    isQuitting = true;
    try {
      if (mainCtx && !mainCtx.win.isDestroyed()) store.settings.bounds = fullBounds(mainCtx);
      for (const ctx of wins.values()) {
        if (ctx.kind === 'sticky' && store.settings.stickies[ctx.noteId]) {
          Object.assign(store.settings.stickies[ctx.noteId], fullBounds(ctx));
        }
      }
    } catch (e) {
      console.error('[quit:saveBounds]', e.message);
    }
    flushStore();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  // 失去焦点（比如录制快捷键时切走了）也要恢复全局快捷键
  app.on('browser-window-blur', () => suspendHotkeys(false));

  app.on('window-all-closed', () => {
    // 保持常驻（由托盘退出）
  });
}
