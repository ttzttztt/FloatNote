'use strict';

/**
 * 启动器：
 * 1. 清除 ELECTRON_RUN_AS_NODE 后以桌面应用模式启动 Electron。
 *    某些终端/Agent 环境会设置 ELECTRON_RUN_AS_NODE=1，导致 Electron 以纯 Node 模式运行，
 *    require('electron') 返回路径字符串而非 API。这里显式清除该变量。
 * 2. 首次运行时 Electron 程序从 .npmrc 指定的镜像下载（见 electron-env.js）。
 */
const { spawn } = require('child_process');
const { applyElectronEnvFromNpmrc } = require('./electron-env');

applyElectronEnvFromNpmrc();
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
