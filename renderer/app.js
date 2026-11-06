'use strict';

/* ============ 全局状态 ============ */
const state = {
  notes: [],
  settings: null,
  activeId: null,
  stuck: new Set() // 已贴到桌面的便笺
};

/* 窗口模式：main = 便笺本（可切换多张）；sticky = 贴在桌面上的单张便笺 */
const params = new URLSearchParams(location.search);
const MODE = params.get('mode') === 'sticky' ? 'sticky' : 'main';
const STICKY_ID = params.get('note');
const IS_STICKY = MODE === 'sticky';
document.body.classList.add('mode-' + MODE);

/* ============ DOM 引用 ============ */
const el = {
  card: document.getElementById('card'),
  cardWrap: document.getElementById('card-wrap'),
  btnStick: document.getElementById('btn-stick'),
  dockTab: document.getElementById('dock-tab'),
  dockTitle: document.getElementById('dock-title'),
  smPaper: document.getElementById('sm-paper'),
  smAppearance: document.getElementById('sm-appearance'),
  smDock: document.getElementById('sm-dock'),
  smCaptureHint: document.getElementById('sm-capture-hint'),
  toolbar: document.getElementById('toolbar'),
  switcher: document.getElementById('note-switcher'),
  noteTitleEl: document.getElementById('note-title'),
  switcherMenu: document.getElementById('switcher-menu'),
  editor: document.getElementById('editor'),
  tagBar: document.getElementById('tag-bar'),
  settingsMenu: document.getElementById('settings-menu'),
  btnNew: document.getElementById('btn-new'),
  btnDelete: document.getElementById('btn-delete'),
  btnSettings: document.getElementById('btn-settings'),
  btnPin: document.getElementById('btn-pin'),
  btnHide: document.getElementById('btn-hide'),
  btnClose: document.getElementById('btn-close'),
  resizeGrip: document.getElementById('resize-grip'),
  smOpacity: document.getElementById('sm-opacity'),
  smAlwaysOnTop: document.getElementById('sm-always-on-top'),
  smHotkeyHint: document.getElementById('sm-hotkey-hint'),
  smSwatches: document.getElementById('sm-swatches'),
  smFontSize: document.getElementById('sm-font-size'),
  smFontVal: document.getElementById('sm-font-val'),
  smAutohide: document.getElementById('sm-autohide'),
  statusBar: document.getElementById('status-bar')
};

const THEMES = ['glass', 'yellow', 'mint', 'pink', 'kraft', 'dark'];
const PAPERS = ['plain', 'lines', 'grid', 'dots', 'fold'];

const currentNote = () => state.notes.find(n => n.id === state.activeId) || null;

/* ============ 工具函数 ============ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function stripHtml(html) {
  const div = document.createElement('div');
  // 块级元素与换行先转成 \n，否则多行内容会被拼成一行
  div.innerHTML = String(html || '').replace(/<(br|div|p|li|h\d|ul|ol)\b[^>]*>/gi, '\n$&');
  return div.textContent || '';
}

function clip(s, n) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function noteLines(note) {
  return stripHtml(note.content).split('\n').map(s => s.trim()).filter(Boolean);
}

/* 自动标题：正文第一行，无内容时为“空便笺” */
function autoTitle(note) {
  const first = noteLines(note)[0];
  return first ? clip(first, 18) : '空便笺';
}

/* 显示标题：用户重命名过的优先，否则用自动标题 */
function noteTitle(note) {
  const custom = (note.title || '').trim();
  return custom ? clip(custom, 24) : autoTitle(note);
}

/* 没有标题、标签、文字和图片的便笺视为空便笺 */
function isNoteEmpty(note) {
  if (!note) return false;
  if ((note.title || '').trim() || (note.tags && note.tags.length)) return false;
  const html = String(note.content || '');
  if (/<(img|input)\b/i.test(html)) return false;
  return !stripHtml(html).replace(/\u00a0/g, ' ').trim();
}

/* 移除空便笺（保留 keepId 对应的那张，且至少留一张） */
function pruneEmptyNotes(keepId) {
  const kept = state.notes.filter(n => n.id === keepId || state.stuck.has(n.id) || !isNoteEmpty(n));
  if (kept.length && kept.length !== state.notes.length) {
    state.notes = kept;
    return true;
  }
  return false;
}

/* 菜单副标题：正文预览 · 待办进度 · 首个标签 */
function noteSubtitle(note) {
  const parts = [];
  const lines = noteLines(note);
  const preview = (note.title || '').trim() ? lines[0] : lines[1];
  if (preview) parts.push(clip(preview, 22));
  const div = document.createElement('div');
  div.innerHTML = note.content || '';
  const boxes = div.querySelectorAll('input[type="checkbox"]');
  if (boxes.length) {
    const done = [...boxes].filter(b => b.hasAttribute('checked')).length;
    parts.push(`待办 ${done}/${boxes.length}`);
  }
  if (div.querySelector('img')) parts.push('图片');
  if (note.tags && note.tags.length) parts.push('#' + note.tags[0] + (note.tags.length > 1 ? ` +${note.tags.length - 1}` : ''));
  return parts.join(' · ');
}

function relativeTime(ts) {
  const diff = Date.now() - (ts || 0);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  const d = new Date(ts);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

function applyGlass(v) {
  const g = Math.min(1, Math.max(0.2, Number(v) || 1));
  document.documentElement.style.setProperty('--glass', String(g));
}

function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

/* ============ 持久化：只把变化的字段发给主进程 ============
   多个窗口（便笺本 + 贴在桌面的便笺）共享同一份数据。每个窗口记住“上次同步时的样子”，
   保存时按字段比较，只发送改动；收到其他窗口的改动后合并进来。这样两个窗口不会互相覆盖。 */
const LOCAL_SETTINGS = new Set(['bounds', 'stickies', 'dock']); // 主进程维护的设置项
let baseline = { notes: new Map(), order: '', settings: {} };

function snapshot(obj, skip) {
  const o = {};
  for (const k of Object.keys(obj || {})) {
    if (skip && skip.has(k)) continue;
    if (obj[k] === undefined) continue;
    o[k] = JSON.stringify(obj[k]);
  }
  return o;
}

function rememberBaseline() {
  baseline = {
    notes: new Map(state.notes.map(n => [n.id, snapshot(n)])),
    order: state.notes.map(n => n.id).join(','),
    settings: snapshot(state.settings, LOCAL_SETTINGS)
  };
}

function diffFields(cur, prev, source) {
  const set = {};
  const unset = [];
  for (const k of Object.keys(cur)) if (cur[k] !== prev[k]) set[k] = source[k];
  for (const k of Object.keys(prev)) if (!(k in cur)) unset.push(k);
  return (Object.keys(set).length || unset.length) ? { set, unset } : null;
}

function buildPatch() {
  const upserts = [];
  const seen = new Set();
  for (const n of state.notes) {
    seen.add(n.id);
    const d = diffFields(snapshot(n), baseline.notes.get(n.id) || {}, n);
    if (d) upserts.push(Object.assign({ id: n.id }, d));
  }
  const deletes = [...baseline.notes.keys()].filter(id => !seen.has(id));
  const order = state.notes.map(n => n.id).join(',');
  const settings = diffFields(snapshot(state.settings, LOCAL_SETTINGS), baseline.settings, state.settings);
  if (!upserts.length && !deletes.length && order === baseline.order && !settings) return null;
  return {
    upserts,
    deletes,
    order: order !== baseline.order ? state.notes.map(n => n.id) : null,
    settings
  };
}

let saveTimer = null;
function scheduleSave(delay = 500) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, delay);
}

