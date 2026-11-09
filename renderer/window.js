'use strict';

/* window.js —— 窗口：按钮、设置面板、拖动、缩放、点击穿透、激活描边、贴边收起、快速捕捉
   各脚本是同一页面里的普通 <script>，顶层声明互相可见；按 index.html 中的顺序加载。 */

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

/* ============ 浮层（设置 / 这张便笺 / 便笺切换） ============ */
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

const MENUS = [el.settingsMenu, el.noteMenu, el.switcherMenu];

function closeMenus() {
  el.settingsMenu.classList.add('hidden');
  el.noteMenu.classList.add('hidden');
  el.switcherMenu.classList.add('hidden');
  el.switcher.setAttribute('aria-expanded', 'false');
  if (el.card.classList.contains('menu-open')) window.api.setMenuOpen(false);
  el.card.classList.remove('menu-open');
}

/* 点按钮开关浮层；同一时间只开一个 */
function toggleMenu(menu, btn, align) {
  if (menu.classList.contains('hidden')) {
    closeMenus();
    openMenu(menu, btn, align);
    return true;
  }
  closeMenus();
  return false;
}

el.btnSettings.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu(el.settingsMenu, el.btnSettings);
});
el.btnNoteMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  if (el.noteMenu.classList.contains('hidden')) {
    const note = currentNote();
    el.nmPinLabel.textContent = note && note.pinned ? '取消固定' : '固定在列表最前';
  }
  toggleMenu(el.noteMenu, el.btnNoteMenu, 'left');
});
document.addEventListener('click', (e) => {
  if (MENUS.some(m => m.contains(e.target))) return;
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

/* ---- 这张便笺：颜色、纸张、重命名、标签、固定、贴到桌面 ---- */
el.nmSwatches.addEventListener('click', (e) => {
  const b = e.target.closest('.swatch');
  const note = currentNote();
  if (!b || !note) return;
  note.color = b.dataset.theme === 'glass' ? undefined : b.dataset.theme;
  applyTheme(note);
  scheduleSave(100);
});

el.nmPaper.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  const note = currentNote();
  if (!b || !note) return;
  note.paper = b.dataset.paper === 'plain' ? undefined : b.dataset.paper;
  applyTheme(note);
  scheduleSave(100);
});

const noteMenuAction = (id, fn) => document.getElementById(id).addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenus();
  fn(currentNote());
});
noteMenuAction('nm-rename', () => startRename());
noteMenuAction('nm-tag', () => openTagInput());
noteMenuAction('nm-stick', (note) => { if (note) stickNote(note.id); });
noteMenuAction('nm-delete', () => deleteNote());
noteMenuAction('nm-pin', (note) => {
  if (!note) return;
  note.pinned = !note.pinned;
  applyDisplayOrder();
  scheduleSave(100);
  toast(note.pinned ? '已固定在列表最前' : '已取消固定');
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

/* ============ 开机自动启动 ============ */
el.smAutoLaunch.addEventListener('change', async () => {
  el.smAutoLaunch.checked = await window.api.setAutoLaunch(el.smAutoLaunch.checked);
});
// 状态以系统为准（用户可能在系统设置里关掉了），每次打开设置面板时刷新
el.btnSettings.addEventListener('click', async () => {
  if (!IS_STICKY) el.smAutoLaunch.checked = await window.api.getAutoLaunch();
});

/* ============ 数据位置：可放到 OneDrive / 坚果云等同步文件夹，多台电脑共用便笺 ============ */
async function showDataDir() {
  const { dir, isDefault } = await window.api.getDataDir();
  el.smDataDir.textContent = isDefault ? '默认位置' : dir.split(/[\\/]/).filter(Boolean).slice(-2).join('/');
  el.smDataDir.title = dir + '\n点击打开文件夹';
  el.smDataDirReset.hidden = isDefault;
}

el.smDataDir.addEventListener('click', (e) => { e.stopPropagation(); window.api.openDataDir(); });
for (const [btn, fn] of [[el.smDataDirChange, 'pickDataDir'], [el.smDataDirReset, 'resetDataDir']]) {
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    persist(); // 先把没保存的改动交给主进程，再切换
    const r = await window.api[fn]();
    if (r && r.ok === false && r.error) toast(r.error);
    // 成功时主进程会重新加载所有窗口
  });
}

/* ============ 版本与自动更新 ============ */
const UPDATE_LABEL = {
  dev: ['开发版不自动更新', true],
  portable: ['便携版请手动下载新版本', true],
  unsupported: ['此安装方式不支持自动更新', true],
  idle: ['检查更新', false],
  latest: ['已是最新版本', false],
  checking: ['正在检查…', true],
  error: ['检查失败，点击重试', false]
};
let readyToastShown = false;

function showUpdateState(st) {
  if (!st) return;
  let [label, disabled] = UPDATE_LABEL[st.status] || ['检查更新', false];
  if (st.status === 'downloading') { label = `正在下载 v${st.version} · ${st.percent || 0}%`; disabled = true; }
  if (st.status === 'ready') { label = `重启更新到 v${st.version}`; disabled = false; }
  el.smUpdate.textContent = label;
  el.smUpdate.disabled = disabled;
  el.smUpdate.title = st.status === 'error' ? (st.error || '') : '';
  el.smUpdate.classList.toggle('ready', st.status === 'ready');
  if (st.status === 'ready' && !readyToastShown && !IS_STICKY) {
    readyToastShown = true;
    toastAction(`新版本 v${st.version} 已下载`, '重启更新', () => window.api.installUpdate(), 15000);
  }
}

