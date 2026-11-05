'use strict';

/* ============ 全局状态 ============ */
const state = {
  notes: [],
  settings: null,
  activeId: null
};

/* ============ DOM 引用 ============ */
const el = {
  card: document.getElementById('card'),
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
  smHotkeyHint: document.getElementById('sm-hotkey-hint')
};

const currentNote = () => state.notes.find(n => n.id === state.activeId) || null;

/* ============ 工具函数 ============ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function stripHtml(html) {
  const div = document.createElement('div');
  // 块级元素与换行先转成 \n，否则多行内容会被拼成一行
  div.innerHTML = String(html || '').replace(/<(br|div|p|li)\b[^>]*>/gi, '\n$&');
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
  if (/<img\b/i.test(html)) return false;
  return !stripHtml(html).replace(/\u00a0/g, ' ').trim();
}

/* 移除空便笺（保留 keepId 对应的那张，且至少留一张） */
function pruneEmptyNotes(keepId) {
  const kept = state.notes.filter(n => n.id === keepId || !isNoteEmpty(n));
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

/* ============ 持久化 ============ */
let saveTimer = null;
function scheduleSave(delay = 500) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, delay);
}

function persist() {
  const note = currentNote();
  if (note) {
    syncCheckboxAttrs();
    note.content = el.editor.innerHTML;
    note.updatedAt = Date.now();
    el.noteTitleEl.textContent = noteTitle(note);
  }
  window.api.saveData({ notes: state.notes, settings: state.settings });
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
  const note = {
    id: uid(),
    title: '',
    tags: [],
    content: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.notes.unshift(note);
  state.activeId = note.id;
  renderSwitcher();
  loadActiveNote();
  el.editor.focus();
  scheduleSave(100);
}

function deleteNote() {
  if (state.notes.length <= 1) {
    // 只有一张时清空而非删除
    const note = currentNote();
    note.content = '';
    note.tags = [];
    el.editor.innerHTML = '';
    renderTags();
    scheduleSave(100);
    return;
  }
  const idx = state.notes.findIndex(n => n.id === state.activeId);
  state.notes.splice(idx, 1);
  state.activeId = state.notes[Math.max(0, idx - 1)].id;
  renderSwitcher();
  loadActiveNote();
  scheduleSave(100);
}

function switchTo(id) {
  if (id === state.activeId) return;
  saveCurrentContent();
  state.activeId = id;
  state.settings.activeNoteId = id;
  pruneEmptyNotes(id); // 离开时顺手清掉空便笺
  loadActiveNote();
  scheduleSave(100);
}

function saveCurrentContent() {
  const note = currentNote();
  if (note) {
    syncCheckboxAttrs();
    note.content = el.editor.innerHTML;
  }
}

/* 待办的勾选状态只存在于 DOM property，不会进入 innerHTML；
   落盘前同步到 checked 属性，保证重启后可恢复 */
function syncCheckboxAttrs() {
  el.editor.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    if (cb.checked) cb.setAttribute('checked', 'checked');
    else cb.removeAttribute('checked');
  });
}

function loadActiveNote() {
  const note = currentNote();
  el.editor.innerHTML = note ? (note.content || '') : '';
  renderTags();
  renderSwitcher();
}

/* ============ 渲染 ============ */
function renderSwitcher() {
  const note = currentNote();
  el.noteTitleEl.textContent = note ? noteTitle(note) : '空便笺';
  el.noteTitleEl.classList.toggle('custom', !!(note && (note.title || '').trim()));
}

const PENCIL_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.6 3.1l2.3 2.3-7.1 7.1-2.9.6.6-2.9 7.1-7.1z"/><path d="M9.3 4.4l2.3 2.3"/></svg>';

