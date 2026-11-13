'use strict';

/* 发布脚本：改版本号、CHANGELOG 改名、生成 Release 说明（纯 Node，不启动应用） */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { nextVersion, renameUnreleased, CHANGELOGS } = require('../scripts/bump');
const { section, notesFromCommits, buildNotes } = require('../scripts/release-notes');

const CL = `# 更新记录

## 未发布

- 新功能 A

## v1.0.3（2026-11-09）

### 修复

- 修了 B

## v1.0.2（2026-11-09）

- 第一版
`;

const CL_EN = `# Changelog

## Unreleased

- Feature A

## v1.0.3 (2026-11-09)

### Fixed

- Fixed B

## v1.0.2 (2026-11-09)

- First release
`;

describe('发布脚本', () => {
  it('计算下一个版本号', () => {
    assert.equal(nextVersion('1.0.3', 'patch'), '1.0.4');
    assert.equal(nextVersion('1.0.3', 'minor'), '1.1.0');
    assert.equal(nextVersion('1.0.3', 'major'), '2.0.0');
    assert.equal(nextVersion('1.0.3', 'v1.2.0'), '1.2.0');
    assert.throws(() => nextVersion('1.0.3', '1.2'));
  });

  it('「未发布」改名为新版本，并留一个新的空「未发布」', () => {
    const md = renameUnreleased(CL, '1.0.4', '2026-11-10');
    assert.match(md, /## 未发布\n\n## v1\.0\.4（2026-11-10）\n\n- 新功能 A/);
    assert.equal(section(md, '未发布'), '');
    assert.equal(section(md, 'v1.0.4'), '- 新功能 A');
  });

  it('英文更新记录的 Unreleased 同样改名', () => {
    const md = renameUnreleased(CL_EN, '1.0.4', '2026-11-10', CHANGELOGS[0]);
    assert.match(md, /## Unreleased\n\n## v1\.0\.4 \(2026-11-10\)\n\n- Feature A/);
    assert.equal(section(md, 'Unreleased'), '');
    assert.equal(section(md, 'v1.0.4'), '- Feature A');
  });

  it('按版本取 CHANGELOG 的一节（v1.0.3 不会匹配到 v1.0.30）', () => {
    assert.equal(section(CL, 'v1.0.3'), '### 修复\n\n- 修了 B');
    assert.equal(section(CL + '\n## v1.0.30\n\n- 别的\n', 'v1.0.3'), '### 修复\n\n- 修了 B');
    assert.equal(section(CL_EN, 'v1.0.3'), '### Fixed\n\n- Fixed B');
    assert.equal(section(CL, 'v9.9.9'), '');
  });

  it('CHANGELOG 没写时用提交说明：取正文里的条目，去掉 release / 合并 / 署名行', () => {
    const log = [
      '修复退格\x1f- 待办开头按一次退格就去掉复选框\n- 列表开头按退格去掉圆点\n\nCo-Authored-By: Someone <a@b.c>\n',
      'release: v1.0.3\x1f\n',
      'Merge pull request #4 from x\x1f\n',
      '补上安装脚本\x1fCo-Authored-By: Someone <a@b.c>\n'
    ].join('\x1e');
    assert.equal(notesFromCommits(log), '- 待办开头按一次退格就去掉复选框\n- 列表开头按退格去掉圆点\n- 补上安装脚本');
  });

  it('Release 说明是中英双语的：下载表 + What\'s new + 更新内容', () => {
    const repo = 'ttzttztt/FloatNote';
    const a = buildNotes({ version: '1.0.3', changelog: CL_EN, changelogZh: CL, commitLog: '', repo });
    assert.match(a, /^## Download · 下载\n/);
    assert.match(a, /FloatNote-Setup-1\.0\.3\.exe`\]\(https:\/\/github\.com\/ttzttztt\/FloatNote\/releases\/download\/v1\.0\.3\//);
    assert.match(a, /## What's new\n\n### Fixed\n\n- Fixed B\n\n## 更新内容\n\n### 修复\n\n- 修了 B\n$/);
    // 还没改名时用 Unreleased / 未发布
    assert.match(buildNotes({ version: '1.0.4', changelog: CL_EN, changelogZh: CL, commitLog: '', repo }), /## What's new\n\n- Feature A\n\n## 更新内容\n\n- 新功能 A\n$/);
    // 只写了一种语言：只出那一节
    const zhOnly = buildNotes({ version: '1.0.4', changelog: '', changelogZh: CL, commitLog: '', repo });
    assert.ok(!zhOnly.includes("What's new") && zhOnly.includes('## 更新内容\n\n- 新功能 A'));
    // 都没写：用提交说明
    assert.match(buildNotes({ version: '1.0.4', changelog: '', changelogZh: '', commitLog: '改了 C\x1f\x1e', repo }), /## What's new · 更新内容\n\n- 改了 C/);
  });

  it('仓库里的两份更新记录版本一致，都有「未发布」一节', () => {
    const fs = require('fs');
    const versions = (lang) => [...fs.readFileSync(lang.file, 'utf-8').matchAll(/^## (v[\d.]+)/gm)].map(m => m[1]);
    assert.deepEqual(versions(CHANGELOGS[0]), versions(CHANGELOGS[1]));
    for (const lang of CHANGELOGS) assert.match(fs.readFileSync(lang.file, 'utf-8'), new RegExp(`^## ${lang.unreleased}$`, 'm'));
  });
});
