'use strict';

/* ============ 「纸与生命」：完成奖励、撕纸动画 ============
   与数据无关的纯表现层，app.js 通过 window.Life 调用。 */
(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 完成待办的小奖励 ---------- */
  const PAW = '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="15.5" rx="5.6" ry="4.6"/><ellipse cx="5.6" cy="9.4" rx="2.3" ry="2.8"/><ellipse cx="10" cy="5.6" rx="2.3" ry="2.8"/><ellipse cx="14.6" cy="5.6" rx="2.3" ry="2.8"/><ellipse cx="18.6" cy="9.4" rx="2.3" ry="2.8"/></svg>';

  /* 勾选时从复选框处迸出几个小爪印 */
  function burst(x, y) {
    if (reduceMotion) return;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('span');
      p.className = 'spark';
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const dist = 22 + Math.random() * 16;
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(ang) * dist - 8 + 'px');
      p.style.setProperty('--rot', (Math.random() * 80 - 40) + 'deg');
      p.style.setProperty('--s', (0.55 + Math.random() * 0.45).toFixed(2));
      p.innerHTML = i % 2 ? PAW : '';
      if (!(i % 2)) p.classList.add('dot');
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 800);
    }
  }

  /* 一张便笺的待办全部完成：一串小爪印从左下角走过卡片底部 */
  function pawTrail(card) {
    if (reduceMotion || !card) return;
    const r = card.getBoundingClientRect();
    const steps = 7;
    for (let i = 0; i < steps; i++) {
      const p = document.createElement('span');
      p.className = 'trail-paw';
      p.innerHTML = PAW;
      const x = r.left + 60 + (i * (r.width - 140)) / (steps - 1);
      const y = r.bottom - 30 - (i % 2 ? 0 : 9);
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.setProperty('--rot', (i % 2 ? 80 : 100) + 'deg');
      p.style.animationDelay = (i * 110) + 'ms';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 1900 + i * 110);
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

  window.Life = { burst, pawTrail, tearOff, stickIn, PAW };
})();
