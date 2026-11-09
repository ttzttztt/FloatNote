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
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyElectronEnvFromNpmrc } = require('./electron-env');

applyElectronEnvFromNpmrc();
delete process.env.ELECTRON_RUN_AS_NODE;

// electron-builder 的下载器不认 {{ version }} 占位符，会原样拼进下载地址，这里先换成实际版本号
const electronVersion = require('electron/package.json').version;
for (const key of ['ELECTRON_CUSTOM_DIR', 'npm_config_electron_custom_dir']) {
  if (process.env[key]) process.env[key] = process.env[key].replace(/\{\{\s*version\s*\}\}/g, electronVersion);
}

/* ---- Windows：预先准备 winCodeSign 工具包 ----
   electron-builder 打 Windows 包时要下载并解压 winCodeSign-2.6.0.7z。压缩包里有两个 macOS 用的符号链接，
   Windows 默认不允许普通用户创建符号链接（需开启「开发人员模式」或用管理员身份），解压报错、打包中止。
   这两个文件在 Windows 上用不到：这里自己下载解压（忽略这两个错误），放进 electron-builder 的缓存目录，
   它发现缓存已有就会直接使用。 */
function find7za() {
  const pnpmDir = path.join(__dirname, '..', 'node_modules', '.pnpm');
  const sub = process.platform === 'win32' ? ['win', 'x64', '7za.exe']
    : process.platform === 'darwin' ? ['mac', process.arch === 'arm64' ? 'arm64' : 'x64', '7za'] : ['linux', 'x64', '7za'];
  try {
    for (const d of fs.readdirSync(pnpmDir)) {
      if (!d.startsWith('7zip-bin@')) continue;
      const p = path.join(pnpmDir, d, 'node_modules', '7zip-bin', ...sub);
      if (fs.existsSync(p)) return p;
    }
  } catch (_) { /* ignore */ }
  try { return require('7zip-bin').path7za; } catch (_) { return null; }
}

async function prepareWinCodeSign() {
  if (process.platform !== 'win32' && !process.env.FLOATNOTE_FORCE_WINCODESIGN) return;
  const cacheRoot = process.env.ELECTRON_BUILDER_CACHE ||
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache');
  const target = path.join(cacheRoot, 'winCodeSign', 'winCodeSign-2.6.0');
  if (fs.existsSync(path.join(target, 'rcedit-x64.exe'))) return; // 已经准备好了

  const mirror = (process.env.npm_config_electron_builder_binaries_mirror || process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
    'https://github.com/electron-userland/electron-builder-binaries/releases/download/').replace(/\/?$/, '/');
  const url = mirror + 'winCodeSign-2.6.0/winCodeSign-2.6.0.7z';
  const za = find7za();
  if (!za) { console.warn('[dist] 找不到 7za，跳过 winCodeSign 预处理'); return; }

  console.log('[dist] 准备 winCodeSign 工具包：' + url);
  let work = null;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    work = fs.mkdtempSync(path.join(path.dirname(target), 'prepare-'));
    const res = await fetch(url);
    if (!res.ok) throw new Error('下载失败 HTTP ' + res.status);
    const archive = path.join(work, 'winCodeSign-2.6.0.7z');
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
    const out = path.join(work, 'out');
    const r = spawnSync(za, ['x', '-y', '-bd', archive, '-o' + out], { encoding: 'utf-8' });
    // 退出码 2 = 有子项出错（就是那两个 macOS 符号链接），Windows 要用的文件都在就算成功
    if (!fs.existsSync(path.join(out, 'rcedit-x64.exe'))) {
      throw new Error('解压失败：' + ((r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ')));
    }
    fs.renameSync(out, target);
    console.log('[dist] winCodeSign 已就绪：' + target);
  } catch (e) {
    console.warn('[dist] winCodeSign 预处理失败（交给 electron-builder 自己处理）：' + e.message);
  } finally {
    if (work) fs.rmSync(work, { recursive: true, force: true });
  }
}

const bin = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
const args = process.argv.slice(2).filter(a => a !== '--');
// 默认不发布（electron-builder 在 CI 遇到版本标签时会尝试发布到 GitHub Release）
if (!args.some(a => a === '-p' || a.startsWith('--publish'))) args.push('--publish', 'never');
prepareWinCodeSign().then(() => {
  const r = spawnSync(bin, args, { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
  process.exit(r.status == null ? 1 : r.status);
});