function persist() {
  clearTimeout(saveTimer);
  const note = currentNote();
  if (note) {
    saveCurrentContent();
    el.noteTitleEl.textContent = noteTitle(note);
    el.dockTitle.textContent = noteTitle(note);
    updateStatus();
  }
  const patch = buildPatch();
  if (!patch) return;
  rememberBaseline();
  window.api.patchData(patch);
}

/* 合并其他窗口发来的改动 */
function applyRemotePatch(p) {
  persist(); // 先把本窗口未发出的改动发出去，再合并
  const active = currentNote();
  let activeChanged = false;
  let activeContentChanged = false;

  for (const u of p.upserts || []) {
    let n = state.notes.find(x => x.id === u.id);
    if (!n) { n = { id: u.id }; state.notes.push(n); }
    Object.assign(n, u.set || {});
    (u.unset || []).forEach(k => { delete n[k]; });
    if (active && n.id === active.id) {
      activeChanged = true;
      if (u.set && 'content' in u.set) activeContentChanged = true;
    }
  }
  if (p.deletes && p.deletes.length) {
    const del = new Set(p.deletes);
    state.notes = state.notes.filter(n => !del.has(n.id));
  }
  if (Array.isArray(p.order)) {
    const rank = new Map(p.order.map((id, i) => [id, i]));
    state.notes.sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : 1e9) - (rank.has(b.id) ? rank.get(b.id) : 1e9));
  }
  if (p.settings) {
    Object.assign(state.settings, p.settings.set || {});
    (p.settings.unset || []).forEach(k => { delete state.settings[k]; });
    applySettings();
  }
  rememberBaseline();

  if (!currentNote()) {
    // 当前便笺在别处被删除了
    if (IS_STICKY) return;
    if (!state.notes.length) state.notes.push(blankNote());
    state.activeId = (state.notes.find(n => !state.stuck.has(n.id)) || state.notes[0]).id;
    state.settings.activeNoteId = state.activeId;
    loadActiveNote();
    scheduleSave(100);
  } else if (activeContentChanged) {
    loadActiveNote(false);
  } else if (activeChanged) {
    applyTheme(currentNote());
    renderTags();
    renderSwitcher();
    updateStatus();
  }
  if (!el.switcherMenu.classList.contains('hidden')) renderMenuItems();
}

function blankNote() {
  return { id: uid(), title: '', tags: [], content: '', createdAt: Date.now(), updatedAt: Date.now() };
}

/* ============ 便签 CRUD ============ */
function newNote() {
  saveCurrentContent();
  // 当前便笺还是空的就直接复用，避免攒出一串“空便笺”
  if (isNoteEmpty(currentNote())) {
    closeMenus();
    el.editor.focus();
    toast('当前便笺还是空的，直接写吧');
    return;
  }
  const note = blankNote();
  state.notes.unshift(note);
  state.activeId = note.id;
  renderSwitcher();
  loadActiveNote();
  el.editor.focus();
  scheduleSave(100);
}

/* 删除立即生效，5 秒内可从提示条撤销（图片文件不会被删，撤销后照常显示） */
function deleteNote() {
  saveCurrentContent();
  const note = currentNote();
  if (!note) return;
  const wasEmpty = isNoteEmpty(note);

  if (!wasEmpty) window.Life.tearOff(el.card); // 像便利贴一样被撕下来

  // 只剩一张（贴在桌面上的不算）时清空而非删除
  const rest = state.notes.filter(n => n !== note && !state.stuck.has(n.id));
  if (!rest.length) {
    const snapshot = { title: note.title, tags: [...(note.tags || [])], content: note.content, color: note.color, paper: note.paper, updatedAt: note.updatedAt };
    Object.assign(note, { title: '', tags: [], content: '' });
    loadActiveNote();
    scheduleSave(100);
    if (!wasEmpty) {
      toastAction('已清空', '撤销', () => {
        Object.assign(note, snapshot);
        loadActiveNote(false);
        window.Life.stickIn(el.card);
        scheduleSave(100);
      });
    }
    return;
  }

  const idx = state.notes.indexOf(note);
  state.notes.splice(idx, 1);
  const next = state.notes.slice(0, idx).reverse().find(n => !state.stuck.has(n.id)) || rest[0];
  state.activeId = next.id;
  state.settings.activeNoteId = state.activeId;
  loadActiveNote();
  scheduleSave(100);
  if (!wasEmpty) {
    toastAction('已删除「' + noteTitle(note) + '」', '撤销', () => {
      saveCurrentContent();
      state.notes.splice(Math.min(idx, state.notes.length), 0, note);
      state.activeId = note.id;
      state.settings.activeNoteId = note.id;
      loadActiveNote(false);
      window.Life.stickIn(el.card); // 贴回来
      scheduleSave(100);
    });
  }
}

/* ============ 贴到桌面 ============ */
/* 把便笺变成桌面上独立的小窗口；便笺本随即换到另一张 */
async function stickNote(id, x, y) {
  persist();
  const note = state.notes.find(n => n.id === id);
  if (!note) return;
  if (isNoteEmpty(note)) { toast('先写点什么再贴到桌面吧'); return; }
  const ok = await window.api.openSticky(id, x, y);
  if (!ok) return;
  state.stuck.add(id);
  if (id === state.activeId) {
    window.Life.tearOff(el.card);
    const other = displayOrder().find(n => !state.stuck.has(n.id));
    if (other) {
      state.activeId = other.id;
    } else {
      const fresh = blankNote();
      state.notes.unshift(fresh);
      state.activeId = fresh.id;
    }
    state.settings.activeNoteId = state.activeId;
    loadActiveNote();
    scheduleSave(100);
  }
  if (!el.switcherMenu.classList.contains('hidden')) renderMenuItems();
}

