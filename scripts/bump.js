'use strict';

/**
 * 改版本号：package.json 的 version，以及 CHANGELOG.md 里「## 未发布」一节改名为这个版本。
 * 本地的 pnpm release 和 GitHub Actions 的「打包与发布」都用它。
 *
 *   node scripts/bump.js patch            1.0.3 → 1.0.4，写入文件，输出新版本号
 *   node scripts/bump.js minor --dry-run  只输出新版本号，不改文件
 *   node scripts/bump.js 1.2.0            指定版本号
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'package.json');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const UNRELEASED = '未发布';

function nextVersion(cur, bump) {
  const [maj, min, pat] = cur.split('-')[0].split('.').map(Number);
  if (bump === 'patch') return `${maj}.${min}.${pat + 1}`;
  if (bump === 'minor') return `${maj}.${min + 1}.0`;
  if (bump === 'major') return `${maj + 1}.0.0`;
  const v = String(bump || '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(v)) throw new Error(`版本号格式不对：${bump}`);
  return v;
}

/* 「## 未发布」改名为「## v1.2.3（日期）」，并在它上面留一个新的空「## 未发布」 */
function renameUnreleased(md, version, date) {
  const re = new RegExp(`^## ${UNRELEASED}[^\\n]*$`, 'm');
  const heading = `## v${version}（${date}）`;
  if (re.test(md)) return md.replace(re, `## ${UNRELEASED}\n\n${heading}`);
  // 没有「未发布」一节：在第一个二级标题前插入
  const i = md.search(/^## /m);
  const block = `## ${UNRELEASED}\n\n${heading}\n\n`;
  return i < 0 ? md.trimEnd() + '\n\n' + block : md.slice(0, i) + block + md.slice(i);
}

function bump(arg, { dryRun = false, date = new Date().toISOString().slice(0, 10) } = {}) {
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf-8'));
  const next = nextVersion(pkg.version, arg);
  if (next === pkg.version) throw new Error(`当前已经是 ${next}`);
  if (!dryRun) {
    pkg.version = next;
    fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
    if (fs.existsSync(CHANGELOG)) {
      fs.writeFileSync(CHANGELOG, renameUnreleased(fs.readFileSync(CHANGELOG, 'utf-8'), next, date));
    }
  }
  return next;
}

module.exports = { nextVersion, renameUnreleased, bump };

if (require.main === module) {
  const args = process.argv.slice(2).filter(a => a !== '--');
  try {
    process.stdout.write(bump(args.find(a => !a.startsWith('--')), { dryRun: args.includes('--dry-run') }) + '\n');
  } catch (e) {
    console.error('[bump] ' + e.message);
    process.exit(1);
  }
}
