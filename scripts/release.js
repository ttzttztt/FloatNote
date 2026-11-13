'use strict';

/**
 * 在本地准备发布：改版本号（并把两份更新记录里的 Unreleased / 「未发布」改名为这个版本）→ 提交。
 * 推送到 main 后，GitHub Actions「打包与发布」会自动打标签、测试、打包、发布，不用手动打标签。
 *
 *   pnpm release patch     1.0.3 → 1.0.4（修复）
 *   pnpm release minor     1.0.3 → 1.1.0（新功能）
 *   pnpm release major     1.0.3 → 2.0.0
 *   pnpm release 1.2.0     指定版本号
 *
 * 更省事的做法：GitHub 仓库 → Actions →「打包与发布」→ Run workflow，选 patch / minor / major，
 * 改版本号这一步也在 GitHub 上完成，本地什么都不用做。
 */
const path = require('path');
const { execFileSync } = require('child_process');
const { bump } = require('./bump');

const ROOT = path.join(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8' }).trim();
const fail = (msg) => { console.error('\n[release] ' + msg + '\n'); process.exit(1); };

const arg = (process.argv.slice(2).filter(a => a !== '--')[0] || '').trim();
if (!arg) fail('请指定版本号，例如：pnpm release patch 或 pnpm release 1.2.0');
if (git('status', '--porcelain')) fail('还有没提交的改动，先提交或撤销后再发布');

let next;
try { next = bump(arg); } catch (e) { fail(e.message); }
if (git('tag', '--list', 'v' + next)) fail(`v${next} 已经发布过`);

git('add', 'package.json', 'CHANGELOG.md', 'CHANGELOG.zh-CN.md');
git('commit', '-m', `release: v${next}`);

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
console.log(`\n已改好版本号 v${next} 并提交（${branch} 分支）。推送到 main 后自动测试、打包、发布：\n`);
console.log(`  git push origin ${branch === 'main' ? 'main' : branch + ':main'}\n`);
console.log('进度在仓库的 Actions →「打包与发布」里看，完成后安装包出现在 Releases 页面。\n');