function onStickiesChanged(ids) {
  const next = new Set(ids);
  const returned = [...state.stuck].filter(id => !next.has(id) && state.notes.some(n => n.id === id));
  state.stuck = next;
  // 从桌面“放回便笺本”的那张，直接在便笺本里打开
  if (!IS_STICKY && returned.length) switchTo(returned[returned.length - 1]);
  if (!el.switcherMenu.classList.contains('hidden')) renderMenuItems();
}

function switchTo(id) {
  if (id === state.activeId) return;
  if (state.stuck.has(id)) { window.api.focusSticky(id); return; } // 已贴在桌面上：把那张叫到前面
  saveCurrentContent();
  state.activeId = id;
  state.settings.activeNoteId = id;
  pruneEmptyNotes(id); // 离开时顺手清掉空便笺
  loadActiveNote();
  scheduleSave(100);
}

/* 把编辑器内容写回当前便笺；内容有变化才刷新 updatedAt（切换便笺不算“编辑”） */
function saveCurrentContent() {
  const note = currentNote();
  if (note) {
    syncCheckboxAttrs();
    const html = el.editor.innerHTML;
    if (html !== (note.content || '')) {
      note.content = html;
      note.updatedAt = Date.now();
    }
  }
}

/* 待办的勾选状态只存在于 DOM property，不会进入 innerHTML；
   落盘前同步到 checked 属性，保证重启后可恢复 */
function syncCheckboxAttrs() {
  el.editor.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    if (cb.checked) cb.setAttribute('checked', 'checked');
    else cb.removeAttribute('checked');
    if (cb.getAttribute('style') === '') cb.removeAttribute('style'); // 空 style 不算内容变化
  });
}

function loadActiveNote(animate = true) {
  const note = currentNote();
  el.editor.innerHTML = note ? (note.content || '') : '';
  if (note) {
    // 以浏览器序列化后的 HTML 为基准，避免 checked → checked="checked" 之类的差异被当成“编辑”
    syncCheckboxAttrs();
    note.content = el.editor.innerHTML;
  }
  applyTheme(note);
  renderTags();
  renderSwitcher();
  updateStatus();
  if (animate) playEnter();
}

/* 新建 / 切换时内容轻微淡入 */
function playEnter() {
  [el.editor, el.tagBar].forEach(n => {
    n.classList.remove('note-enter');
    void n.offsetWidth; // 重新触发动画
    n.classList.add('note-enter');
  });
}

/* ============ 主题 / 纸张 / 外观跟随 / 字号 / 工具栏隐藏 ============ */
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/* 外观跟随：system = 系统深色时便笺变暗；time = 早上偏暖、深夜变暗 */
function ambient() {
  const mode = state.settings && state.settings.appearance;
  const h = new Date().getHours();
  if (mode === 'system') return { dark: darkQuery.matches, warm: false };
  if (mode === 'time') return { dark: h >= 22 || h < 6, warm: h >= 6 && h < 10 };
  return { dark: false, warm: false };
}

function applyTheme(note) {
  const own = note && THEMES.includes(note.color) ? note.color : 'glass';
  const amb = ambient();
  document.body.dataset.theme = amb.dark ? 'dark' : own;
  document.body.classList.toggle('warm', amb.warm && !amb.dark);
  el.smSwatches.querySelectorAll('.swatch').forEach(b => b.classList.toggle('active', b.dataset.theme === own));
  const paper = note && PAPERS.includes(note.paper) ? note.paper : 'plain';
  document.body.dataset.paper = paper;
  el.smPaper.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.paper === paper));
}
darkQuery.addEventListener('change', () => applyTheme(currentNote()));
setInterval(() => applyTheme(currentNote()), 60000); // 跟随时间：每分钟检查一次

/* 应用全局设置（启动时，以及其他窗口改了设置之后） */
function applySettings() {
  const s = state.settings;
  s.fontSize = applyFontSize(s.fontSize);
  applyAutohide(s.autoHideToolbar !== false);
  el.smOpacity.value = s.opacity;
  applyGlass(s.opacity);
  if (!IS_STICKY) {
    el.smAlwaysOnTop.checked = !!s.alwaysOnTop;
    el.btnPin.classList.toggle('active', !!s.alwaysOnTop);
  }
  el.smDock.checked = s.dockEnabled !== false;
  el.smAppearance.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === (s.appearance || 'manual')));
  applyTheme(currentNote());
  updateStatus();
}

function applyFontSize(v) {
  const n = Math.min(22, Math.max(12, Math.round(Number(v) || 15)));
  document.documentElement.style.setProperty('--font-size', n + 'px');
  el.smFontSize.value = n;
  el.smFontVal.textContent = n + 'px';
  return n;
}

function applyAutohide(on) {
  document.body.classList.toggle('autohide', on);
  el.smAutohide.checked = on;
}

/* ============ 底部状态栏：字数 · 编辑时间 ============ */
function updateStatus() {
  const note = currentNote();
  const chars = el.editor.textContent.replace(/[\s\u00a0\u3000]/g, '').length;
  if (!note || (!chars && !el.editor.querySelector('img,input'))) {
    el.statusBar.textContent = '';
    return;
  }
  const rel = relativeTime(note.updatedAt);
  const done = todayDone();
  el.statusBar.textContent = (done && !IS_STICKY ? `今日完成 ${done} 件 · ` : '') +
    `${chars} 字 · ` + (rel === '刚刚' ? '刚刚编辑' : '编辑于 ' + rel);
}

/* ============ 今日完成数 ============ */
function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function todayDone() {
  const st = state.settings && state.settings.stats;
  return st && st.date === todayKey() ? st.done : 0;
}
function countDone(delta) {
  const st = state.settings.stats && state.settings.stats.date === todayKey()
    ? state.settings.stats : { date: todayKey(), done: 0 };
  state.settings.stats = { date: st.date, done: Math.max(0, st.done + delta) };
}
setInterval(updateStatus, 30000);

/* ============ 渲染 ============ */
function renderSwitcher() {
  const note = currentNote();
  el.noteTitleEl.textContent = note ? noteTitle(note) : '空便笺';
  el.dockTitle.textContent = note ? noteTitle(note) : '';
  el.noteTitleEl.classList.toggle('custom', !!(note && (note.title || '').trim()));
}

const PENCIL_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.6 3.1l2.3 2.3-7.1 7.1-2.9.6.6-2.9 7.1-7.1z"/><path d="M9.3 4.4l2.3 2.3"/></svg>';

