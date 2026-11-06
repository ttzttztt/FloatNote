'use strict';

/* core.js —— 全局状态、DOM 引用、工具函数（其余脚本都依赖这里，必须最先加载）
   各脚本是同一页面里的普通 <script>，顶层声明互相可见；按 index.html 中的顺序加载。 */

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
  smHotkeyTip: document.getElementById('sm-hotkey-tip'),
  smAutoLaunch: document.getElementById('sm-autolaunch'),
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
const Undo = window.UndoStack;

const currentNote = () => state.notes.find(n => n.id === state.activeId && !n.trashed) || null;
/* 正常的便笺（不含「最近删除」里的） */
const liveNotes = () => state.notes.filter(n => !n.trashed);

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
  const kept = state.notes.filter(n => n.trashed || n.id === keepId || state.stuck.has(n.id) || !isNoteEmpty(n));
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

