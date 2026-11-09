'use strict';

/**
 * 生成 GitHub Release 的说明：下载表 + 这一版的更新内容。
 *
 * 更新内容按顺序找：
 *   1. CHANGELOG.md 里「## v1.2.3」一节（发布时由 scripts/bump.js 从「## 未发布」改名而来）
 *   2. CHANGELOG.md 里「## 未发布」一节
 *   3. 都是空的：用上一个版本以来的提交说明（提交正文里的「- 」条目，没有就用标题）
 *
 *   node scripts/release-notes.js 1.2.3 [上一个版本的标签] > notes.md
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/* 取「## 标题」下面的内容（到下一个二级标题为止）；标题只要以 title 开头即可，如「## v1.2.3（2026-11-10）」 */
function section(md, title) {
  let out = null;
  for (const line of String(md || '').split(/\r?\n/)) {
    if (/^## /.test(line)) {
      if (out) break;
      const h = line.slice(3).trim();
      if (h === title || (h.startsWith(title) && !/[\d.]/.test(h[title.length]))) out = [];
      continue;
    }
    if (out) out.push(line);
  }
  return out ? out.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim() : '';
}

/* 提交记录（git log 用 \x1f 分隔标题和正文、\x1e 分隔提交）→ 更新条目 */
function notesFromCommits(log) {
  const items = [];
  for (const raw of String(log || '').split('\x1e')) {
    const [subject = '', body = ''] = raw.split('\x1f');
    const s = subject.trim();
    if (!s || /^release:/i.test(s) || /^Merge /.test(s)) continue;
    const bullets = [];
    for (const line of body.split(/\r?\n/)) {
      if (/^- /.test(line)) bullets.push(line.trimEnd());
      else if (/^\s{2,}\S/.test(line) && bullets.length) bullets[bullets.length - 1] += line.trim(); // 条目折行
    }
    if (bullets.length) items.push(...bullets);
    else items.push('- ' + s);
  }
  return items.join('\n');
}

function gitLog(prevTag) {
  const range = prevTag ? [`${prevTag}..HEAD`] : ['HEAD'];
  try {
    return execFileSync('git', ['log', ...range, '--no-merges', '--format=%s%x1f%b%x1e'], { cwd: ROOT, encoding: 'utf-8' });
  } catch (_) {
    return '';
  }
}

function downloads(version, repo) {
  const base = `https://github.com/${repo}/releases/download/v${version}`;
  const f = (name) => `[\`${name}\`](${base}/${name})`;
  return [
    '## 下载',
    '',
    '| 系统 | 文件 | 说明 |',
    '| --- | --- | --- |',
    `| Windows（推荐） | ${f(`FloatNote-Setup-${version}.exe`)} | 安装版，以后有新版本会自动更新 |`,
    `| Windows 免安装 | ${f(`FloatNote-${version}-portable.exe`)} | 双击即用，不会自动更新 |`,
    `| Linux | ${f(`FloatNote-${version}-x86_64.AppImage`)} | 加上可执行权限后直接运行 |`,
    '',
    '已经安装过的会自动收到这次更新（便携版除外）。第一次运行时如果 Windows 提示「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」。'
  ].join('\n');
}

function buildNotes({ version, changelog, commitLog, repo }) {
  const changes = section(changelog, 'v' + version) || section(changelog, '未发布') || notesFromCommits(commitLog);
  return downloads(version, repo) + '\n\n## 更新内容\n\n' + (changes || '- 小改进与问题修复') + '\n';
}

module.exports = { section, notesFromCommits, buildNotes };

if (require.main === module) {
  const [version, prevTag] = process.argv.slice(2).filter(a => a !== '--');
  if (!version) {
    console.error('用法：node scripts/release-notes.js <版本号> [上一个版本的标签]');
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const pub = [].concat((pkg.build && pkg.build.publish) || []).find(p => p.provider === 'github') || {};
  const repo = process.env.GITHUB_REPOSITORY || `${pub.owner}/${pub.repo}`;
  const clPath = path.join(ROOT, 'CHANGELOG.md');
  process.stdout.write(buildNotes({
    version: version.replace(/^v/, ''),
    changelog: fs.existsSync(clPath) ? fs.readFileSync(clPath, 'utf-8') : '',
    commitLog: gitLog(prevTag && prevTag !== 'v' + version ? prevTag : ''),
    repo
  }));
}