const STICK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.2h7.4l2.6 2.6v7H3z"/><path d="M10.4 3.2v2.6H13"/><path d="M6 9.4l2-2 2 2M8 7.4v4"/></svg>';

const PIN_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.1 2.4h3.8l-.5 3 2 2H4.6l2-2-.5-3z"/><path d="M8 7.4v6.2"/></svg>';

/* 菜单显示顺序：置顶的在前，各组内保持数组顺序 */
function displayOrder() {
  return [...state.notes.filter(n => n.pinned), ...state.notes.filter(n => !n.pinned)];
}

function noteMatches(note, q) {
  if (!q) return true;
  const hay = [note.title || '', stripHtml(note.content), (note.tags || []).join(' ')].join('\n').toLowerCase();
  return hay.includes(q);
}

let menuSearch = null;
let menuList = null;

/* 打开切换菜单：顶部搜索框 + 列表 */
function buildSwitcherMenu() {
  el.switcherMenu.innerHTML = '';
  menuSearch = document.createElement('input');
  menuSearch.className = 'menu-search';
  menuSearch.placeholder = '搜索标题、正文、标签';
  menuList = document.createElement('div');
  menuList.className = 'menu-items';
  el.switcherMenu.append(menuSearch, menuList);

  menuSearch.addEventListener('input', () => renderMenuItems());
  menuSearch.addEventListener('keydown', (e) => {
    const first = menuList.querySelector('.menu-item');
    if (e.key === 'Enter' && first) { e.preventDefault(); first.click(); }
    else if (e.key === 'ArrowDown' && first) { e.preventDefault(); first.focus(); }
  });
  renderMenuItems();
}

let dragId = null;

function renderMenuItems() {
  const q = (menuSearch ? menuSearch.value : '').trim().toLowerCase();
  menuList.innerHTML = '';
  const list = displayOrder().filter(n => noteMatches(n, q));
  if (!list.length) {
    menuList.innerHTML = '<div class="menu-empty">没有匹配的便笺</div>';
    return;
  }
  list.forEach(n => {
    const item = document.createElement('div');
    const stuck = state.stuck.has(n.id);
    item.className = 'menu-item' + (n.id === state.activeId ? ' current' : '') + (stuck ? ' stuck' : '');
    item.setAttribute('role', 'menuitem');
    item.tabIndex = 0;
    item.draggable = !q; // 搜索结果是子集，此时不支持排序
    const sub = noteSubtitle(n);
    item.innerHTML =
      `<span class="mi-dot" data-theme="${THEMES.includes(n.color) ? n.color : 'glass'}"></span>` +
      `<span class="mi-main"><span class="mi-title">${escapeHtml(noteTitle(n))}</span>` +
      (sub ? `<span class="mi-sub">${escapeHtml(sub)}</span>` : '') + `</span>` +
      (stuck ? `<span class="mi-badge" title="已贴在桌面上，点击把它叫到前面">桌面</span>` : `<span class="mi-time">${relativeTime(n.updatedAt)}</span>`) +
      (stuck ? '' : `<button class="mi-btn mi-stick" title="贴到桌面" aria-label="贴到桌面">${STICK_SVG}</button>`) +
      `<button class="mi-btn mi-pin${n.pinned ? ' on' : ''}" title="${n.pinned ? '取消置顶' : '置顶此便笺'}" aria-label="置顶">${PIN_SVG}</button>` +
      `<button class="mi-btn mi-rename" title="重命名" aria-label="重命名">${PENCIL_SVG}</button>`;

    const go = () => { closeMenus(); switchTo(n.id); };
    item.addEventListener('click', go);
    item.addEventListener('keydown', (e) => {
      if (e.target !== item) return;
      if (e.key === 'Enter') { e.preventDefault(); go(); }
      else if (e.key === 'ArrowDown' && item.nextElementSibling) { e.preventDefault(); item.nextElementSibling.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (item.previousElementSibling || menuSearch).focus(); }
    });
    item.querySelector('.mi-pin').addEventListener('click', (e) => {
      e.stopPropagation();
      n.pinned = !n.pinned;
      state.notes = displayOrder();
      renderMenuItems();
      scheduleSave(100);
    });
    item.querySelector('.mi-rename').addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenus();
      if (stuck) { window.api.focusSticky(n.id); return; }
      switchTo(n.id);
      startRename();
    });
    const stickBtn = item.querySelector('.mi-stick');
    if (stickBtn) {
      stickBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenus();
        stickNote(n.id);
      });
    }

    // 拖动排序（HTML5 DnD；用自定义类型，避免拖进编辑器时被当成文字插入）
    item.addEventListener('dragstart', (e) => {
      dragId = n.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-floatnote', n.id);
      item.classList.add('dragging');
    });
    item.addEventListener('dragover', (e) => {
      if (!dragId || dragId === n.id) return;
      e.preventDefault();
      const r = item.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      item.classList.toggle('drop-before', before);
      item.classList.toggle('drop-after', !before);
    });
    item.addEventListener('dragleave', () => item.classList.remove('drop-before', 'drop-after'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const before = item.classList.contains('drop-before');
      item.classList.remove('drop-before', 'drop-after');
      if (dragId) moveNote(dragId, n.id, before);
    });
    item.addEventListener('dragend', (e) => {
      dragId = null;
      item.classList.remove('dragging');
      // 拖出便笺卡片外松手：撕下来贴到桌面（在列表内松手则是排序）
      const r = el.card.getBoundingClientRect();
      const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (outside && e.dataTransfer.dropEffect === 'none' && !stuck) {
        closeMenus();
        const hasPoint = e.screenX || e.screenY;
        stickNote(n.id, hasPoint ? e.screenX : undefined, hasPoint ? e.screenY : undefined);
      }
    });
    menuList.appendChild(item);
  });
}

/* 把 srcId 移到 targetId 前/后；跨组拖动时跟随目标的置顶状态 */
function moveNote(srcId, targetId, before) {
  if (srcId === targetId) return;
  const order = displayOrder();
  const src = order.find(n => n.id === srcId);
  const target = order.find(n => n.id === targetId);
  if (!src || !target) return;
  order.splice(order.indexOf(src), 1);
  order.splice(order.indexOf(target) + (before ? 0 : 1), 0, src);
  src.pinned = !!target.pinned;
  state.notes = order;
  state.notes = displayOrder();
  renderMenuItems();
  scheduleSave(100);
}

