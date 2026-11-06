'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (e, payload) => cb(payload));

contextBridge.exposeInMainWorld('api', {
  // 数据：主进程持有唯一一份；渲染进程只发送增量，并接收其他窗口的增量
  loadData: () => ipcRenderer.invoke('data:load'),
  patchData: (patch) => ipcRenderer.invoke('data:patch', patch),
  onPatched: on('data:patched'),
  getContext: () => ipcRenderer.invoke('win:context'),

  saveImage: (noteId, dataUrl) => ipcRenderer.invoke('image:save', { noteId, dataUrl }),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:readImage'),

  // 窗口
  setAlwaysOnTop: (v) => ipcRenderer.invoke('win:setAlwaysOnTop', v),
  hide: () => ipcRenderer.invoke('win:hide'),
  minimize: () => ipcRenderer.invoke('win:minimize'),
  close: () => ipcRenderer.invoke('win:close'),
  resize: (w, h) => ipcRenderer.invoke('win:resize', { width: w, height: h }),
  moveBy: (dx, dy) => ipcRenderer.invoke('win:moveBy', { dx, dy }),
  dragStart: () => ipcRenderer.invoke('win:dragStart'),
  dragEnd: () => ipcRenderer.invoke('win:dragEnd'),
  setMenuOpen: (open) => ipcRenderer.invoke('win:menuOpen', open),
  setIgnoreMouse: (ignore) => ipcRenderer.invoke('win:setIgnoreMouse', ignore),
  registerHotkey: (acc) => ipcRenderer.invoke('win:registerHotkey', acc),
  getHotkey: () => ipcRenderer.invoke('win:getHotkey'),
  quit: () => ipcRenderer.invoke('win:quit'),
  onNewNote: on('cmd:new-note'),

  // 贴边收起
  onDockState: on('dock:state'),
  dockExpand: () => ipcRenderer.invoke('dock:expand'),
  setDockEnabled: (on) => ipcRenderer.invoke('dock:setEnabled', on),

  // 贴到桌面
  openSticky: (noteId, x, y) => ipcRenderer.invoke('sticky:open', { noteId, x, y }),
  closeSticky: (noteId) => ipcRenderer.invoke('sticky:close', noteId),
  focusSticky: (noteId) => ipcRenderer.invoke('sticky:focus', noteId),
  onStickies: on('sticky:list'),

  // 快速捕捉
  onCapture: on('capture:add')
});
