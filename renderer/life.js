'use strict';

/* ============ 「纸与生命」：小猫、完成奖励、撕纸动画 ============
   与数据无关的纯表现层，app.js 通过 window.Life 调用。 */
(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 角落里的小猫 ----------
     状态：idle（发呆，偶尔眨眼、甩尾巴）/ watch（你在打字，它歪头看）/
     happy（完成待办、被摸头）/ sleep（太久没动静，睡着了）/ wake（醒来伸懒腰） */
  const SLEEP_AFTER = 3 * 60 * 1000; // 3 分钟没有任何操作就睡着
  const cat = document.getElementById('cat');
  let catState = 'idle';
  let lastActivity = Date.now();
  let stateTimer = null;
  let enabled = true;

  function setCat(s, holdMs) {
    if (!cat) return;
    clearTimeout(stateTimer);
    catState = s;
    cat.dataset.state = s;
    // 重新触发同名动画（例如连续两次 happy）
    cat.classList.remove('replay');
    void cat.getBoundingClientRect();
    cat.classList.add('replay');
    if (holdMs) stateTimer = setTimeout(() => setCat('idle'), holdMs);
  }

  function activity() {
    lastActivity = Date.now();
    if (catState === 'sleep') wake();
  }

  function wake() {
    if (catState !== 'sleep') return;
    setCat('wake', 1400);
  }

  const Cat = {
    typing() {
      lastActivity = Date.now();
      if (catState === 'sleep') { wake(); return; }
      if (catState === 'happy' || catState === 'wake') return;
      setCat('watch', 1800);
    },
    happy() { activity(); setCat('happy', 1500); spawnHeart(); },
    celebrate() { activity(); setCat('happy', 2400); spawnHeart(); setTimeout(spawnHeart, 380); },
    wake,
    activity,
    setEnabled(on) {
      enabled = !!on;
      if (cat) cat.hidden = !enabled;
    }
  };

  function spawnHeart() {
    if (!cat || !enabled || reduceMotion) return;
    const h = document.createElement('span');
    h.className = 'cat-heart';
    h.textContent = '♥';
    h.style.left = (cat.offsetLeft + 30 + Math.random() * 10) + 'px';
    h.style.top = (cat.offsetTop - 2) + 'px';
    cat.parentElement.appendChild(h);
    setTimeout(() => h.remove(), 1200);
  }

  if (cat) {
    cat.dataset.state = 'idle';
    // 摸摸头
    cat.addEventListener('click', (e) => {
      e.stopPropagation();
      Cat.happy();
    });
    setInterval(() => {
      if (catState !== 'sleep' && Date.now() - lastActivity > SLEEP_AFTER) setCat('sleep');
    }, 15000);
    // 窗口重新出现 / 获得焦点时，睡着的小猫会醒来伸个懒腰
    window.addEventListener('focus', activity);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) activity(); });
    document.addEventListener('pointerdown', activity, true);
  }

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

  /* 一张便笺的待办全部完成：一串小爪印从小猫那里走过卡片底部 */
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

  window.Life = { Cat, burst, pawTrail, tearOff, stickIn, PAW };
})();
