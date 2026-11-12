'use strict';

/* notes.js —— 便笺的新建 / 删除 / 切换、最近删除、贴到桌面
   各脚本是同一页面里的普通 <script>，顶层声明互相可见；按 index.html 中的顺序加载。 */

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

/* 第一次打开时的欢迎便笺：用几条待办带用户把主要功能走一遍，勾完删掉即可 */
function welcomeNote(hk) {
  const key = (info, fallback) => (info && info.ok && info.acc ? '<strong>' + escapeHtml(formatHotkey(info)) + '</strong>' : fallback);
  const toggle = key(hk, '唤起快捷键');
  const capture = key(hk && hk.capture, '快速捕捉快捷键');
  const todo = (html) => `<div class="todo"><input type="checkbox">\u00a0${html}</div>`;
  const note = blankNote();
  note.title = '欢迎使用 FloatNote';
  note.content = [
    '<div>你好！这是一张便笺，写下的内容会自动保存。跟着下面几步熟悉一下，做完一件就勾掉一件：</div>',
    todo(`在任何程序里按 ${toggle}，隐藏或唤回这个窗口`),
    todo('点工具栏上的「待办」按钮，把一行文字变成可以勾选的待办'),
    todo('点「⋯」给这张便笺换个颜色、换种纸张'),
    todo('把窗口拖到屏幕左边或右边，它会收成一条细边，鼠标移过去就展开'),
    todo(`在浏览器里选中一段文字，按 ${capture}，它会被收进当前便笺`),
    todo('点「⋯」→「贴到桌面」，把一张便笺单独贴在桌面上'),
    '<div><br></div>',
    '<div>小技巧：行首输入「- 」（减号加空格）变成圆点列表，「1. 」变成编号列表，「[] 」变成待办；在列表开头按退格可以去掉圆点。</div>',
    '<div>右上角「设置」里可以改快捷键、透明度，看便笺保存在哪个文件夹，还有全部快捷键的说明。看完点垃圾桶删掉这张就好。</div>'
  ].join('');
  return note;
}

/* 删除立即生效，5 秒内可从提示条撤销（图片文件不会被删，撤销后照常显示） */
function deleteNote() {
  saveCurrentContent();
  const note = currentNote();
  if (!note) return;
  const wasEmpty = isNoteEmpty(note);
  if (!wasEmpty) window.Life.tearOff(el.card); // 像便利贴一样被撕下来

  // 下一张：前面最近的一张，没有就往后找；一张都不剩就新建一张空便笺
  const live = liveNotes().filter(n => !state.stuck.has(n.id));
  const idx = live.indexOf(note);
  let next = live.slice(0, idx).reverse()[0] || live.slice(idx + 1)[0];
  if (!next) {
    next = blankNote();
    state.notes.unshift(next);
  }

  if (wasEmpty) {
    // 空便笺没什么可找回的，直接删掉
    state.notes.splice(state.notes.indexOf(note), 1);
    Undo.forget(note.id);
  } else {
    note.trashed = Date.now(); // 移到「最近删除」，30 天后才真正删除
  }
  state.activeId = next.id;
  state.settings.activeNoteId = state.activeId;
  loadActiveNote();
  scheduleSave(100);
  if (!wasEmpty) {
    toastAction('已移到「最近删除」', '撤销', () => restoreNote(note.id));
  }
}

/* ============ 最近删除 ============ */
const TRASH_DAYS = 30;

function trashedNotes() {
  return state.notes.filter(n => n.trashed).sort((a, b) => b.trashed - a.trashed);
}

/* 从「最近删除」恢复，并切换过去 */
function restoreNote(id) {
  const note = state.notes.find(n => n.id === id);
  if (!note || !note.trashed) return;
  saveCurrentContent();
  delete note.trashed;
  state.activeId = note.id;
  state.settings.activeNoteId = note.id;
  loadActiveNote(false);
  window.Life.stickIn(el.card); // 贴回来
  scheduleSave(100);
}

/* 彻底删除（不可恢复） */
function purgeNotes(ids) {
  const del = new Set(ids);
  state.notes = state.notes.filter(n => !del.has(n.id));
  ids.forEach(id => Undo.forget(id));
  scheduleSave(100);
}

function daysLeft(note) {
  const left = TRASH_DAYS - Math.floor((Date.now() - note.trashed) / 86400000);
  return Math.max(0, left);
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
  const returned = [...state.stuck].filter(id => !next.has(id) && liveNotes().some(n => n.id === id));
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
  normalizeTodoLines();
  if (note) {
    // 以浏览器序列化后的 HTML 为基准，避免 checked → checked="checked" 之类的差异被当成“编辑”
    syncCheckboxAttrs();
    note.content = el.editor.innerHTML;
    Undo.setNote(note.id); // 每张便笺各自的撤销记录
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

