'use strict';

/* 界面语言：英文界面里不能残留中文，设置里切换语言后整个界面跟着换 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, note, sleep, flush, ROOT } = require('./helpers');
const i18n = require('../renderer/i18n.js');

const CJK = /[一-鿿]/;

describe('翻译表', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf-8');
  const jsFiles = ['main/main.js', ...fs.readdirSync(path.join(ROOT, 'renderer')).filter(f => f.endsWith('.js') && f !== 'i18n.js').map(f => 'renderer/' + f)];

  it('源码里每一处 t(…) / T(…) 的文字都有英文译文', () => {
    const missing = [];
    for (const f of jsFiles) {
      for (const m of read(f).matchAll(/\b[tT]\('((?:[^'\\]|\\.)*)'/g)) {
        const key = m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'");
        if (CJK.test(key) && !Object.prototype.hasOwnProperty.call(i18n.EN, key)) missing.push(`${f}: ${key}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('界面文字都经过 t(…)：代码里（注释除外）没有落单的中文字符串', () => {
    const stray = [];
    for (const f of jsFiles) {
      let code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
      code = code.replace(/\b[tT]\('(?:[^'\\]|\\.)*'/g, '');
      for (const line of code.split('\n')) {
        // 允许：日志、写进脚本文件里的注释行
        if (CJK.test(line) && !/console\.|^\s*'#/.test(line)) stray.push(`${f}: ${line.trim().slice(0, 80)}`);
      }
    }
    assert.deepEqual(stray, []);
  });

  it('index.html 里写死的中文都有英文译文', () => {
    const html = read('renderer/index.html').replace(/<!--[\s\S]*?-->/g, '');
    const body = html.slice(html.indexOf('<body'), html.indexOf('<script'));
    const found = new Set();
    for (const m of body.matchAll(/(?:title|aria-label|placeholder|data-placeholder|data-placeholder-focus)="([^"]*)"/g)) found.add(m[1]);
    for (const m of body.matchAll(/>([^<>]+)</g)) found.add(m[1].trim());
    const missing = [...found].filter(s => CJK.test(s) && s !== '中文' && !Object.prototype.hasOwnProperty.call(i18n.EN, s));
    assert.deepEqual(missing, []);
  });

  it('变量、单复数、日期', () => {
    assert.equal(i18n.translate('en', '已恢复「{0}」', 'Plan'), 'Restored "Plan"');
    assert.equal(i18n.translate('zh', '已恢复「{0}」', '计划'), '已恢复「计划」');
    assert.equal(i18n.translate('en', '还剩 {0} 天', 1), '1 day left');
    assert.equal(i18n.translate('en', '还剩 {0} 天', 5), '5 days left');
    assert.equal(i18n.translate('en', '没有译文的文字'), '没有译文的文字');
    const d = new Date(2026, 10, 5, 9, 7);
    assert.equal(i18n.formatDate('zh', d), '11月5日');
    assert.equal(i18n.formatDate('en', d), 'Nov 5');
    assert.equal(i18n.formatDate('zh', d, { year: true }), '2026年11月5日');
    assert.equal(i18n.formatDate('en', d, { year: true }), 'Nov 5, 2026');
    assert.equal(i18n.formatDate('en', d, { time: true }), 'Nov 5, 09:07');
    assert.equal(i18n.fromLocale('zh-CN'), 'zh');
    assert.equal(i18n.fromLocale('en-US'), 'en');
    assert.equal(i18n.fromLocale('ja'), 'en');
  });
});

/* 页面上所有看得见的文字和提示里残留的中文（便笺正文和输入框里的内容不算） */
function leftoverChinese(page) {
  return page.evaluate(() => {
    const cjk = /[一-鿿]/;
    const out = [];
    const skip = (n) => n.closest && n.closest('#editor');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const host = n.parentElement;
      if (!host || skip(host) || /^(SCRIPT|STYLE)$/.test(host.tagName)) continue;
      if (cjk.test(n.data) && n.data.trim() !== '中文') out.push('text: ' + n.data.trim());
    }
    for (const node of document.body.querySelectorAll('*')) {
      if (skip(node)) continue;
      for (const a of ['title', 'aria-label', 'placeholder', 'data-placeholder', 'data-placeholder-focus']) {
        const v = node.getAttribute(a);
        if (v && cjk.test(v)) out.push(`${a}: ${v}`);
      }
    }
    return out;
  });
}

