'use strict';

/* editor.js —— 编辑器：待办、缩进、Markdown 快捷输入、图片、粘贴、链接、快捷键
   各脚本是同一页面里的普通 <script>，顶层声明互相可见；按 index.html 中的顺序加载。 */

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

/* 对选中的每一行（或光标所在行）执行 fn(lines, mkStart, mkEnd)，结束后恢复选区 */
function withSelectedLines(fn) {
  Undo.before();
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

  fn(lines, mkStart, mkEnd);

  const r = document.createRange();
  r.setStartAfter(mkStart);
  r.setEndBefore(mkEnd);
  mkStart.remove();
  mkEnd.remove();
  sel.removeAllRanges();
  sel.addRange(r);
  Undo.record();
  scheduleSave(100);
}

/* Ctrl+Shift+T：把选中的每一行（或光标所在行）转成待办；已全是待办则还原为普通文字 */
function toggleTodo() {
  withSelectedLines((lines, mkStart, mkEnd) => {
    const allTodo = lines.every(l => lineCheckbox(l));
    lines.forEach(l => (allTodo ? unmakeTodo(l) : makeTodo(l)));
    if (!allTodo) { placeAfterCheckbox(mkStart); placeAfterCheckbox(mkEnd); }
  });
}

/* ---- 缩进：Tab / Shift+Tab ----
   普通行和待办行用 data-indent 记录缩进级数（随内容保存）；列表项交给浏览器嵌套成子列表。 */
const MAX_INDENT = 6;

function setIndent(line, level) {
  const n = Math.min(MAX_INDENT, Math.max(0, level));
  if (n) line.dataset.indent = String(n);
  else delete line.dataset.indent;
}

function indentLines(delta) {
  const sel = window.getSelection();
  const a = sel.rangeCount ? sel.anchorNode : null;
  const host = a && (a.nodeType === 3 ? a.parentElement : a);
  if (host && el.editor.contains(host) && host.closest('li')) {
    Undo.before();
    document.execCommand(delta > 0 ? 'indent' : 'outdent');
    Undo.record();
    scheduleSave(100);
    return;
  }
  withSelectedLines((lines) => {
    lines.forEach(l => {
      if (l.nodeType !== 1 || /^(UL|OL)$/.test(l.tagName)) return;
      setIndent(l, (Number(l.dataset.indent) || 0) + delta);
    });
  });
}

/* 光标是否在一行的最开头（忽略待办的复选框和其后的空格） */
function caretAtLineStart(line) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = document.createRange();
  r.setStart(line, 0);
  r.setEnd(sel.anchorNode, sel.anchorOffset);
  return !r.toString().replace(/[\u00a0\s]/g, '');
}

el.editor.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'Tab') {
    e.preventDefault(); // 否则焦点会跳出编辑区
    indentLines(e.shiftKey ? -1 : 1);
    return;
  }
  // 缩进行的开头按退格：先取消一级缩进，而不是删掉上一行的字
  if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey) {
    const line = caretLine();
    if (line && line.nodeType === 1 && Number(line.dataset.indent) > 0 && caretAtLineStart(line)) {
      e.preventDefault();
      Undo.before();
      setIndent(line, Number(line.dataset.indent) - 1);
      Undo.record();
      scheduleSave(100);
    }
  }
});

/* ---- 待办行的光标位置 ----
   待办行是弹性布局（复选框和文字对齐），点在行尾右侧空白处时，浏览器会把光标放到整行最前面，
   也就是复选框前面，打的字也跑到复选框前面去。这里纠正：
   - 点在文字右侧空白处 → 光标放到文字末尾
   - 光标落在复选框前面（点击、Home、方向键都可能）→ 挪到复选框后面 */