function renderSwitcherMenu() {
  el.switcherMenu.innerHTML = '';
  state.notes.forEach(n => {
    const item = document.createElement('div');
    item.className = 'menu-item' + (n.id === state.activeId ? ' current' : '');
    item.setAttribute('role', 'menuitem');
    item.tabIndex = 0;
    const sub = noteSubtitle(n);
    item.innerHTML =
      `<span class="mi-main"><span class="mi-title">${escapeHtml(noteTitle(n))}</span>` +
      (sub ? `<span class="mi-sub">${escapeHtml(sub)}</span>` : '') + `</span>` +
      `<span class="mi-time">${relativeTime(n.updatedAt)}</span>` +
      `<button class="mi-rename" title="重命名" aria-label="重命名">${PENCIL_SVG}</button>`;
    const go = () => { closeMenus(); switchTo(n.id); };
    item.addEventListener('click', go);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); go(); }
    });
    item.querySelector('.mi-rename').addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenus();
      switchTo(n.id);
      startRename();
    });
    el.switcherMenu.appendChild(item);
  });
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
function insertTodo() {
  el.editor.focus();
  document.execCommand('insertHTML', false, '<div class="todo"><input type="checkbox">&nbsp;</div>');
  scheduleSave(100);
}

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
  if (el.switcherMenu.classList.contains('hidden')) {
    closeMenus();
    saveCurrentContent();
    renderSwitcherMenu();
    openMenu(el.switcherMenu, el.switcher, 'left');
    el.switcher.setAttribute('aria-expanded', 'true');
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

// 删除：两步确认（3 秒内再点一次生效）
let deleteArm = null;
el.btnDelete.addEventListener('click', () => {
  if (deleteArm) {
    clearTimeout(deleteArm);
    deleteArm = null;
    el.btnDelete.classList.remove('confirm');
    el.btnDelete.title = '删除当前便笺';
    deleteNote();
    return;
  }
  el.btnDelete.classList.add('confirm');
  el.btnDelete.title = '再次点击确认删除';
  deleteArm = setTimeout(() => {
    deleteArm = null;
    el.btnDelete.classList.remove('confirm');
    el.btnDelete.title = '删除当前便笺';
  }, 3000);
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
  if (key === 't') { e.preventDefault(); insertTodo(); }
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

// 待办勾选后保存
el.editor.addEventListener('change', (e) => {
  if (e.target && e.target.matches('input[type=checkbox]')) scheduleSave(100);
});
el.editor.addEventListener('input', () => scheduleSave());

/* ============ 窗口控制 ============ */
el.btnHide.addEventListener('click', () => window.api.hide());
/* 关闭按钮同样隐藏到托盘：便笺类应用不应让用户“找不到窗口” */
el.btnClose.addEventListener('click', () => window.api.hide());

el.btnPin.addEventListener('click', async () => {
  state.settings.alwaysOnTop = !state.settings.alwaysOnTop;
  await window.api.setAlwaysOnTop(state.settings.alwaysOnTop);
  el.btnPin.classList.toggle('active', state.settings.alwaysOnTop);
  scheduleSave(100);
});

/* ============ 浮层（设置 / 便笺切换） ============ */
/* 弹层锚定在触发按钮下沿，并限制在便笺卡片范围内；align 决定与按钮左对齐还是右对齐 */
function openMenu(menu, btn, align = 'right') {
  menu.classList.remove('hidden');
  el.card.classList.add('menu-open');
  const b = btn.getBoundingClientRect();
  const c = el.card.getBoundingClientRect();
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
  dragState = null;
  dragging = false;
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

/* ============ 初始化 ============ */
async function init() {
  const data = await window.api.loadData();
  state.notes = data.notes || [];
  state.settings = data.settings;

  if (!state.notes.length) {
    state.notes.push({ id: uid(), title: '', tags: [], content: '', createdAt: Date.now(), updatedAt: Date.now() });
  }
  state.activeId = state.settings.activeNoteId && state.notes.find(n => n.id === state.settings.activeNoteId)
    ? state.settings.activeNoteId
    : state.notes[0].id;
  // 启动时清掉历史遗留的空便笺
  if (pruneEmptyNotes(state.activeId)) state.settings.activeNoteId = state.activeId;

  // 应用设置
  el.smOpacity.value = state.settings.opacity;
  applyGlass(state.settings.opacity);
  el.smAlwaysOnTop.checked = state.settings.alwaysOnTop;
  el.btnPin.classList.toggle('active', state.settings.alwaysOnTop);
  el.smHotkeyHint.textContent = formatHotkey(await window.api.getHotkey());

  loadActiveNote();
  scheduleSave(100);

  // 托盘"新建便签"指令
  if (window.api.onNewNote) window.api.onNewNote(() => newNote());
}

init();
