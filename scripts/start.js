'use strict';

/**
 * 启动器：
 * 1. 清除 ELECTRON_RUN_AS_NODE 后以桌面应用模式启动 Electron。
 *    某些终端/Agent 环境会设置 ELECTRON_RUN_AS_NODE=1，导致 Electron 以纯 Node 模式运行，
 *    require('electron') 返回路径字符串而非 API。这里显式清除该变量。
 * 2. Electron 45 起不在安装时下载程序，而是首次 require('electron') 时才下载。
 *    pnpm 运行脚本时不一定会把 .npmrc 里的 electron_mirror 传下去，
 *    这里主动读取 .npmrc 中的 electron_* 配置并写入环境变量（已显式设置的不覆盖）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function applyElectronMirrorFromNpmrc() {
  const npmrc = path.join(__dirname, '..', '.npmrc');
  if (!fs.existsSync(npmrc)) return;
  for (const raw of fs.readFileSync(npmrc, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const m = /^electron_([a-z_]+)\s*=\s*(.*)$/i.exec(line);
    if (!m) continue;
    const name = m[1].toLowerCase();
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    const envKey = 'ELECTRON_' + name.toUpperCase();
    if (process.env[envKey] || process.env['npm_config_electron_' + name]) continue;
    process.env[envKey] = value;
  }
}

applyElectronMirrorFromNpmrc();
delete process.env.ELECTRON_RUN_AS_NODE;

let electron;
try {
  electron = require('electron'); // 返回 electron 可执行文件路径；缺失时会先下载
} catch (e) {
  console.error('\n[FloatNote] Electron 程序下载失败：' + (e && e.message));
  console.error('  当前下载源：' + (process.env.npm_config_electron_mirror || process.env.ELECTRON_MIRROR || 'GitHub 官方'));
  console.error('  可尝试：检查网络 / 代理，或设置环境变量 ELECTRON_MIRROR 换一个下载源后重试。\n');
  process.exit(1);
}

// 透传命令行参数，例如 pnpm start -- --no-sandbox
const child = spawn(electron, ['.', ...process.argv.slice(2).filter(a => a !== '--')], { stdio: 'inherit', env: process.env });
child.on('close', (code) => process.exit(code));
