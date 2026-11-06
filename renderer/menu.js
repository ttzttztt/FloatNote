'use strict';

/* menu.js —— 标题、切换菜单（搜索 / 置顶 / 排序 / 最近删除）、重命名、标签、提示条
   各脚本是同一页面里的普通 <script>，顶层声明互相可见；按 index.html 中的顺序加载。 */

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
  const live = liveNotes();
  return [...live.filter(n => n.pinned), ...live.filter(n => !n.pinned)];
}

/* 按显示顺序重排数组（「最近删除」里的接在后面，不能丢） */
function applyDisplayOrder(order = displayOrder()) {
  state.notes = [...order, ...state.notes.filter(n => n.trashed)];
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
  menuFooter = document.createElement('button');
  menuFooter.className = 'menu-footer';
  menuFooter.addEventListener('click', (e) => { e.stopPropagation(); showTrash(); });
  el.switcherMenu.append(menuSearch, menuList, menuFooter);

  menuSearch.addEventListener('input', () => renderMenuItems());
  menuSearch.addEventListener('keydown', (e) => {
    const first = menuList.querySelector('.menu-item');
    if (e.key === 'Enter' && first) { e.preventDefault(); first.click(); }
    else if (e.key === 'ArrowDown' && first) { e.preventDefault(); first.focus(); }
  });
  renderMenuItems();
}

let dragId = null;
let menuFooter = null;

const TRASH_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.8 4.4h10.4M6.4 4.4V3.1h3.2v1.3M4.3 4.4l.6 8.2h6.2l.6-8.2"/></svg>';

/* 菜单底部：「最近删除 · N」，没有删除的便笺时隐藏 */
function updateMenuFooter() {
  if (!menuFooter) return;
  const n = trashedNotes().length;
  menuFooter.hidden = !n;
  menuFooter.innerHTML = `${TRASH_SVG}<span>最近删除</span><span class="mf-count">${n}</span>`;
}

/* 「最近删除」视图：恢复 / 彻底删除 / 清空 */
function showTrash() {
  const list = trashedNotes();
  if (!list.length) { buildSwitcherMenu(); return; }
  el.switcherMenu.innerHTML = '';
  menuSearch = null;
  menuFooter = null;

  const head = document.createElement('div');
  head.className = 'trash-head';
  head.innerHTML = '<button class="trash-back" title="返回">‹ 返回</button><span class="trash-title">最近删除</span><button class="trash-clear">清空</button>';
  const hint = document.createElement('div');
  hint.className = 'trash-hint';
  hint.textContent = `删除的便笺会保留 ${TRASH_DAYS} 天，之后自动彻底删除`;
  menuList = document.createElement('div');
  menuList.className = 'menu-items';
  el.switcherMenu.append(head, hint, menuList);

  head.querySelector('.trash-back').addEventListener('click', (e) => {
    e.stopPropagation();
    buildSwitcherMenu();
    menuSearch.focus();
  });
  // 清空要点两次，避免手滑
  const clearBtn = head.querySelector('.trash-clear');
  let armed = null;
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!armed) {
      clearBtn.textContent = '确认清空？';
      clearBtn.classList.add('danger');
      armed = setTimeout(() => { armed = null; clearBtn.textContent = '清空'; clearBtn.classList.remove('danger'); }, 3000);
      return;
    }
    clearTimeout(armed);
    purgeNotes(trashedNotes().map(n => n.id));
    buildSwitcherMenu();
    toast('「最近删除」已清空');
  });

  list.forEach(n => {
    const item = document.createElement('div');
    item.className = 'menu-item trash-item';
    const left = daysLeft(n);
    item.innerHTML =
      `<span class="mi-dot" data-theme="${THEMES.includes(n.color) ? n.color : 'glass'}"></span>` +
      `<span class="mi-main"><span class="mi-title">${escapeHtml(noteTitle(n))}</span>` +
      `<span class="mi-sub">${left ? `还剩 ${left} 天` : '即将彻底删除'}</span></span>` +
      `<button class="mi-text-btn" title="恢复这张便笺">恢复</button>` +
      `<button class="mi-btn mi-purge" title="彻底删除（不可恢复）" aria-label="彻底删除">${TRASH_SVG}</button>`;
    item.querySelector('.mi-text-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenus();
      restoreNote(n.id);
      toast('已恢复「' + noteTitle(n) + '」');
    });
    item.querySelector('.mi-purge').addEventListener('click', (e) => {
      e.stopPropagation();
      purgeNotes([n.id]);
      showTrash();
    });
    menuList.appendChild(item);
  });
}

function renderMenuItems() {
  if (!menuSearch) return; // 正在看「最近删除」
  updateMenuFooter();
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

    const go = () => {
      closeMenus();
      if (stuck) { window.api.focusSticky(n.id); return; }
      switchTo(n.id);
      focusEditorEnd(); // 切过去就能直接写，不用再点一下
    };
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
      applyDisplayOrder();
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
  applyDisplayOrder(order);
  applyDisplayOrder();
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