/* ============ 重命名 ============ */
/* 用与胶囊同尺寸的输入框临时替换切换按钮：回车保存、Esc 取消、留空恢复自动标题 */
function startRename() {
  const note = currentNote();
  if (!note || document.querySelector('.pill-input')) return;
  closeMenus();
  saveCurrentContent();
  const input = document.createElement('input');
  input.className = 'pill-input';
  input.maxLength = 40;
  input.value = (note.title || '').trim();
  input.placeholder = autoTitle(note) === '空便笺' ? '输入便笺标题' : autoTitle(note);
  input.title = '回车保存 · Esc 取消 · 留空则用第一行文字';
  el.switcher.classList.add('renaming');
  el.switcher.after(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (save) {
      note.title = input.value.trim();
      scheduleSave(100);
    }
    input.remove();
    el.switcher.classList.remove('renaming');
    renderSwitcher();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); el.editor.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); el.editor.focus(); }
  });
  input.addEventListener('blur', () => finish(true));
}

function renderTags() {
  el.tagBar.innerHTML = '';
  const note = currentNote();
  if (!note) return;
  (note.tags || []).forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'tag';
    chip.innerHTML = `<span>#${escapeHtml(tag)}</span><span class="tag-x">×</span>`;
    chip.title = '点击移除标签';
    chip.addEventListener('click', () => removeTag(tag));
    el.tagBar.appendChild(chip);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1600);
}

/* 带操作按钮的提示条（同一时间只保留一个） */
function toastAction(msg, label, onAction, ms = 5000) {
  document.querySelectorAll('.toast.action').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast action';
  const text = document.createElement('span');
  text.textContent = msg;
  const btn = document.createElement('button');
  btn.className = 'toast-btn';
  btn.textContent = label;
  t.append(text, btn);
  const timer = setTimeout(() => t.remove(), ms);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearTimeout(timer);
    t.remove();
    onAction();
  });
  document.body.appendChild(t);
}

function addTag(tag) {
  const note = currentNote();
  if (!note) return;
  if (!note.tags) note.tags = [];
  if (!note.tags.includes(tag)) note.tags.push(tag);
  renderTags();
  scheduleSave(100);
}

function removeTag(tag) {
  const note = currentNote();
  if (!note) return;
  note.tags = note.tags.filter(t => t !== tag);
  renderTags();
  scheduleSave(100);
}

/* ============ 编辑器操作 ============ */
/* ---- 待办：按“行”切换 ----
   编辑器里一行 = editor 的一个顶层块元素。Chromium 的 contenteditable 会把第一行
   留成裸文本、后续行包成 <div>，也可能出现 <br> 换行，所以先统一成“每行一个 div”。 */
const BLOCK_TAGS = new Set(['DIV', 'P', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'PRE']);

function normalizeLines() {
  const nodes = [...el.editor.childNodes];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const div = document.createElement('div');
    el.editor.insertBefore(div, run[0]);
    run.forEach(n => div.appendChild(n));
    run = [];
  };
  for (const n of nodes) {
    if (n.nodeType === 1 && BLOCK_TAGS.has(n.tagName)) { flush(); continue; }
    run.push(n);
    if (n.nodeName === 'BR') flush();
  }
  flush();
}

/* 找到节点所在的顶层行 */
function lineOf(node) {
  while (node && node.parentNode !== el.editor) node = node.parentNode;
  return node && node.parentNode === el.editor ? node : null;
}

const lineCheckbox = (line) =>
  (line && line.nodeType === 1 && [...line.children].find(c => c.matches('input[type="checkbox"]'))) || null;

function makeTodo(line) {
  line.classList.add('todo');
  if (lineCheckbox(line)) return;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  line.insertBefore(document.createTextNode('\u00a0'), line.firstChild);
  line.insertBefore(cb, line.firstChild);
}

function unmakeTodo(line) {
  const cb = lineCheckbox(line);
  if (cb) {
    const next = cb.nextSibling;
    if (next && next.nodeType === 3) {
      next.data = next.data.replace(/^\u00a0/, '');
      if (!next.data) next.remove();
    }
    cb.remove();
  }
  line.classList.remove('todo');
  if (!line.className) line.removeAttribute('class');
  if (!line.firstChild) line.appendChild(document.createElement('br'));
}

/* 光标若落在复选框前面，挪到复选框后的空格之后 */
function placeAfterCheckbox(marker) {
  const prev = marker.previousSibling;
  if (prev && prev.matches && prev.matches('input[type="checkbox"]')) {
    const sp = marker.nextSibling;
    if (sp && sp.nodeType === 3 && sp.data.startsWith('\u00a0')) {
      sp.splitText(1);
      sp.after(marker);
    }
  }
}

/* Ctrl+Shift+T：把选中的每一行（或光标所在行）转成待办；已全是待办则还原为普通文字 */
function toggleTodo() {
  el.editor.focus();
  const sel = window.getSelection();
  if (!sel.rangeCount || !el.editor.contains(sel.anchorNode)) {
    const range = document.createRange();
    range.selectNodeContents(el.editor);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  const range = sel.getRangeAt(0);

  // 用标记节点记住选区，规整 DOM 时它们会跟着文字移动
  const mkStart = document.createElement('span');
  const mkEnd = document.createElement('span');
  const endRange = range.cloneRange();
  endRange.collapse(false);
  endRange.insertNode(mkEnd);
  range.collapse(true);
  range.insertNode(mkStart);

  normalizeLines();
  const first = lineOf(mkStart);
  const last = lineOf(mkEnd);
  const lines = [];
  for (let n = first; n; n = n.nextSibling) {
    if (n.nodeType === 1) lines.push(n);
    if (n === last) break;
  }

  const allTodo = lines.every(l => lineCheckbox(l));
  lines.forEach(l => (allTodo ? unmakeTodo(l) : makeTodo(l)));
  if (!allTodo) { placeAfterCheckbox(mkStart); placeAfterCheckbox(mkEnd); }

  const r = document.createRange();
  r.setStartAfter(mkStart);
  r.setEndBefore(mkEnd);
  mkStart.remove();
  mkEnd.remove();
  sel.removeAllRanges();
  sel.addRange(r);
  scheduleSave(100);
}

/* 回车：待办行内回车自动延续为新待办；空待办上回车则退出待办 */
function caretLine() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !el.editor.contains(sel.anchorNode)) return null;
  return lineOf(sel.anchorNode);
}

el.editor.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  const line = caretLine();
  if (!line || !lineCheckbox(line)) return;
  if (!line.textContent.replace(/\u00a0/g, ' ').trim()) {
    e.preventDefault();
    unmakeTodo(line);
    const r = document.createRange();
    r.setStart(line, 0);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    scheduleSave(100);
  }
});

/* Markdown 式快捷输入：行首输入标记再敲空格即转换
   [] / 【】 → 待办，[x] → 已勾选待办，- / * → 无序列表，1. → 有序列表，# → 标题，## → 小标题 */