describe('英文界面', () => {
  let t;
  before(async () => {
    t = await launchApp({
      seed: {
        notes: [
          note('a', '<div>Buy milk</div><div class="todo"><input type="checkbox"> Write report</div>', { tags: ['work'] }),
          note('b', '<div>Reading list</div>', { pinned: true }),
          note('c', '', {}),
          note('gone', '<div>Old note</div>', { trashed: Date.now() - 86400000 })
        ],
        settings: { activeNoteId: 'a', autoHideToolbar: false }
      },
      env: { FLOATNOTE_LANG: 'en' }
    });
  });
  after(async () => {
    await t.close();
    assert.deepEqual(t.errors, []);
  });

  it('主界面、三个菜单、最近删除、提示条里都没有残留的中文', async () => {
    assert.equal(await t.page.evaluate(() => LANG), 'en');
    assert.equal(await t.page.getAttribute('#btn-new', 'title'), 'New note');
    assert.match(await t.page.textContent('#status-bar'), /^\d+ chars · edited /);
    assert.deepEqual(await leftoverChinese(t.page), []);

    await t.page.click('#btn-note-menu');
    assert.equal(await t.page.textContent('#nm-rename span'), 'Rename');
    assert.deepEqual(await leftoverChinese(t.page), []);
    await t.page.keyboard.press('Escape');

    await t.page.click('#btn-settings');
    await t.page.click('#sm-keys summary');
    assert.deepEqual(await leftoverChinese(t.page), []);
    await t.page.keyboard.press('Escape');

    await t.page.click('#note-switcher');
    assert.equal(await t.page.getAttribute('.menu-search', 'placeholder'), 'Search titles, text and tags');
    assert.deepEqual(await leftoverChinese(t.page), []);
    await t.page.click('.menu-footer');
    assert.match(await t.page.textContent('.trash-hint'), /kept for 30 days/);
    assert.match(await t.page.textContent('.trash-item .mi-sub'), /^\d+ days left$/);
    assert.deepEqual(await leftoverChinese(t.page), []);
    await t.page.keyboard.press('Escape');

    await t.page.click('#btn-delete');
    assert.equal(await t.page.textContent('.toast'), 'Moved to Recently deletedUndo');
    await t.page.click('.toast-btn');
    assert.deepEqual(await leftoverChinese(t.page), []);
  });

  it('空便笺的标题、占位文字、桌面便笺也是英文', async () => {
    await t.page.evaluate(() => switchTo('c'));
    assert.equal(await t.page.textContent('#note-title'), 'Empty note');
    assert.equal(await t.page.evaluate(() => getComputedStyle(el.editor, '::before').content), '"Write something…"');
    await t.page.evaluate(() => { switchTo('a'); return stickNote('a', 900, 200); });
    await sleep(1200);
    const sticky = t.app.windows().find(w => w.url().includes('note=a'));
    await sticky.waitForFunction(() => typeof state !== 'undefined' && !!state.activeId);
    assert.equal(await sticky.getAttribute('#btn-close', 'title'), 'Put back into the notebook');
    assert.deepEqual(await leftoverChinese(sticky), []);
  });

  it('主进程（托盘菜单、对话框、通知）用的也是英文', async () => {
    // 主进程和页面用同一份翻译表、同一个语言判断；这里确认主进程认定的语言，译文是否齐全由上面「翻译表」检查
    assert.deepEqual(await t.page.evaluate(() => window.api.getLanguage()), { setting: 'auto', lang: 'en' });
  });
});

describe('切换语言', () => {
  let t;
  before(async () => {
    // 不指定语言：跟随系统。全新的数据目录，会出现欢迎便笺
    t = await launchApp({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'floatnote-lang-')), env: { FLOATNOTE_LANG: '' } });
  });
  after(async () => {
    await t.close();
    assert.deepEqual(t.errors, []);
  });
  const waitLang = (lang) => t.page.waitForFunction((l) => typeof LANG !== 'undefined' && LANG === l && typeof state !== 'undefined' && !!state.activeId, lang);

  it('默认跟随系统语言；欢迎便笺用当时的语言写', async () => {
    const sys = i18n.fromLocale(await t.app.evaluate(({ app }) => app.getLocale()));
    assert.equal(await t.page.evaluate(() => LANG), sys);
    assert.equal(await t.page.textContent('#note-title'), sys === 'en' ? 'Welcome to FloatNote' : '欢迎使用 FloatNote');
    await t.page.click('#btn-settings');
    assert.equal(await t.page.getAttribute('#sm-language .active', 'data-lang'), 'auto');
    await t.page.keyboard.press('Escape');
  });

  it('设置里改成 English / 中文：界面立刻切换，重启后保持', async () => {
    await t.page.click('#btn-settings');
    await t.page.click('#sm-language [data-lang=en]');
    await waitLang('en');
    await sleep(300);
    assert.equal(await t.page.getAttribute('#btn-new', 'title'), 'New note');
    await t.page.click('#btn-settings');
    assert.equal(await t.page.getAttribute('#sm-language .active', 'data-lang'), 'en');
    await t.page.click('#sm-language [data-lang=zh]');
    await waitLang('zh');
    await sleep(300);
    assert.equal(await t.page.getAttribute('#btn-new', 'title'), '新建便笺');
    await flush();
    assert.equal(t.local().language, 'zh', '语言记在本机设置里');
    assert.equal(t.saved().settings.language, undefined, '不随数据目录同步');
    await t.close();
    t = await launchApp({ dir: t.dir, env: { FLOATNOTE_LANG: '' } });
    assert.equal(await t.page.evaluate(() => LANG), 'zh');
  });
});
