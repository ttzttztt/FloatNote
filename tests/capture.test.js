'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { launchApp, note, sleep, hasXdotool } = require('./helpers');

/* 快速捕捉靠真实的全局快捷键触发，需要能模拟系统按键（Linux + xdotool）；否则跳过 */
describe('快速捕捉', { skip: !hasXdotool() && '需要 Linux + xdotool' }, () => {
  let t;
  before(async () => {
    t = await launchApp({ seed: { notes: [note('a', '<div>原有内容</div>')], settings: { activeNoteId: 'a' } } });
  });
  after(async () => {
    await t.close(); // 先关闭再断言：断言失败时应用也不会一直开着，测试进程能正常结束
    assert.deepEqual(t.errors, []);
  });

  it('Ctrl+Alt+C 把剪贴板文字连同时间追加到当前便笺', async () => {
    await t.app.evaluate(async ({ clipboard }) => { await clipboard.writeText('好的设计是尽可能少的设计。'); });
    execFileSync('xdotool', ['key', 'ctrl+alt+c']);
    await sleep(900);
    const text = await t.page.textContent('#editor .capture');
    assert.match(text, /好的设计是尽可能少的设计。— 剪贴板 · \d+月\d+日 \d\d:\d\d/);
    await t.page.click('#editor'); // 用户回到便笺里再撤销
    await t.page.keyboard.press('Control+Z');
    assert.equal(await t.page.locator('#editor .capture').count(), 0, '捕捉也能撤销');
  });
});