const MD_PATTERN = /^(\[\s?\]|【\s?】|\[[xX]\]|【[xX]】|[-*•－]|1[.．。]|#{1,2}|＃{1,2})[\s\u00a0\u3000]$/;

function markdownShortcut() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  const node = sel.anchorNode;
  const off = sel.anchorOffset;
  if (!el.editor.contains(node) || node === el.editor) return;
  const host = node.nodeType === 3 ? node.parentElement : node;
  if (host.closest('li, h2, h3, pre')) return;
  // 行 = 光标最近的块元素（Chromium 可能把行嵌套在 div 里）；顶层裸文本则取顶层节点
  const block = host.closest('div, p');
  const line = block && block !== el.editor && el.editor.contains(block) ? block : lineOf(node);
  if (!line || lineCheckbox(line)) return;

  const r = document.createRange();
  r.setStart(line, 0);
  r.setEnd(node, off);
  const m = MD_PATTERN.exec(r.toString());
  if (!m) return;
  r.deleteContents();
  // 删掉标记后若整行变空，补一个 <br> 占位，否则光标进不去，列表/标题会套到上一行
  let target = line;
  if (line.nodeType === 3 && !line.data) {
    target = document.createElement('div');
    line.replaceWith(target);
  }
  if (target.nodeType === 1 && !target.textContent && !target.querySelector('img,input,br')) {
    target.appendChild(document.createElement('br'));
  }
  if (target !== line || !target.textContent) r.setStart(target, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);

  const tok = m[1];
  if (/^[\[【]/.test(tok)) {
    toggleTodo();
    if (/[xX]/.test(tok)) {
      const cb = lineCheckbox(caretLine());
      if (cb) { cb.checked = true; cb.setAttribute('checked', 'checked'); }
    }
  } else if (/^[-*•－]$/.test(tok)) {
    document.execCommand('insertUnorderedList');
    unwrapList();
  } else if (/^1/.test(tok)) {
    document.execCommand('insertOrderedList');
    unwrapList();
  } else {
    document.execCommand('formatBlock', false, tok.length === 1 ? 'h2' : 'h3');
  }
  // formatBlock 可能留下完全为空的 div（不可见、也放不进光标），顺手清掉
  el.editor.querySelectorAll(':scope > div:empty').forEach(d => d.remove());
  scheduleSave();
}

/* execCommand 会把列表包进原来那行的 <div>，退出列表后的新行也跟着嵌套进去；
   这里把只包着列表的外层 div 拆掉（用标记节点保住光标） */
function unwrapList() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const a = sel.anchorNode;
  const list = (a.nodeType === 3 ? a.parentElement : a).closest('ul, ol');
  const wrap = list && list.parentElement;
  if (!wrap || wrap === el.editor || wrap.tagName !== 'DIV' || wrap.children.length !== 1) return;
  const mk = document.createElement('span');
  sel.getRangeAt(0).insertNode(mk);
  wrap.replaceWith(list);
  const r = document.createRange();
  r.setStartAfter(mk);
  r.collapse(true);
  mk.remove();
  sel.removeAllRanges();
  sel.addRange(r);
}

el.editor.addEventListener('input', (e) => {
  if (e.inputType === 'insertText' && e.data && /^[\s\u3000]$/.test(e.data)) markdownShortcut();
});

el.editor.addEventListener('input', (e) => {
  if (e.inputType !== 'insertParagraph') return;
  const line = caretLine();
  if (!line || line.nodeType !== 1 || lineCheckbox(line) || !line.classList.contains('todo')) return;
  const a = window.getSelection().anchorNode;
  if ((a.nodeType === 3 ? a.parentElement : a).closest('li, h2, h3')) return;
  // 新行继承了 todo 但没有复选框：补上，并把光标放到复选框后
  makeTodo(line);
  const sp = lineCheckbox(line).nextSibling;
  const r = document.createRange();
  r.setStart(sp, 1);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
});

function insertImageAtCaret(img) {
  const sel = window.getSelection();
  if (sel.rangeCount) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(img);
    const br = document.createElement('br');
    range.insertNode(br);
    range.setStartAfter(br);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    el.editor.appendChild(img);
  }
  el.editor.focus();
}

async function insertImage(dataUrl) {
  const note = currentNote();
  if (!note) return;
  try {
    const url = await window.api.saveImage(note.id, dataUrl);
    const img = document.createElement('img');
    img.src = url;
    insertImageAtCaret(img);
    scheduleSave(100);
  } catch (e) {
    console.error('insertImage', e);
  }
}

async function pasteClipboardImage() {
  const dataUrl = await window.api.readClipboardImage();
  if (dataUrl) await insertImage(dataUrl);
  else toast('剪贴板中没有图片');
}

/* ============ 事件绑定 ============ */
el.btnNew.addEventListener('click', newNote);
el.switcher.addEventListener('click', (e) => {
  e.stopPropagation();
  if (e.detail > 1) return; // 双击的第二下交给 dblclick（重命名）
  if (IS_STICKY) return; // 桌面便笺只有一张，没有切换菜单
  if (el.switcherMenu.classList.contains('hidden')) {
    closeMenus();
    saveCurrentContent();
    buildSwitcherMenu();
    openMenu(el.switcherMenu, el.switcher, 'left');
    el.switcher.setAttribute('aria-expanded', 'true');
    menuSearch.focus();
  } else {
    closeMenus();
  }
});

// 双击标题重命名
el.switcher.addEventListener('dblclick', (e) => {
  e.preventDefault();
  e.stopPropagation();
  startRename();
});

// 删除：立即生效，提示条里可撤销
el.btnDelete.addEventListener('click', () => {
  closeMenus();
  deleteNote();
});

/* 在标签栏打开输入框（快捷键 Ctrl+Shift+L 触发） */
function openTagInput() {
  if (el.tagBar.querySelector('.tag-input')) {
    el.tagBar.querySelector('.tag-input').focus();
    return;
  }
  const input = document.createElement('input');
  input.className = 'tag-input';
  input.placeholder = '标签名，回车确认';
  el.tagBar.appendChild(input);
  input.focus();
  const commit = () => {
    const v = input.value.trim();
    if (v) addTag(v);
    input.remove();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); input.remove(); }
  });
  input.addEventListener('blur', commit);
}

/* 全局编辑快捷键：待办 / 标签 / 粘贴图片 */
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || !e.shiftKey) return;
  const key = e.key.toLowerCase();
  if (key === 't') { e.preventDefault(); toggleTodo(); }
  else if (key === 'l') { e.preventDefault(); openTagInput(); }
  else if (key === 'i') { e.preventDefault(); pasteClipboardImage(); }
});

