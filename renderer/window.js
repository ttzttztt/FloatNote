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

function formatHotkey(info) {
  if (!info || !info.acc) return '未注册';
  const acc = String(info.acc)
    .replace('CommandOrControl', 'Ctrl')
    .replace('Control', 'Ctrl')
    .replace('Command', 'Cmd');
  return info.ok ? acc : acc + '（注册失败，可能被占用）';
}

