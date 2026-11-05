'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  saveImage: (noteId, dataUrl) => ipcRenderer.invoke('image:save', { noteId, dataUrl }),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:readImage'),
  setAlwaysOnTop: (v) => ipcRenderer.invoke('win:setAlwaysOnTop', v),
  setOpacity: (o) => ipcRenderer.invoke('win:setOpacity', o),
  hide: () => ipcRenderer.invoke('win:hide'),
  minimize: () => ipcRenderer.invoke('win:minimize'),
  close: () => ipcRenderer.invoke('win:close'),
  resize: (w, h) => ipcRenderer.invoke('win:resize', { width: w, height: h }),
  moveBy: (dx, dy) => ipcRenderer.invoke('win:moveBy', { dx, dy }),
  setIgnoreMouse: (ignore) => ipcRenderer.invoke('win:setIgnoreMouse', ignore),
  registerHotkey: (acc) => ipcRenderer.invoke('win:registerHotkey', acc),
  getHotkey: () => ipcRenderer.invoke('win:getHotkey'),
  quit: () => ipcRenderer.invoke('win:quit'),
  onNewNote: (cb) => ipcRenderer.on('cmd:new-note', cb)
});