// 粘贴图片
el.editor.addEventListener('paste', async (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) {
        const dataUrl = await blobToDataURL(file);
        await insertImage(dataUrl);
      }
      return;
    }
  }
});

// 待办勾选：迸出小爪印；整张便笺的待办全部完成时，一串爪印走过卡片
el.editor.addEventListener('change', (e) => {
  const cb = e.target;
  if (!cb || !cb.matches('input[type=checkbox]')) return;
  if (cb.checked) {
    countDone(1);
    const r = cb.getBoundingClientRect();
    window.Life.burst(r.left + r.width / 2, r.top + r.height / 2);
    const boxes = [...el.editor.querySelectorAll('input[type="checkbox"]')];
    if (boxes.length >= 2 && boxes.every(b => b.checked)) {
      window.Life.pawTrail(el.card);
      toast('全部完成，休息一下吧');
    }
  } else {
    countDone(-1);
  }
  updateStatus();
  scheduleSave(100);
});
el.editor.addEventListener('input', () => scheduleSave());

/* ============ 窗口控制 ============ */
el.btnHide.addEventListener('click', () => window.api.hide());
/* 便笺本：关闭 = 隐藏到托盘（不让用户“找不到窗口”）；桌面便笺：关闭 = 放回便笺本 */
el.btnClose.addEventListener('click', () => {
  if (IS_STICKY) {
    persist();
    window.api.closeSticky(STICKY_ID);
  } else {
    window.api.hide();
  }
});

el.btnStick.addEventListener('click', () => { closeMenus(); stickNote(state.activeId); });

let stickyOnTop = true; // 桌面便笺各自记住是否置顶
el.btnPin.addEventListener('click', async () => {
  if (IS_STICKY) {
    stickyOnTop = await window.api.setAlwaysOnTop(!stickyOnTop);
    el.btnPin.classList.toggle('active', stickyOnTop);
    return;
  }
  state.settings.alwaysOnTop = !state.settings.alwaysOnTop;
  await window.api.setAlwaysOnTop(state.settings.alwaysOnTop);
  el.btnPin.classList.toggle('active', state.settings.alwaysOnTop);
  el.smAlwaysOnTop.checked = state.settings.alwaysOnTop;
  scheduleSave(100);
});

/* ============ 浮层（设置 / 便笺切换） ============ */
/* 弹层锚定在触发按钮下沿，并限制在便笺卡片范围内；align 决定与按钮左对齐还是右对齐 */
function openMenu(menu, btn, align = 'right') {
  menu.classList.remove('hidden');
  el.card.classList.add('menu-open');
  window.api.setMenuOpen(true);
  const b = btn.getBoundingClientRect();
  const c = el.card.getBoundingClientRect();
  menu.style.maxHeight = Math.max(120, Math.round(c.bottom - b.bottom - 14)) + 'px';
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const want = align === 'left' ? b.left : b.right - w;
  const left = Math.min(Math.max(want, c.left + 6), c.right - w - 6);
  let top = b.bottom + 6;
  if (top + h > c.bottom - 6) top = Math.max(c.top + 6, b.top - h - 6);
  menu.style.left = Math.round(left) + 'px';
  menu.style.top = Math.round(top) + 'px';
  menu.style.right = 'auto';
}

function closeMenus() {
  el.settingsMenu.classList.add('hidden');
  el.switcherMenu.classList.add('hidden');
  el.switcher.setAttribute('aria-expanded', 'false');
  if (el.card.classList.contains('menu-open')) window.api.setMenuOpen(false);
  el.card.classList.remove('menu-open');
}

el.btnSettings.addEventListener('click', (e) => {
  e.stopPropagation();
  if (el.settingsMenu.classList.contains('hidden')) {
    closeMenus();
    openMenu(el.settingsMenu, el.btnSettings);
  } else {
    closeMenus();
  }
});
document.addEventListener('click', (e) => {
  if (el.settingsMenu.contains(e.target) || el.switcherMenu.contains(e.target)) return;
  closeMenus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenus();
  else if (e.key === 'F2') { e.preventDefault(); startRename(); }
});
window.addEventListener('resize', closeMenus);

el.smOpacity.addEventListener('input', () => {
  const v = parseFloat(el.smOpacity.value);
  state.settings.opacity = v;
  applyGlass(v);
});
el.smOpacity.addEventListener('change', () => scheduleSave(100));

el.smSwatches.addEventListener('click', (e) => {
  const b = e.target.closest('.swatch');
  const note = currentNote();
  if (!b || !note) return;
  note.color = b.dataset.theme === 'glass' ? undefined : b.dataset.theme;
  applyTheme(note);
  scheduleSave(100);
});

el.smPaper.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  const note = currentNote();
  if (!b || !note) return;
  note.paper = b.dataset.paper === 'plain' ? undefined : b.dataset.paper;
  applyTheme(note);
  scheduleSave(100);
});

el.smAppearance.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.settings.appearance = b.dataset.mode === 'manual' ? undefined : b.dataset.mode;
  applySettings();
  scheduleSave(100);
});

el.smDock.addEventListener('change', () => {
  state.settings.dockEnabled = el.smDock.checked;
  window.api.setDockEnabled(el.smDock.checked);
  scheduleSave(100);
});


el.smFontSize.addEventListener('input', () => {
  state.settings.fontSize = applyFontSize(el.smFontSize.value);
});
el.smFontSize.addEventListener('change', () => scheduleSave(100));

el.smAutohide.addEventListener('change', () => {
  state.settings.autoHideToolbar = el.smAutohide.checked;
  applyAutohide(el.smAutohide.checked);
  scheduleSave(100);
});

el.smAlwaysOnTop.addEventListener('change', async () => {
  state.settings.alwaysOnTop = el.smAlwaysOnTop.checked;
  await window.api.setAlwaysOnTop(state.settings.alwaysOnTop);
  el.btnPin.classList.toggle('active', state.settings.alwaysOnTop);
  scheduleSave(100);
});

/* ============ 自定义拖动（工具栏） ============ */
let dragState = null;
let dragging = false;