el.smUpdate.addEventListener('click', async (e) => {
  e.stopPropagation();
  const st = await window.api.getUpdateState();
  if (st.status === 'ready') window.api.installUpdate();
  else showUpdateState(await window.api.checkForUpdate());
});

/* ============ 自定义快捷键：点按钮后按下新的组合键 ============ */
let hotkeyState = null;

function showHotkeys(info) {
  hotkeyState = info;
  el.smHotkeyHint.textContent = formatHotkey(info);
  el.smCaptureHint.textContent = formatHotkey(info && info.capture);
}

/* KeyboardEvent.code → Electron 快捷键里的按键名 */
const CODE_KEYS = {
  Space: 'Space', Tab: 'Tab', Enter: 'Return', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`'
};

function accelFromEvent(e) {
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else if (/^Numpad\d$/.test(e.code)) key = 'num' + e.code.slice(6);
  else key = CODE_KEYS[e.code] || null;
  if (!key) return null; // 只按了修饰键，继续等
  const mods = [];
  if (e.ctrlKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  // 全局快捷键至少要有 Ctrl / Alt / Win 之一（F1–F24 例外），否则会抢走正常打字
  const strong = e.ctrlKey || e.altKey || e.metaKey;
  if (!strong && !/^F\d+$/.test(key)) return '';
  return [...mods, key].join('+');
}

function hotkeyTip(text, isError) {
  el.smHotkeyTip.hidden = !text;
  el.smHotkeyTip.textContent = text || '';
  el.smHotkeyTip.classList.toggle('error', !!isError);
}

function startRecordHotkey(btn) {
  if (document.querySelector('.hotkey-btn.recording')) return;
  const which = btn.dataset.which;
  btn.classList.add('recording');
  btn.textContent = '请按下组合键…';
  hotkeyTip('Esc 取消 · Backspace 恢复默认');
  window.api.suspendHotkeys(true);

  const finish = async (acc) => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onAway, true);
    btn.classList.remove('recording');
    let msg = '';
    let err = false;
    if (acc !== undefined) {
      const r = await window.api.setHotkey(which, acc);
      if (!r.ok) {
        err = true;
        msg = r.reason === 'duplicate' ? '和另一个快捷键重复了，换一个吧' : '这个组合被其他软件占用了，换一个吧';
      } else {
        msg = acc ? '已保存' : '已恢复默认';
      }
    }
    await window.api.suspendHotkeys(false);
    showHotkeys(await window.api.getHotkey());
    hotkeyTip(msg, err);
    if (msg && !err) setTimeout(() => { if (el.smHotkeyTip.textContent === msg) hotkeyTip(''); }, 1800);
  };
  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation(); // 不让 Esc 关掉设置面板、不让快捷键触发编辑操作
    if (e.key === 'Escape') { finish(undefined); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey) { finish(''); return; }
    const acc = accelFromEvent(e);
    if (acc === null) return;
    if (acc === '') { hotkeyTip('至少要带 Ctrl / Alt / Win 之一', true); return; }
    finish(acc);
  };
  const onAway = (e) => { if (e.target !== btn) finish(undefined); };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onAway, true);
}

document.querySelectorAll('.hotkey-btn').forEach(btn => {
  btn.addEventListener('click', (e) => { e.stopPropagation(); startRecordHotkey(btn); });
});

/* ============ 自定义拖动（工具栏） ============ */
let dragState = null;
let dragging = false;
let resizing = false;

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

/* ============ 调整大小：四条边、四个角都能拖 ============
   主进程记下开始时的窗口位置和大小，这里只发「从按下到现在移动了多少」，
   拖左边 / 上边时窗口的右边 / 下边保持不动。 */
document.querySelectorAll('[data-edge]').forEach(handle => {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const edge = handle.dataset.edge;
    const startX = e.screenX, startY = e.screenY;
    handle.setPointerCapture(e.pointerId);
    resizing = true;
    window.api.resizeStart();
    const onMove = (ev) => window.api.resizeMove(edge, ev.screenX - startX, ev.screenY - startY);
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      resizing = false;
      recomputeIgnore();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
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
  if (!dragging && !resizing) recomputeIgnore();
});

function formatHotkey(info) {
  if (!info || !info.acc) return '未注册';
  const acc = String(info.acc)
    .replace('CommandOrControl', 'Ctrl')
    .replace('Control', 'Ctrl')
    .replace('Command', 'Cmd');
  return info.ok ? acc : acc + '（注册失败，可能被占用）';
}

/* ============ 窗口是否激活：激活时卡片有一圈淡淡的主题色描边 ============ */
function syncWindowFocus() {
  document.body.classList.toggle('window-focused', document.hasFocus());
}
window.addEventListener('focus', syncWindowFocus);
window.addEventListener('blur', syncWindowFocus);
syncWindowFocus();

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
  Undo.before();
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
  Undo.record();
  persist();
  if (!document.hidden) toast('已捕捉到「' + noteTitle(note) + '」');
}
