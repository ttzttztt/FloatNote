'use strict';

/* ============ 粘贴清理与链接 ============
   从网页 / Word 粘贴时只保留结构（段落、换行、标题、列表、加粗斜体、链接），
   丢掉字体、颜色、字号、背景、class、style 等一切样式；远程图片在本应用里也显示不了，一并丢掉。 */
(function () {
  const SAFE_URL = /^(https?:|mailto:)/i;
  // 网址：http(s):// 开头，或 www. 开头；结尾的中英文标点不算进链接
  const URL_RE = /(https?:\/\/[^\s<>"'，。；：！？、）】》]+|www\.[^\s<>"'，。；：！？、）】》]+\.[^\s<>"'，。；：！？、）】》]+)/g;
  const TRAIL_PUNCT = /[.,;:!?)\]}'"]+$/;

  const DROP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'IFRAME',
    'OBJECT', 'EMBED', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'IMG', 'PICTURE', 'FORM']);
  const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'BLOCKQUOTE',
    'FIGURE', 'FIGCAPTION', 'ADDRESS', 'DT', 'DD', 'TR', 'CAPTION', 'DETAILS', 'SUMMARY', 'HR']);
  const INLINE_KEEP = { B: 'strong', STRONG: 'strong', I: 'em', EM: 'em', U: 'u', S: 's', STRIKE: 's', DEL: 's', CODE: 'code' };

  function normalizeUrl(u) {
    return /^www\./i.test(u) ? 'https://' + u : u;
  }

  function makeLink(href, text) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    a.title = t('Ctrl + 单击打开');
    return a;
  }

  /* 把源节点的子节点按白名单搬到 dst，返回是否包含块级内容 */
  function walk(src, dst, ctx) {
    for (const node of Array.from(src.childNodes)) {
      if (node.nodeType === 3) {
        const text = ctx.pre ? node.data : node.data.replace(/[\s ]+/g, ' ');
        if (!text) continue;
        if (ctx.pre) {
          text.split('\n').forEach((part, i) => {
            if (i) dst.appendChild(document.createElement('br'));
            if (part) dst.appendChild(document.createTextNode(part));
          });
        } else {
          dst.appendChild(document.createTextNode(text));
        }
        continue;
      }
      if (node.nodeType !== 1) continue; // 注释（Word 的 <!--StartFragment--> 等）
      const tag = node.tagName.toUpperCase();
      if (DROP.has(tag)) continue;
      if (tag === 'BR') { dst.appendChild(document.createElement('br')); continue; }

      if (BLOCK.has(tag) || tag === 'PRE' || /^H[1-6]$/.test(tag) || tag === 'LI' && !ctx.list) {
        ctx.block = true;
        if (tag === 'HR') continue;
        const el = document.createElement(/^H[12]$/.test(tag) ? 'h2' : /^H[3-6]$/.test(tag) ? 'h3' : 'div');
        walk(node, el, Object.assign({}, ctx, { pre: ctx.pre || tag === 'PRE', list: false }));
        dst.appendChild(el);
        continue;
      }
      if (tag === 'UL' || tag === 'OL') {
        ctx.block = true;
        const el = document.createElement(tag.toLowerCase());
        walk(node, el, Object.assign({}, ctx, { list: true }));
        dst.appendChild(el);
        continue;
      }
      if (tag === 'LI') {
        const el = document.createElement('li');
        walk(node, el, Object.assign({}, ctx, { list: false }));
        dst.appendChild(el);
        continue;
      }
      if (tag === 'TABLE' || tag === 'TBODY' || tag === 'THEAD' || tag === 'TFOOT') {
        ctx.block = true;
        walk(node, dst, ctx);
        continue;
      }
      if (tag === 'TD' || tag === 'TH') {
        walk(node, dst, ctx);
        dst.appendChild(document.createTextNode('  '));
        continue;
      }
      if (tag === 'A') {
        const href = (node.getAttribute('href') || '').trim();
        if (SAFE_URL.test(href)) {
          const a = makeLink(href, '');
          walk(node, a, ctx);
          if (a.textContent.trim()) dst.appendChild(a);
          continue;
        }
        walk(node, dst, ctx);
        continue;
      }
      if (INLINE_KEEP[tag]) {
        const el = document.createElement(INLINE_KEEP[tag]);
        walk(node, el, ctx);
        if (el.textContent) dst.appendChild(el);
        continue;
      }
      // span、font、Word 的 o:p 等：拆掉标签，只留内容
      walk(node, dst, ctx);
    }
  }

  /* 去掉空块、块首尾多余空格，连续空行最多保留一个 */
  function tidy(root) {
    root.querySelectorAll('div, h2, h3, li').forEach(b => {
      const first = b.firstChild;
      const last = b.lastChild;
      if (first && first.nodeType === 3) first.data = first.data.replace(/^ +/, '');
      if (last && last.nodeType === 3) last.data = last.data.replace(/ +$/, '');
    });
    root.querySelectorAll('div, h2, h3').forEach(b => {
      if (!b.textContent.trim() && !b.querySelector('br, li')) b.remove();
    });
    root.querySelectorAll('ul, ol').forEach(l => { if (!l.querySelector('li')) l.remove(); });
    // 顶层块之间残留的纯空白文本
    Array.from(root.childNodes).forEach(n => {
      if (n.nodeType === 3 && !n.data.trim() && n.previousSibling && n.previousSibling.nodeType === 1) n.remove();
    });
  }

  /* 把文本节点里的网址变成链接（已在链接里的跳过） */
  function linkifyIn(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.parentElement || !n.parentElement.closest('a')) texts.push(n);
    }
    for (const t of texts) {
      const s = t.data;
      URL_RE.lastIndex = 0;
      if (!URL_RE.test(s)) continue;
      URL_RE.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (let m = URL_RE.exec(s); m; m = URL_RE.exec(s)) {
        let url = m[0];
        const trail = (url.match(TRAIL_PUNCT) || [''])[0];
        url = url.slice(0, url.length - trail.length);
        if (!url) continue;
        frag.appendChild(document.createTextNode(s.slice(last, m.index)));
        frag.appendChild(makeLink(normalizeUrl(url), url));
        last = m.index + url.length;
      }
      frag.appendChild(document.createTextNode(s.slice(last)));
      t.replaceWith(frag);
    }
  }

  /* 网页 / Word 的 HTML → 干净的 HTML */
  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = document.createElement('div');
    const ctx = { block: false, pre: false, list: false };
    walk(doc.body, out, ctx);
    tidy(out);
    linkifyIn(out);
    return { html: out.innerHTML, block: ctx.block };
  }

  /* 纯文本 → HTML：转义，换行变 <br>，网址变链接 */
  function textToHtml(text) {
    const out = document.createElement('div');
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach((line, i) => {
      if (i) out.appendChild(document.createElement('br'));
      if (line) out.appendChild(document.createTextNode(line));
    });
    linkifyIn(out);
    return out.innerHTML;
  }

  /* 在光标处插入一段 HTML，光标放到插入内容之后 */
  function insertHtmlAtCaret(editor, html) {
    const sel = window.getSelection();
    let range;
    if (sel.rangeCount && editor.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const frag = tpl.content;
    const lastNode = frag.lastChild;
    if (!lastNode) return;
    range.insertNode(frag);
    const r = document.createRange();
    r.setStartAfter(lastNode);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /* 打字时：光标前刚输入完的网址变成链接（在敲空格 / 回车时调用）。
     skip = 光标前要跳过的字符数（刚敲的空格算 1，回车之前调用则为 0） */
  function linkifyBeforeCaret(editor, skip) {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return false;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3 || !editor.contains(node)) return false;
    if (node.parentElement && node.parentElement.closest('a')) return false;
    const end = sel.anchorOffset - skip;
    if (end <= 0) return false;
    const before = node.data.slice(0, end);
    const m = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+\.[^\s<>"']+)$/i.exec(before);
    if (!m) return false;
    let url = m[0];
    const trail = (url.match(TRAIL_PUNCT) || [''])[0];
    url = url.slice(0, url.length - trail.length);
    if (!url || !/^(https?:\/\/.+|www\..+\..+)$/i.test(url)) return false;
    const start = m.index;
    const caret = sel.anchorOffset;
    // 拆出网址那一段文本，换成 <a>，光标保持在原来的位置
    const urlNode = node.splitText(start);
    const rest = urlNode.splitText(url.length);
    const a = makeLink(normalizeUrl(url), url);
    urlNode.replaceWith(a);
    const r = document.createRange();
    r.setStart(rest, Math.max(0, caret - start - url.length));
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  }

  window.Paste = { sanitizeHtml, textToHtml, insertHtmlAtCaret, linkifyBeforeCaret, isSafeUrl: (u) => SAFE_URL.test(u || '') };
})();