el.toolbar.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button,select,input,option')) return;
  dragState = { x: e.screenX, y: e.screenY, id: e.pointerId };
  dragging = true;
  window.api.dragStart();
  el.toolbar.setPointerCapture(e.pointerId);
  e.preventDefault();
});
el.toolbar.addEventListener('pointermove', (e) => {
  if (!dragState) return;
  const dx = e.screenX - dragState.x;
  const dy = e.screenY - dragState.y;
  if (dx || dy) {
    dragState.x = e.screenX;
    dragState.y = e.screenY;
    window.api.moveBy(dx, dy);
  }
});
const endDrag = () => {
  if (!dragState) return;
  dragState = null;
  dragging = false;
  window.api.dragEnd(); // 主进程据此判断是否贴到了屏幕边缘
  recomputeIgnore();
};
el.toolbar.addEventListener('pointerup', endDrag);
el.toolbar.addEventListener('pointercancel', endDrag);

/* ============ 调整大小（右下角手柄） ============ */
el.resizeGrip.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.screenX, startY = e.screenY;
  const startW = window.innerWidth, startH = window.innerHeight;
  el.resizeGrip.setPointerCapture(e.pointerId);
  const onMove = (ev) => {
    window.api.resize(startW + (ev.screenX - startX), startH + (ev.screenY - startY));
  };
  const onUp = () => {
    el.resizeGrip.removeEventListener('pointermove', onMove);
    el.resizeGrip.removeEventListener('pointerup', onUp);
  };
  el.resizeGrip.addEventListener('pointermove', onMove);
  el.resizeGrip.addEventListener('pointerup', onUp);
});

/* ============ 透明区域点击穿透管理 ============ */
let mouseX = -1, mouseY = -1;
let currentlyIgnoring = true;

function recomputeIgnore() {
  const rect = el.card.getBoundingClientRect();
  const inCard = mouseX >= rect.left && mouseX <= rect.right && mouseY >= rect.top && mouseY <= rect.bottom;
  const shouldIgnore = !inCard;
  if (shouldIgnore !== currentlyIgnoring) {
    currentlyIgnoring = shouldIgnore;
    window.api.setIgnoreMouse(shouldIgnore);
  }
}

document.addEventListener('mousemove', (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
  if (!dragging) recomputeIgnore();
});

function formatHotkey(info) {
  if (!info || !info.acc) return '未注册';
  const acc = String(info.acc)
    .replace('CommandOrControl', 'Ctrl')
    .replace('Control', 'Ctrl')
    .replace('Command', 'Cmd');
  return info.ok ? acc : acc + '（注册失败，可能被占用）';
}

/* ============ 贴边收起 ============ */
function onDockState(st) {
  document.body.classList.toggle('docked', !!st);
  document.body.classList.toggle('collapsed', !!(st && st.collapsed));
  document.body.dataset.dockEdge = st ? st.edge : '';
  if (st && st.collapsed) {
    closeMenus();
  } else if (st) {
    el.cardWrap.classList.remove('dock-slide');
    void el.cardWrap.offsetWidth;
    el.cardWrap.classList.add('dock-slide'); // 从屏幕边缘滑出
  }
}
el.dockTab.addEventListener('click', () => window.api.dockExpand());

/* ============ 快速捕捉：别的程序里选中文字，按快捷键追加到当前便笺 ============ */
function formatCaptureTime(ts) {
  const d = new Date(ts);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function appendCapture(c) {
  const note = currentNote();
  if (!note || !c || !c.text) return;
  saveCurrentContent();
  const body = escapeHtml(c.text).replace(/\n/g, '<br>');
  const src = c.source ? escapeHtml(c.source) : (c.fromClipboard ? '剪贴板' : '');
  const meta = '— ' + (src ? src + ' · ' : '') + formatCaptureTime(c.at || Date.now());
  // 末尾若是空行就插在它前面，否则追加，并留一个空行方便继续写
  const last = el.editor.lastElementChild;
  const html = `<div class="capture"><div class="capture-text">${body}</div><div class="capture-meta">${meta}</div></div>`;
  if (last && last.tagName === 'DIV' && !last.textContent.trim() && !last.querySelector('img,input')) {
    last.insertAdjacentHTML('beforebegin', html);
  } else {
    el.editor.insertAdjacentHTML('beforeend', html + '<div><br></div>');
  }
  el.editor.scrollTop = el.editor.scrollHeight;
  persist();
  if (!document.hidden) toast('已捕捉到「' + noteTitle(note) + '」');
}

function formatHotkey(info) {
  if (!info || !info.acc) return '未注册';
  const acc = String(info.acc)
    .replace('CommandOrControl', 'Ctrl')
    .replace('Control', 'Ctrl')
    .replace('Command', 'Cmd');
  return info.ok ? acc : acc + '（注册失败，可能被占用）';
}

/* ============ 初始化 ============ */
async function init() {
  const [data, ctx] = await Promise.all([window.api.loadData(), window.api.getContext()]);
  state.notes = (data.notes || []).map(n => Object.assign({}, n));
  state.settings = Object.assign({}, data.settings);
  state.stuck = new Set((ctx && ctx.stickies) || []);
  rememberBaseline(); // 以主进程的数据为基准，之后的本地修改都会作为增量发出

  if (IS_STICKY) {
    state.activeId = STICKY_ID;
    if (!currentNote()) { window.api.closeSticky(STICKY_ID); return; }
    stickyOnTop = !!(ctx && ctx.onTop);
    el.btnPin.classList.toggle('active', stickyOnTop);
    el.btnPin.title = '桌面便笺置顶';
    el.btnClose.title = '放回便笺本';
    el.btnClose.setAttribute('aria-label', '放回便笺本');
    el.switcher.title = '双击重命名（F2）';
  } else {
    if (!state.notes.length) state.notes.push(blankNote());
    const saved = state.settings.activeNoteId;
    const usable = (id) => id && state.notes.some(n => n.id === id) && !state.stuck.has(id);
    state.activeId = usable(saved) ? saved : (state.notes.find(n => !state.stuck.has(n.id)) || (() => {
      const fresh = blankNote();
      state.notes.unshift(fresh);
      return fresh;
    })()).id;
    state.settings.activeNoteId = state.activeId;
    // 启动时清掉历史遗留的空便笺（贴在桌面上的不动）
    pruneEmptyNotes(state.activeId);
  }

  applySettings();
  const hk = await window.api.getHotkey();
  el.smHotkeyHint.textContent = formatHotkey(hk);
  el.smCaptureHint.textContent = formatHotkey(hk && hk.capture);

  loadActiveNote();
  scheduleSave(100);

  window.api.onPatched(applyRemotePatch);
  window.api.onStickies(onStickiesChanged);
  window.api.onDockState(onDockState);
  if (ctx && ctx.dock) onDockState(ctx.dock);
  if (!IS_STICKY) {
    window.api.onNewNote(() => newNote());
    window.api.onCapture(appendCapture);
  }
  // 关窗 / 刷新前把没发出去的改动发出去
  window.addEventListener('beforeunload', persist);
}

init();