function setCaret(node, offset) {
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

/* 复选框后面那个空格之后 */
function caretAfterCheckbox(line) {
  const cb = lineCheckbox(line);
  const sp = cb && cb.nextSibling;
  if (sp && sp.nodeType === 3 && sp.data.startsWith('\u00a0')) setCaret(sp, 1);
  else if (cb) setCaret(line, Array.prototype.indexOf.call(line.childNodes, cb) + 1);
}

/* 这一行文字的末尾（最后一个文本节点的结尾；没有文字就放在复选框后面） */
function caretLineEnd(line) {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let last = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) last = n;
  if (last) setCaret(last, last.length);
  else caretAfterCheckbox(line);
}

/* 光标是否在“复选框 + 后面的空格”之前（在复选框前面，或夹在复选框和空格之间） */
function caretBeforeCheckbox(line) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const cb = lineCheckbox(line);
  if (!cb) return false;
  const caret = document.createRange();
  caret.setStart(sel.anchorNode, sel.anchorOffset);
  const textStart = document.createRange();
  const sp = cb.nextSibling;
  if (sp && sp.nodeType === 3 && sp.data.startsWith('\u00a0')) textStart.setStart(sp, 1);
  else textStart.setStartAfter(cb);
  return caret.compareBoundaryPoints(Range.START_TO_START, textStart) < 0;
}

/* 在按下鼠标的那一刻就接管：如果等浏览器先把光标放到行首、点击结束后再挪，会看到光标从头跳到尾。
   只处理点在待办行空白处（文字右侧，或复选框与文字之间）；点文字、点复选框、双击、Shift 点击都交给浏览器 */
el.editor.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.detail > 1 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  const line = e.target && e.target.closest && e.target.closest('.todo');
  if (!line || e.target !== line || !el.editor.contains(line) || !lineCheckbox(line)) return;
  const r = document.createRange();
  r.selectNodeContents(line);
  const rects = [...r.getClientRects()].filter(x => x.width || x.height);
  const textRight = rects.length ? Math.max(...rects.map(x => x.right)) : 0;
  const cbRect = lineCheckbox(line).getBoundingClientRect();
  const toEnd = e.clientX >= textRight - 1;
  const toStart = !toEnd && e.clientX > cbRect.right && e.clientX < cbRect.right + 12;
  if (!toEnd && !toStart) return;
  e.preventDefault(); // 不让浏览器自己放光标（它会放到复选框前面）
  if (document.activeElement !== el.editor) el.editor.focus({ preventScroll: true });
  if (toEnd) caretLineEnd(line);
  else caretAfterCheckbox(line);
});

/* 光标所在的待办行（不在待办行里返回 null） */
function caretTodoLine() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !el.editor.contains(sel.anchorNode)) return null;
  const a = sel.anchorNode;
  const line = (a.nodeType === 1 && a.classList && a.classList.contains('todo')) ? a : (a.nodeType === 3 ? a.parentElement : a).closest('.todo');
  return line && el.editor.contains(line) && lineCheckbox(line) ? line : null;
}

// Home：直接放到复选框后面的文字开头（不等 selectionchange，避免紧接着打字时来不及纠正）
el.editor.addEventListener('keydown', (e) => {
  if (e.key !== 'Home' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  const line = caretTodoLine();
  if (!line) return;
  e.preventDefault();
  caretAfterCheckbox(line);
});

// 真要输入时再兜底一次：光标还在复选框前面，就先挪到文字开头再输入
el.editor.addEventListener('beforeinput', (e) => {
  if (!e.inputType.startsWith('insert') || e.isComposing) return;
  const line = caretTodoLine();
  if (line && caretBeforeCheckbox(line)) caretAfterCheckbox(line);
}, true);

document.addEventListener('selectionchange', () => {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed || !el.editor.contains(sel.anchorNode)) return;
  const a = sel.anchorNode;
  const line = (a.nodeType === 1 && a.classList.contains('todo')) ? a : (a.nodeType === 3 ? a.parentElement : a).closest('.todo');
  if (line && el.editor.contains(line) && caretBeforeCheckbox(line)) caretAfterCheckbox(line);
});

