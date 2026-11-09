'use strict';

/* 发布脚本：改版本号、CHANGELOG 改名、生成 Release 说明（纯 Node，不启动应用） */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { nextVersion, renameUnreleased } = require('../scripts/bump');
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

  it('按版本取 CHANGELOG 的一节（v1.0.3 不会匹配到 v1.0.30）', () => {
    assert.equal(section(CL, 'v1.0.3'), '### 修复\n\n- 修了 B');
    assert.equal(section(CL + '\n## v1.0.30\n\n- 别的\n', 'v1.0.3'), '### 修复\n\n- 修了 B');
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

  it('Release 说明：下载表 + 这一版的内容（优先版本一节，其次「未发布」，最后提交说明）', () => {
    const repo = 'ttzttztt/FloatNote';
    const a = buildNotes({ version: '1.0.3', changelog: CL, commitLog: '', repo });
    assert.match(a, /FloatNote-Setup-1\.0\.3\.exe`\]\(https:\/\/github\.com\/ttzttztt\/FloatNote\/releases\/download\/v1\.0\.3\//);
    assert.match(a, /## 更新内容\n\n### 修复\n\n- 修了 B/);
    assert.match(buildNotes({ version: '1.0.4', changelog: CL, commitLog: '', repo }), /## 更新内容\n\n- 新功能 A/);
    assert.match(buildNotes({ version: '1.0.4', changelog: '', commitLog: '改了 C\x1f\x1e', repo }), /## 更新内容\n\n- 改了 C/);
  });
});
