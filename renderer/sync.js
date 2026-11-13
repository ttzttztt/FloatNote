'use strict';

/* sync.js —— 多窗口数据同步：按字段发送增量、合并其他窗口的增量
   各脚本是同一页面里的普通 <script>，顶层声明互相可见；按 index.html 中的顺序加载。 */

/* ============ 持久化：只把变化的字段发给主进程 ============
   多个窗口（便笺本 + 贴在桌面的便笺）共享同一份数据。每个窗口记住“上次同步时的样子”，
   保存时按字段比较，只发送改动；收到其他窗口的改动后合并进来。这样两个窗口不会互相覆盖。 */
const LOCAL_SETTINGS = new Set(['bounds', 'stickies', 'dock', 'hotkey', 'captureHotkey', 'language']); // 主进程维护的设置项
let baseline = { notes: new Map(), order: '', settings: {} };

function snapshot(obj, skip) {
  const o = {};
  for (const k of Object.keys(obj || {})) {
    if (skip && skip.has(k)) continue;
    if (obj[k] === undefined) continue;
    o[k] = JSON.stringify(obj[k]);
  }
  return o;
}

function rememberBaseline() {
  baseline = {
    notes: new Map(state.notes.map(n => [n.id, snapshot(n)])),
    order: state.notes.map(n => n.id).join(','),
    settings: snapshot(state.settings, LOCAL_SETTINGS)
  };
}

function diffFields(cur, prev, source) {
  const set = {};
  const unset = [];
  for (const k of Object.keys(cur)) if (cur[k] !== prev[k]) set[k] = source[k];
  for (const k of Object.keys(prev)) if (!(k in cur)) unset.push(k);
  return (Object.keys(set).length || unset.length) ? { set, unset } : null;
}

function buildPatch() {
  const upserts = [];
  const seen = new Set();
  for (const n of state.notes) {
    seen.add(n.id);
    const d = diffFields(snapshot(n), baseline.notes.get(n.id) || {}, n);
    if (d) upserts.push(Object.assign({ id: n.id }, d));
  }
  const deletes = [...baseline.notes.keys()].filter(id => !seen.has(id));
  const order = state.notes.map(n => n.id).join(',');
  const settings = diffFields(snapshot(state.settings, LOCAL_SETTINGS), baseline.settings, state.settings);
  if (!upserts.length && !deletes.length && order === baseline.order && !settings) return null;
  return {
    upserts,
    deletes,
    order: order !== baseline.order ? state.notes.map(n => n.id) : null,
    settings
  };
}

let saveTimer = null;
function scheduleSave(delay = 500) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, delay);
}

function persist() {
  clearTimeout(saveTimer);
  const note = currentNote();
  if (note) {
    saveCurrentContent();
    el.noteTitleEl.textContent = noteTitle(note);
    el.dockTitle.textContent = noteTitle(note);
    updateStatus();
  }
  const patch = buildPatch();
  if (!patch) return;
  rememberBaseline();
  window.api.patchData(patch);
}

/* 合并其他窗口发来的改动 */
function applyRemotePatch(p) {
  persist(); // 先把本窗口未发出的改动发出去，再合并
  const active = currentNote();
  let activeChanged = false;
  let activeContentChanged = false;

  for (const u of p.upserts || []) {
    let n = state.notes.find(x => x.id === u.id);
    // 本窗口刚改过、比传来的版本还新（例如正在打字时同步来了另一台电脑的旧内容）：保留本地的
    if (n && u.set && u.set.updatedAt && (n.updatedAt || 0) > u.set.updatedAt) continue;
    if (!n) { n = { id: u.id }; state.notes.push(n); }
    Object.assign(n, u.set || {});
    (u.unset || []).forEach(k => { delete n[k]; });
    if (active && n.id === active.id) {
      activeChanged = true;
      if (u.set && 'content' in u.set) activeContentChanged = true;
    }
  }
  if (p.deletes && p.deletes.length) {
    const del = new Set(p.deletes);
    state.notes = state.notes.filter(n => !del.has(n.id));
  }
  if (Array.isArray(p.order)) {
    const rank = new Map(p.order.map((id, i) => [id, i]));
    state.notes.sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : 1e9) - (rank.has(b.id) ? rank.get(b.id) : 1e9));
  }
  if (p.settings) {
    Object.assign(state.settings, p.settings.set || {});
    (p.settings.unset || []).forEach(k => { delete state.settings[k]; });
    applySettings();
  }
  rememberBaseline();

  if (!currentNote()) {
    // 当前便笺在别处被删除了
    if (IS_STICKY) return;
    const pick = liveNotes().find(n => !state.stuck.has(n.id)) || (() => {
      const fresh = blankNote();
      state.notes.unshift(fresh);
      return fresh;
    })();
    state.activeId = pick.id;
    state.settings.activeNoteId = state.activeId;
    loadActiveNote();
    scheduleSave(100);
  } else if (activeContentChanged) {
    loadActiveNote(false);
  } else if (activeChanged) {
    applyTheme(currentNote());
    renderTags();
    renderSwitcher();
    updateStatus();
  }
  if (!el.switcherMenu.classList.contains('hidden')) renderMenuItems();
}

function blankNote() {
  return { id: uid(), title: '', tags: [], content: '', createdAt: Date.now(), updatedAt: Date.now() };
}

