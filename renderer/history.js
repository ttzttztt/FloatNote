'use strict';

/* ============ 撤销 / 重做 ============
   浏览器自带的撤销只认它自己的输入；待办切换、缩进、Markdown 快捷输入、粘贴清理、
   快速捕捉这些直接改 DOM 的操作它都撤销不了，两套记录还会互相打架。
   所以这里完全接管：每张便笺各自保存「内容 + 光标位置」的快照栈。

   记录时机：
   - 连续打字合并成一步：停顿 600ms、或从“输入”切换到“删除”、或按回车时记一步
   - 自定义操作：操作前 before() 先把未记录的打字记下来，操作后 record() 再记一步 */
(function () {
  const LIMIT = 200;
  const IDLE = 600;

  let editor = null;
  let serialize = null; // () => 编辑器当前 HTML（含复选框勾选状态）
  let onApply = null;   // 撤销 / 重做恢复内容之后的回调（保存、刷新标题等）
  const stacks = new Map(); // noteId -> { list: [{ html, sel }], index }
  let noteId = null;
  let pending = null;
  let lastKind = null;

  /* ---- 光标位置：记成“从编辑器出发的子节点下标路径 + 偏移”，恢复同一份 HTML 后路径依然有效 ---- */
  function nodePath(node) {
    const path = [];
    while (node && node !== editor) {
      const p = node.parentNode;
      if (!p) return null;
      path.unshift(Array.prototype.indexOf.call(p.childNodes, node));
      node = p;
    }
    return node === editor ? path : null;
  }
  function fromPath(path) {
    let n = editor;
    for (const i of path) {
      n = n && n.childNodes[i];
      if (!n) return null;
    }
    return n;
  }
  const maxOffset = (n) => (n.nodeType === 3 ? n.length : n.childNodes.length);

  function captureSel() {
    const s = window.getSelection();
    if (!s.rangeCount || !editor.contains(s.anchorNode)) return null;
    const r = s.getRangeAt(0);
    const sp = nodePath(r.startContainer);
    const ep = nodePath(r.endContainer);
    if (!sp || !ep) return null;
    return { sp, so: r.startOffset, ep, eo: r.endOffset };
  }

  function restoreSel(sel) {
    const s = window.getSelection();
    const r = document.createRange();
    try {
      const sn = sel && fromPath(sel.sp);
      const en = sel && fromPath(sel.ep);
      if (!sn || !en) throw new Error('no path');
      r.setStart(sn, Math.min(sel.so, maxOffset(sn)));
      r.setEnd(en, Math.min(sel.eo, maxOffset(en)));
    } catch (_) {
      r.selectNodeContents(editor);
      r.collapse(false);
    }
    s.removeAllRanges();
    s.addRange(r);
  }

  /* ---- 快照栈 ---- */
  const cur = () => (noteId ? stacks.get(noteId) : null);

  function record() {
    clearTimeout(pending);
    pending = null;
    lastKind = null;
    const st = cur();
    if (!st) return;
    const html = serialize();
    const top = st.list[st.index];
    if (top && top.html === html) {
      top.sel = captureSel(); // 内容没变，只更新光标
      return;
    }
    st.list.splice(st.index + 1); // 撤销后又做了新操作：丢掉“重做”分支
    st.list.push({ html, sel: captureSel() });
    if (st.list.length > LIMIT) st.list.shift();
    st.index = st.list.length - 1;
  }

  /* 有尚未记下的连续输入就先记下来 */
  function before() {
    if (pending) record();
  }

  function apply(entry) {
    editor.innerHTML = entry.html;
    editor.focus();
    restoreSel(entry.sel);
    if (onApply) onApply();
  }

  function undo() {
    before();
    const st = cur();
    if (!st || st.index <= 0) return false;
    st.index--;
    apply(st.list[st.index]);
    return true;
  }

  function redo() {
    before();
    const st = cur();
    if (!st || st.index >= st.list.length - 1) return false;
    st.index++;
    apply(st.list[st.index]);
    return true;
  }

  /* 切换到某张便笺（编辑器内容已经换好）：没有记录就以当前内容为起点 */
  function setNote(id) {
    before();
    noteId = id;
    if (!stacks.has(id)) {
      stacks.set(id, { list: [{ html: serialize(), sel: null }], index: 0 });
    } else {
      record(); // 内容可能在别的窗口被改过：作为新的一步接上
    }
  }

  function forget(id) { stacks.delete(id); }

  function init(opts) {
    editor = opts.editor;
    serialize = opts.serialize;
    onApply = opts.onApply;

    // 在内容改变“之前”判断要不要先记一步，这样才能留住改变前的样子
    editor.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'historyUndo') { e.preventDefault(); undo(); return; }
      if (e.inputType === 'historyRedo') { e.preventDefault(); redo(); return; }
      const kind = e.inputType.startsWith('delete') ? 'del'
        : e.inputType === 'insertParagraph' ? 'para' : 'ins';
      if (pending && (kind !== lastKind || kind === 'para')) record();
      lastKind = kind;
    });
    editor.addEventListener('input', (e) => {
      clearTimeout(pending);
      if (e.inputType === 'insertParagraph') { record(); return; }
      pending = setTimeout(record, IDLE);
    });
    // 接管快捷键，彻底不让浏览器自己的撤销栈插手
    editor.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    });
  }

  window.UndoStack = { init, setNote, forget, record, before, undo, redo };
})();