/* 光标放到正文末尾 */
function focusEditorEnd() {
  el.editor.focus();
  const r = document.createRange();
  r.selectNodeContents(el.editor);
  r.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
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
    Undo.before();
    unmakeTodo(line);
    const r = document.createRange();
    r.setStart(line, 0);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    Undo.record();
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
  Undo.record();
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

/* 在光标处插入图片，后面跟一个换行，光标放到图片之后（接着打字在图片下方）；
   光标不在编辑区里时追加到末尾 */
function insertImageAtCaret(img) {
  const sel = window.getSelection();
  let range;
  if (sel.rangeCount && el.editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    range = sel.getRangeAt(0);
    range.deleteContents();
  } else {
    range = document.createRange();
    range.selectNodeContents(el.editor);
    range.collapse(false);
  }
  const br = document.createElement('br');
  range.insertNode(br);  // 先插换行，再把图片插到它前面：顺序是 图片 → 换行 → 光标
  range.insertNode(img);
  const after = document.createRange();
  after.setStartAfter(br);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
  el.editor.focus();
}

/* ---- 图片压缩：长边超过 1920 像素就等比缩小，再转成 WebP ----
   一张 4K 截图原样保存要 5–10MB；压缩后通常只剩几百 KB，便笺里看不出区别。
   GIF 保持原样（会丢动画）；压缩后反而变大的小图标也保留原图。 */
const IMAGE_MAX_SIDE = 1920;
const IMAGE_QUALITY = 0.86;

function dataUrlBytes(dataUrl) {
  const i = dataUrl.indexOf(',');
  return Math.floor((dataUrl.length - i - 1) * 3 / 4);
}

async function compressImage(dataUrl) {
  if (!/^data:image\/(png|jpe?g|webp|bmp)/i.test(dataUrl)) return dataUrl; // gif 等原样保存
  try {
    // 用 <img> 解码：页面的安全策略不允许 fetch(data:)，但允许图片使用 data: 地址
    const bmp = new Image();
    bmp.src = dataUrl;
    await bmp.decode();
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bmp.naturalWidth, bmp.naturalHeight));
    const w = Math.max(1, Math.round(bmp.naturalWidth * scale));
    const h = Math.max(1, Math.round(bmp.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    const out = canvas.toDataURL('image/webp', IMAGE_QUALITY);
    if (!out.startsWith('data:image/webp')) return dataUrl; // 编码失败
    return scale < 1 || dataUrlBytes(out) < dataUrlBytes(dataUrl) ? out : dataUrl;
  } catch (e) {
    console.warn('compressImage', e);
    return dataUrl;
  }
}

async function insertImage(dataUrl) {
  const note = currentNote();
  if (!note) return;
  try {
    const url = await window.api.saveImage(note.id, await compressImage(dataUrl));
    const img = document.createElement('img');
    img.src = url;
    Undo.before();
    insertImageAtCaret(img);
    Undo.record();
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
    openSwitcher();
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

/* 工具栏「待办」：按下时不抢走编辑器的焦点和选区，否则就不知道要转换哪几行了 */
el.btnTodo.addEventListener('mousedown', (e) => e.preventDefault());
el.btnTodo.addEventListener('click', () => { closeMenus(); toggleTodo(); });

/* 在标签栏打开输入框（「＋ 标签」、这张便笺的菜单、Ctrl+Shift+L） */
function openTagInput() {
  if (el.tagBar.querySelector('.tag-input')) {
    el.tagBar.querySelector('.tag-input').focus();
    return;
  }
  const input = document.createElement('input');
  input.className = 'tag-input';
  input.placeholder = '标签名，回车确认';
  input.maxLength = 20;
  el.tagBar.classList.add('adding');
  el.tagBar.appendChild(input);
  input.focus();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim().replace(/^#+/, '');
    input.remove();
    el.tagBar.classList.remove('adding');
    if (save && v) addTag(v);
  };
  const commit = () => finish(true);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); el.editor.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); el.editor.focus(); }
  });
  input.addEventListener('blur', commit);
}

