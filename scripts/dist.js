'use strict';

/**
 * 打包：读取 .npmrc 的下载镜像后调用 electron-builder，参数原样透传。
 *   pnpm dist          当前系统
 *   pnpm dist:win      Windows 安装程序 + 便携版（需在 Windows 上，或 Linux/macOS 装有 Wine）
 *   pnpm dist:mac      macOS dmg（需在 macOS 上）
 *   pnpm dist:linux    Linux AppImage
 * 产物输出到 release/。
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { applyElectronEnvFromNpmrc } = require('./electron-env');

applyElectronEnvFromNpmrc();
delete process.env.ELECTRON_RUN_AS_NODE;

// electron-builder 的下载器不认 {{ version }} 占位符，会原样拼进下载地址，这里先换成实际版本号
const electronVersion = require('electron/package.json').version;
for (const key of ['ELECTRON_CUSTOM_DIR', 'npm_config_electron_custom_dir']) {
  if (process.env[key]) process.env[key] = process.env[key].replace(/\{\{\s*version\s*\}\}/g, electronVersion);
}

const bin = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
const args = process.argv.slice(2).filter(a => a !== '--');
// 默认不发布（electron-builder 在 CI 遇到版本标签时会尝试发布到 GitHub Release）
if (!args.some(a => a === '-p' || a.startsWith('--publish'))) args.push('--publish', 'never');
const r = spawnSync(bin, args, { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
process.exit(r.status == null ? 1 : r.status);
