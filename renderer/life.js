'use strict';

/* ============ 「纸与生命」：完成奖励、撕纸动画 ============
   与数据无关的纯表现层，app.js 通过 window.Life 调用。 */
(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 完成待办的小奖励 ----------
     勾选时从复选框处迸出几颗小圆点；big = 整张便笺全部完成，圆点更多、散得更开 */
  function burst(x, y, big = false) {
    if (reduceMotion) return;
    const n = big ? 16 : 7;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('span');
      p.className = 'spark';
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const dist = (big ? 34 : 20) + Math.random() * (big ? 30 : 14);
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(ang) * dist - 8 + 'px');
      p.style.setProperty('--s', (0.5 + Math.random() * 0.6).toFixed(2));
      if (i % 3 === 1) p.classList.add('ring'); // 夹几颗空心圆，层次更轻盈
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 900);
    }
  }

  /* ---------- 撕掉 / 贴回 ----------
     删除时把当前便笺的“纸面”复制一份，像便利贴一样从左上角被撕起、卷走；
     撤销时新内容带一点回弹“贴”回来。 */
  function tearOff(card) {
    if (reduceMotion || !card) return;
    const sheet = card.cloneNode(true);
    sheet.removeAttribute('id');
    sheet.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    sheet.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
    sheet.classList.add('tear-sheet');
    sheet.setAttribute('aria-hidden', 'true');
    card.parentElement.appendChild(sheet);
    // 复制出来的纸里还有复选框等子元素的动画，它们的 animationend 会冒泡上来，只认纸本身的
    sheet.addEventListener('animationend', (e) => { if (e.target === sheet) sheet.remove(); });
    setTimeout(() => sheet.remove(), 1200);
  }

  function stickIn(card) {
    if (reduceMotion || !card) return;
    card.classList.remove('stick-in');
    void card.offsetWidth;
    card.classList.add('stick-in');
    setTimeout(() => card.classList.remove('stick-in'), 700);
  }

  window.Life = { burst, tearOff, stickIn };
})();