/* 打开切换菜单（Ctrl+F 时直接定位到搜索框） */
function openSwitcher() {
  if (IS_STICKY) return; // 桌面便笺只有一张，没有切换菜单
  closeMenus();
  saveCurrentContent();
  buildSwitcherMenu();
  openMenu(el.switcherMenu, el.switcher, 'left');
  el.switcher.setAttribute('aria-expanded', 'true');
  menuSearch.focus();
}

/* 窗口内快捷键：Ctrl+N 新建、Ctrl+F 搜索 */
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.shiftKey || e.altKey || e.repeat) return;
  const key = e.key.toLowerCase();
  if (key === 'n' && !IS_STICKY) { e.preventDefault(); closeMenus(); newNote(); }
  else if (key === 'f' && !IS_STICKY) {
    e.preventDefault();
    if (el.switcherMenu.classList.contains('hidden') || !menuSearch) openSwitcher();
    else { menuSearch.focus(); menuSearch.select(); }
  }
});

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
/* 粘贴：图片照常插入；网页 / Word 内容清理掉样式，只留结构；Ctrl+Shift+V 只粘贴纯文本 */
let plainPasteUntil = 0;
el.editor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') plainPasteUntil = Date.now() + 800;
});

el.editor.addEventListener('paste', async (e) => {
  const cd = e.clipboardData;
  if (!cd) return;
  for (const item of cd.items || []) {
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
  e.preventDefault();
  const plainOnly = Date.now() < plainPasteUntil;
  plainPasteUntil = 0;
  const html = plainOnly ? '' : cd.getData('text/html');
  const text = cd.getData('text/plain');
  let out = '';
  if (html) {
    out = window.Paste.sanitizeHtml(html).html;
    if (!out.replace(/<[^>]+>/g, '').trim() && text) out = window.Paste.textToHtml(text);
  } else if (text) {
    out = window.Paste.textToHtml(text);
  }
  if (!out) return;
  Undo.before();
  window.Paste.insertHtmlAtCaret(el.editor, out);
  Undo.record();
  scheduleSave(100);
});

/* 链接：打字时网址后敲空格 / 回车自动变成链接；按住 Ctrl 单击用浏览器打开 */
el.editor.addEventListener('input', (e) => {
  if (e.inputType === 'insertText' && e.data && /^[\s\u3000]$/.test(e.data)) {
    if (window.Paste.linkifyBeforeCaret(el.editor, 1)) scheduleSave();
  }
});
el.editor.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) window.Paste.linkifyBeforeCaret(el.editor, 0);
});
el.editor.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a');
  if (!a || !el.editor.contains(a)) return;
  e.preventDefault();
  if ((e.ctrlKey || e.metaKey) && window.Paste.isSafeUrl(a.getAttribute('href'))) {
    window.api.openExternal(a.getAttribute('href'));
  }
});
const syncCtrl = (e) => document.body.classList.toggle('ctrl-held', e.ctrlKey || e.metaKey);
document.addEventListener('keydown', syncCtrl);
document.addEventListener('keyup', syncCtrl);
window.addEventListener('blur', () => document.body.classList.remove('ctrl-held'));

// 待办勾选：迸出几颗小圆点；整张便笺的待办全部完成时只给一句提示
el.editor.addEventListener('change', (e) => {
  const cb = e.target;
  if (!cb || !cb.matches('input[type=checkbox]')) return;
  if (cb.checked) {
    countDone(1);
    const r = cb.getBoundingClientRect();
    const boxes = [...el.editor.querySelectorAll('input[type="checkbox"]')];
    const allDone = boxes.length >= 2 && boxes.every(b => b.checked);
    if (allDone) toast('全部完成，休息一下吧');
    else window.Life.burst(r.left + r.width / 2, r.top + r.height / 2);
  } else {
    countDone(-1);
  }
  Undo.record();
  updateStatus();
  scheduleSave(100);
});
el.editor.addEventListener('input', () => scheduleSave());

