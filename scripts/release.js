'use strict';

/**
 * 发布新版本：改版本号 → 提交 → 打标签。推送标签后，GitHub Actions 自动打包并发布到 Releases，
 * 已安装的 FloatNote 会自动下载更新。
 *
 *   pnpm release 1.0.1     指定版本号
 *   pnpm release patch     1.0.0 → 1.0.1（修复）
 *   pnpm release minor     1.0.0 → 1.1.0（新功能）
 *   pnpm release major     1.0.0 → 2.0.0
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8' }).trim();
const fail = (msg) => { console.error('\n[release] ' + msg + '\n'); process.exit(1); };

const arg = (process.argv.slice(2).filter(a => a !== '--')[0] || '').trim();
if (!arg) fail('请指定版本号，例如：pnpm release 1.0.1 或 pnpm release patch');

const pkgFile = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
const [maj, min, pat] = pkg.version.split('.').map(Number);
const next = arg === 'patch' ? `${maj}.${min}.${pat + 1}`
  : arg === 'minor' ? `${maj}.${min + 1}.0`
  : arg === 'major' ? `${maj + 1}.0.0`
  : arg.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(next)) fail(`版本号格式不对：${arg}`);
if (next === pkg.version) fail(`当前已经是 ${next}`);

if (git('status', '--porcelain')) fail('还有没提交的改动，先提交或撤销后再发布');
const tag = 'v' + next;
if (git('tag', '--list', tag)) fail(`标签 ${tag} 已存在`);

pkg.version = next;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
git('add', 'package.json');
git('commit', '-m', `release: ${tag}`);
git('tag', '-a', tag, '-m', tag);

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
console.log(`\n已准备好 ${pkg.version.replace(/^/, 'v')}（${branch} 分支，已提交并打标签）。推送后开始自动打包发布：\n`);
console.log(`  git push origin ${branch}`);
console.log(`  git push origin ${tag}\n`);
console.log('进度在仓库的 Actions →「打包」里看，完成后安装包出现在 Releases 页面。\n');
