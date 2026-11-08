'use strict';

/* app.js —— 启动：读取数据、应用设置、绑定主进程事件
   各脚本是同一页面里的普通 <script>，顶层声明互相可见；按 index.html 中的顺序加载。 */

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
    const usable = (id) => id && liveNotes().some(n => n.id === id) && !state.stuck.has(id);
    state.activeId = usable(saved) ? saved : (liveNotes().find(n => !state.stuck.has(n.id)) || (() => {
      const fresh = blankNote();
      state.notes.unshift(fresh);
      return fresh;
    })()).id;
    state.settings.activeNoteId = state.activeId;
    // 启动时清掉历史遗留的空便笺（贴在桌面上的不动）
    pruneEmptyNotes(state.activeId);
  }

  Undo.init({
    editor: el.editor,
    serialize: () => { syncCheckboxAttrs(); return el.editor.innerHTML; },
    onApply: () => {
      saveCurrentContent();
      renderSwitcher();
      updateStatus();
      scheduleSave(100);
    }
  });

  applySettings();
  const hk = await window.api.getHotkey();
  showHotkeys(hk);

  loadActiveNote();
  scheduleSave(100);

  window.api.onPatched(applyRemotePatch);
  window.api.onStickies(onStickiesChanged);
  window.api.onDockState(onDockState);
  if (ctx && ctx.dock) onDockState(ctx.dock);
  window.api.onHotkeyChanged(showHotkeys);
  if (!IS_STICKY) {
    window.api.onNewNote(() => newNote());
    window.api.onCapture(appendCapture);
  }
  // 关窗 / 刷新前把没发出去的改动发出去
  window.addEventListener('beforeunload', persist);
}

init();
