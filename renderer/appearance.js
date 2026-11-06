'use strict';

/* appearance.js —— 主题、纸张、外观跟随、字号、状态栏与今日完成数
   各脚本是同一页面里的普通 <script>，顶层声明互相可见；按 index.html 中的顺序加载。 */

/* ============ 主题 / 纸张 / 外观跟随 / 字号 / 工具栏隐藏 ============ */
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/* 外观跟随：system = 系统深色时便笺变暗；time = 早上偏暖、深夜变暗 */
function ambient() {
  const mode = state.settings && state.settings.appearance;
  const h = new Date().getHours();
  if (mode === 'system') return { dark: darkQuery.matches, warm: false };
  if (mode === 'time') return { dark: h >= 22 || h < 6, warm: h >= 6 && h < 10 };
  return { dark: false, warm: false };
}

function applyTheme(note) {
  const own = note && THEMES.includes(note.color) ? note.color : 'glass';
  const amb = ambient();
  document.body.dataset.theme = amb.dark ? 'dark' : own;
  document.body.classList.toggle('warm', amb.warm && !amb.dark);
  el.smSwatches.querySelectorAll('.swatch').forEach(b => b.classList.toggle('active', b.dataset.theme === own));
  const paper = note && PAPERS.includes(note.paper) ? note.paper : 'plain';
  document.body.dataset.paper = paper;
  el.smPaper.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.paper === paper));
}
darkQuery.addEventListener('change', () => applyTheme(currentNote()));
setInterval(() => applyTheme(currentNote()), 60000); // 跟随时间：每分钟检查一次

/* 应用全局设置（启动时，以及其他窗口改了设置之后） */
function applySettings() {
  const s = state.settings;
  s.fontSize = applyFontSize(s.fontSize);
  applyAutohide(s.autoHideToolbar !== false);
  el.smOpacity.value = s.opacity;
  applyGlass(s.opacity);
  if (!IS_STICKY) {
    el.smAlwaysOnTop.checked = !!s.alwaysOnTop;
    el.btnPin.classList.toggle('active', !!s.alwaysOnTop);
  }
  el.smDock.checked = s.dockEnabled !== false;
  el.smAppearance.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.mode === (s.appearance || 'manual')));
  applyTheme(currentNote());
  updateStatus();
}

function applyFontSize(v) {
  const n = Math.min(22, Math.max(12, Math.round(Number(v) || 15)));
  document.documentElement.style.setProperty('--font-size', n + 'px');
  el.smFontSize.value = n;
  el.smFontVal.textContent = n + 'px';
  return n;
}

function applyAutohide(on) {
  document.body.classList.toggle('autohide', on);
  el.smAutohide.checked = on;
}

/* ============ 底部状态栏：字数 · 编辑时间 ============ */
function updateStatus() {
  const note = currentNote();
  const chars = el.editor.textContent.replace(/[\s\u00a0\u3000]/g, '').length;
  if (!note || (!chars && !el.editor.querySelector('img,input'))) {
    el.statusBar.textContent = '';
    return;
  }
  const rel = relativeTime(note.updatedAt);
  const done = todayDone();
  el.statusBar.textContent = (done && !IS_STICKY ? `今日完成 ${done} 件 · ` : '') +
    `${chars} 字 · ` + (rel === '刚刚' ? '刚刚编辑' : '编辑于 ' + rel);
}

/* ============ 今日完成数 ============ */
function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function todayDone() {
  const st = state.settings && state.settings.stats;
  return st && st.date === todayKey() ? st.done : 0;
}
function countDone(delta) {
  const st = state.settings.stats && state.settings.stats.date === todayKey()
    ? state.settings.stats : { date: todayKey(), done: 0 };
  state.settings.stats = { date: st.date, done: Math.max(0, st.done + delta) };
}
setInterval(updateStatus, 30000);

