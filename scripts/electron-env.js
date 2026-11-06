'use strict';

/**
 * 读取 .npmrc 里的 electron_* 配置（下载镜像等）写入环境变量，已显式设置的不覆盖。
 * Electron 45 起在首次 require('electron') 时才下载程序；electron-builder 打包时也要下载 Electron 和 NSIS 等工具。
 * pnpm 运行脚本时不一定会把 .npmrc 的这些配置传下去，所以由启动 / 打包脚本主动读取。
 */
const fs = require('fs');
const path = require('path');

function applyElectronEnvFromNpmrc() {
  const npmrc = path.join(__dirname, '..', '.npmrc');
  if (!fs.existsSync(npmrc)) return;
  for (const raw of fs.readFileSync(npmrc, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const m = /^(electron_[a-z_]+)\s*=\s*(.*)$/i.exec(line);
    if (!m) continue;
    const name = m[1].toLowerCase();
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    const envKey = name.toUpperCase();
    if (process.env[envKey] || process.env['npm_config_' + name]) continue;
    process.env[envKey] = value;
  }
}

module.exports = { applyElectronEnvFromNpmrc };
