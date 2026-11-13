'use strict';

/* ============ 界面语言：中文 / English ============
   源码里的界面文字都用中文写，中文就是“键”：t('新建便笺')。
   语言是英文时到下面的 EN 表里查译文；查不到就原样显示中文（tests/i18n.test.js 会检查有没有漏翻）。
   带变量的文字用 {0} {1} 占位：t('已恢复「{0}」', title)。需要区分单复数时，译文写成函数。

   这个文件渲染进程和主进程共用：
   - 渲染进程：index.html 最先加载它，得到全局的 LANG、t()、fmtDate()，并把 index.html 里写死的中文换成译文
   - 主进程：require('../renderer/i18n.js')，托盘菜单、系统对话框、通知用 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.I18N = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const plural = (one, many) => (n) => (Number(n) === 1 ? one : many).replace('{0}', n);

  const EN = {
    /* ---- 工具栏 ---- */
    '新建便笺': 'New note',
    '单击切换便笺 · 双击重命名（F2）': 'Click to switch notes · double-click to rename (F2)',
    '双击重命名（F2）': 'Double-click to rename (F2)',
    '待办：把当前行变成可勾选的待办，再点一次还原（Ctrl + Shift + T）': 'To-do: turn the current line into a checkbox item; click again to turn it back (Ctrl + Shift + T)',
    '待办': 'To-do',
    '这张便笺：颜色、纸张、重命名、标签、贴到桌面': 'This note: color, paper, rename, tags, stick to desktop',
    '这张便笺的设置': 'Settings for this note',
    '删除当前便笺（可撤销）': 'Delete this note (can be undone)',
    '删除当前便笺': 'Delete this note',
    '设置': 'Settings',
    '窗口置顶（总在其他窗口上方）': 'Always on top (stay above other windows)',
    '窗口置顶': 'Always on top',
    '这张桌面便笺置顶': 'Keep this note on top',
    '{0}：已开启（点击取消）': '{0}: on (click to turn off)',
    '{0}：已关闭（点击开启，保持在其他窗口上方）': '{0}: off (click to keep it above other windows)',
    '隐藏窗口（快捷键可唤回）': 'Hide window (bring it back with the hotkey)',
    '隐藏窗口': 'Hide window',
    '隐藏到托盘（托盘菜单可退出）': 'Hide to tray (quit from the tray menu)',
    '隐藏到托盘': 'Hide to tray',
    '放回便笺本': 'Put back into the notebook',
    '展开便笺': 'Expand note',
    '拖拽调整大小': 'Drag to resize',

    /* ---- 编辑区、状态栏 ---- */
    '记录点什么…': 'Write something…',
    '开始输入…': 'Start typing…',
    '空便笺': 'Empty note',
    '今日完成 {0} 件 · ': '{0} done today · ',
    '{0} 字 · ': plural('{0} char · ', '{0} chars · '),
    '刚刚编辑': 'edited just now',
    '编辑于 {0}': 'edited {0}',
    '刚刚': 'just now',
    '{0} 分钟前': '{0} min ago',
    '{0} 小时前': '{0} h ago',
    '待办 {0}/{1}': 'To-dos {0}/{1}',
    '图片': 'Image',
    '剪贴板中没有图片': 'No image on the clipboard',
    '全部完成，休息一下吧': 'All done. Take a break.',
    'Ctrl + 单击打开': 'Ctrl + click to open',
    '剪贴板': 'Clipboard',
    '已捕捉到「{0}」': 'Captured to "{0}"',

    /* ---- 标签 ---- */
    '＋ 标签': '+ Tag',
    '添加标签（Ctrl + Shift + L）': 'Add tag (Ctrl + Shift + L)',
    '标签名，回车确认': 'Tag name, Enter to add',
    '点击移除标签': 'Click to remove tag',

    /* ---- 这张便笺的菜单 ---- */
    '颜色': 'Color',
    '白玻璃': 'Glass',
    '暖黄便利贴': 'Yellow',
    '薄荷绿': 'Mint',
    '樱花粉': 'Pink',
    '牛皮纸': 'Kraft',
    '深色': 'Dark',
    '纸张': 'Paper',
    '素': 'Plain',
    '横线': 'Ruled',
    '方格': 'Grid',
    '点阵': 'Dots',
    '折角': 'Fold',
    '素纸': 'Plain paper',
    '横线本': 'Ruled paper',
    '方格本': 'Grid paper',
    '点阵本': 'Dotted paper',
    '便利贴折角': 'Dog-eared corner',
    '重命名': 'Rename',
    'F2 / 双击标题': 'F2 / double-click title',
    '添加标签': 'Add tag',
    '固定在列表最前': 'Keep at top of list',
    '取消固定': 'Stop keeping at top',
    '已固定在列表最前': 'Kept at the top of the list',
    '已取消固定': 'No longer kept at the top',
    '贴到桌面': 'Stick to desktop',
    '也可从列表里拖出窗口': 'or drag it out of the list',
    '删除这张便笺': 'Delete this note',
    '可在「最近删除」找回': 'kept in Recently deleted',
    '先写点什么再贴到桌面吧': 'Write something first, then stick it to the desktop',
    '当前便笺还是空的，直接写吧': 'This note is still empty. Just start typing.',

    /* ---- 切换列表、最近删除 ---- */
    '搜索标题、正文、标签': 'Search titles, text and tags',
    '没有匹配的便笺': 'No matching notes',
    '桌面': 'Desktop',
    '已贴在桌面上，点击把它叫到前面': 'On the desktop. Click to bring it to the front',
    '输入便笺标题': 'Note title',
    '回车保存 · Esc 取消 · 留空则用第一行文字': 'Enter to save · Esc to cancel · leave empty to use the first line',
    '最近删除': 'Recently deleted',
    '返回': 'Back',
    '‹ 返回': '‹ Back',
    '清空': 'Empty',
    '确认清空？': 'Empty for good?',
    '「最近删除」已清空': 'Recently deleted has been emptied',
    '删除的便笺会保留 {0} 天，之后自动彻底删除': 'Deleted notes are kept for {0} days, then removed for good',
    '还剩 {0} 天': plural('{0} day left', '{0} days left'),
    '即将彻底删除': 'About to be removed',
    '恢复': 'Restore',
    '恢复这张便笺': 'Restore this note',
    '彻底删除': 'Delete for good',
    '彻底删除（不可恢复）': 'Delete for good (cannot be undone)',
    '已恢复「{0}」': 'Restored "{0}"',
    '已移到「最近删除」': 'Moved to Recently deleted',
    '撤销': 'Undo',

    /* ---- 设置 ---- */
    '语言': 'Language',
    '自动': 'Auto',
    '跟随系统语言': 'Follow the system language',
    '外观': 'Appearance',
    '手动': 'Manual',
    '跟随系统': 'System',
    '跟随时间': 'Time of day',
    '始终使用便笺自己的颜色': "Always use each note's own color",
    '系统切到深色模式时，便笺也变暗': 'Notes turn dark when the system switches to dark mode',
    '早上 6–10 点偏暖，晚上 10 点到早上 6 点自动变暗': 'Warmer from 6 to 10 am, dark from 10 pm to 6 am',
    '字号': 'Font size',
    '背景透明度': 'Background opacity',
    '鼠标移开时隐藏工具栏': 'Hide toolbar when the pointer leaves',
    '拖到屏幕边缘时贴边收起': 'Dock at the screen edge',
    '开机自动启动': 'Start with the system',
    '便笺保存在': 'Notes are saved in',
    '这台电脑的默认位置': 'default location',
    '自选文件夹': 'custom folder',
    '点击打开这个文件夹': 'Click to open this folder',
    '打开文件夹': 'Open folder',
    '换到同步文件夹…': 'Move to a sync folder…',
    '选一个 OneDrive、坚果云等同步文件夹，便笺会搬过去，多台电脑就能共用': 'Pick a folder in OneDrive, Dropbox or another sync service. Your notes move there, so several computers can share them',
    '改回默认': 'Reset',
    '搬回这台电脑上的默认位置': 'Move back to the default location on this computer',
    '版本': 'Version',
    '开发版不自动更新': 'Dev build, no auto-update',
    '便携版请手动下载新版本': 'Portable: update manually',
    '此安装方式不支持自动更新': 'Auto-update not supported',
    '检查更新': 'Check for updates',
    '已是最新版本': 'Up to date',
    '正在检查…': 'Checking…',
    '检查失败，点击重试': 'Check failed. Retry',
    '正在下载 v{0} · {1}%': 'Downloading v{0} · {1}%',
    '重启更新到 v{0}': 'Restart to update to v{0}',
    '新版本 v{0} 已下载': 'Version {0} is ready',
    '重启更新': 'Restart',

    /* ---- 快捷键 ---- */
    '唤起 / 隐藏': 'Show / hide',
    '快速捕捉': 'Quick capture',
    '点击后按下新的组合键': 'Click, then press the new shortcut',
    '请按下组合键…': 'Press the new shortcut…',
    'Esc 取消 · Backspace 恢复默认': 'Esc to cancel · Backspace to reset',
    '和另一个快捷键重复了，换一个吧': 'Same as the other shortcut. Try another.',
    '这个组合被其他软件占用了，换一个吧': 'Already used by another program. Try another.',
    '已保存': 'Saved',
    '已恢复默认': 'Reset to default',
    '至少要带 Ctrl / Alt / Win 之一': 'Include Ctrl, Alt or Win',
    '未注册': 'Not set',
    '{0}（注册失败，可能被占用）': '{0} (unavailable, may be in use)',
    '全部快捷键': 'All shortcuts',
    '搜索便笺': 'Search notes',
    '缩进 / 取消缩进': 'Indent / outdent',
    '待办 / 还原': 'To-do on / off',
    '重命名便笺': 'Rename note',
    '双击标题 / F2': 'Double-click title / F2',
    '圆点 / 编号列表': 'Bullet / numbered list',
    '快捷输入': 'Markdown shortcuts',
    '行首输入 [] - 1. # 再按空格': 'Type [] - 1. # at line start, then Space',
    '撤销 / 重做': 'Undo / redo',
    '粘贴纯文本': 'Paste as plain text',
    '打开链接': 'Open link',
    'Ctrl + 单击': 'Ctrl + click',
    '粘贴图片': 'Paste image',
    '找回窗口': 'Find the window',
    '托盘图标 / 唤起快捷键': 'Tray icon / show-hide hotkey',

    /* ---- 欢迎便笺 ---- */
    '唤起快捷键': 'the show/hide hotkey',
    '快速捕捉快捷键': 'the quick capture hotkey',
    '欢迎使用 FloatNote': 'Welcome to FloatNote',
    '你好！这是一张便笺，写下的内容会自动保存。跟着下面几步熟悉一下，做完一件就勾掉一件：': 'Hi! This is a note. Whatever you write is saved automatically. Try the steps below and check each one off as you go:',
    '在任何程序里按 {0}，隐藏或唤回这个窗口': 'Press {0} in any app to hide this window or bring it back',
    '点工具栏上的「待办」按钮，把一行文字变成可以勾选的待办': 'Click the To-do button in the toolbar to turn a line into a checkbox item',
    '点「⋯」给这张便笺换个颜色、换种纸张': 'Click ⋯ to give this note a different color or paper',
    '把窗口拖到屏幕左边或右边，它会收成一条细边，鼠标移过去就展开': 'Drag the window to the left or right edge of the screen. It folds into a thin tab and opens when the pointer touches it',
    '在浏览器里选中一段文字，按 {0}，它会被收进当前便笺': 'Select some text in your browser and press {0} to drop it into this note',
    '点「⋯」→「贴到桌面」，把一张便笺单独贴在桌面上': 'Click ⋯, then Stick to desktop, to give a note its own window',
    '小技巧：行首输入「- 」（减号加空格）变成圆点列表，「1. 」变成编号列表，「[] 」变成待办；在列表开头按退格可以去掉圆点。': 'Tip: at the start of a line, type "- " (hyphen, space) for a bullet list, "1. " for a numbered list, or "[] " for a to-do. Press Backspace at the start of a list item to remove the bullet.',
    '右上角「设置」里可以改快捷键、透明度，看便笺保存在哪个文件夹，还有全部快捷键的说明。看完点垃圾桶删掉这张就好。': 'Settings (top right) lets you change the hotkeys and opacity, see which folder your notes are saved in, and look up every shortcut. When you are done, click the trash can to delete this note.',

    /* ---- 主进程：托盘菜单 ---- */
    'FloatNote 便签': 'FloatNote',
    '桌面便签': 'Desktop sticky notes',
    '快捷键 {0}': 'Hotkey {0}',
    '快捷键注册失败': 'Hotkey unavailable',
    '快速捕捉 {0}': 'Quick capture {0}',
    '快速捕捉快捷键注册失败': 'Quick capture hotkey unavailable',
    '显示 / 隐藏便签': 'Show / hide',
    '新建便签': 'New note',
    '找回窗口（移到屏幕中央）': 'Bring window to the center of the screen',
    '重启并更新到 v{0}': 'Restart and update to v{0}',
    '从备份恢复': 'Restore from backup',
    '还没有备份（每天首次启动时自动备份）': 'No backups yet (one is made on the first launch each day)',
    '打开数据文件夹': 'Open data folder',
    '退出 FloatNote': 'Quit FloatNote',

    /* ---- 主进程：通知 ---- */
    'FloatNote 已隐藏': 'FloatNote is hidden',
    '按 {0} 或点击托盘图标即可唤回': 'Press {0} or click the tray icon to bring it back',
    '全局快捷键': 'the global hotkey',
    '没有可捕捉的文字': 'Nothing to capture',
    '先在其他程序里选中文字，再按 {0}。': 'Select some text in another app, then press {0}.',
    '已捕捉到便笺': 'Captured',
    'FloatNote 新版本已就绪': 'A new version of FloatNote is ready',
    'v{0} 已下载，重启即可更新（不重启的话下次退出时自动安装）': 'v{0} has been downloaded. Restart to update, or it installs the next time you quit.',
    '数据文件损坏，已自动恢复': 'The data file was damaged and has been restored',
    '已从 {0} 的备份恢复。损坏的文件已改名保留在数据文件夹中。': 'Restored from the {0} backup. The damaged file was renamed and kept in the data folder.',
    '已从备份恢复': 'Restored from backup',
    '{0}，共 {1} 张便笺': (label, n) => (Number(n) === 1 ? '{0}, 1 note' : '{0}, {1} notes'),

    /* ---- 主进程：对话框 ---- */
    '取消': 'Cancel',
    '这份备份无法读取': 'This backup cannot be read',
    '用 {0} 的备份替换现在的所有便笺？': 'Replace all current notes with the {0} backup?',
    '备份里有 {0} 张便笺。现在的数据会先另存为 backups/before-restore-*.json，选错了还能找回。': 'The backup contains {0} notes. Your current data is saved first as backups/before-restore-*.json, so you can get it back.',
    '这个文件夹无法写入：{0}': 'Cannot write to this folder: {0}',
    '不是 FloatNote 的数据': 'Not FloatNote data',
    '那里的 data.json 无法读取：{0}': 'The data.json in that folder cannot be read: {0}',
    '那里的 data.json 无法读取': 'The data.json in that folder cannot be read',
    '选择便笺保存位置': 'Choose where to save your notes',
    '保存到这里': 'Save here',
    '合并两边的便笺': 'Merge both',
    '只用那里的便笺': 'Use the notes there',
    '这个文件夹里已经有 {0} 张便笺': plural('This folder already contains 1 note', 'This folder already contains {0} notes'),
    '合并：两边的便笺都保留，同一张便笺以最后修改的为准。\n只用那里的：本机现在的便笺不带过去（仍留在原位置，随时可以切回来）。': 'Merge: keep the notes from both sides. If the same note exists on both, the most recent edit wins.\nUse the notes there: the notes on this computer are not carried over. They stay where they are, and you can switch back at any time.',
    '复制过去并使用': 'Copy and use',
    '把便笺保存到这个文件夹？': 'Save your notes in this folder?',
    '{0}\n\n现有的便笺和图片会复制过去，之后的修改都保存在那里；原位置的文件保留不动。\n放在 OneDrive、坚果云、iCloud 等同步文件夹里，多台电脑就能共用便笺。': '{0}\n\nYour notes and images are copied there, and later changes are saved there. The files in the old location are left in place.\nChoose a folder inside OneDrive, Dropbox, iCloud Drive or another sync service to share notes between computers.'
  };

  const fill = (s, args) => s.replace(/\{(\d+)\}/g, (m, i) => (args[i] === undefined ? m : String(args[i])));

  /* 取译文并填入变量。lang 不是 'en' 时原样返回中文 */
  function translate(lang, s, ...args) {
    if (lang === 'en' && Object.prototype.hasOwnProperty.call(EN, s)) {
      const e = EN[s];
      if (typeof e === 'function') return fill(e(...args), args);
      return fill(e, args);
    }
    return fill(s, args);
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (v) => String(v).padStart(2, '0');

  /* 日期：中文「11月12日」「2026年11月12日」，英文「Nov 12」「Nov 12, 2026」；time 为真时带上时:分 */
  function formatDate(lang, date, { year = false, time = false } = {}) {
    const d = new Date(date);
    const hm = time ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
    if (lang === 'en') return `${MONTHS[d.getMonth()]} ${d.getDate()}` + (year ? `, ${d.getFullYear()}` : '') + (time ? ',' + hm : '');
    return (year ? `${d.getFullYear()}年` : '') + `${d.getMonth() + 1}月${d.getDate()}日` + hm;
  }

  /* 系统语言 → 界面语言：中文系统用中文，其他一律英文 */
  const fromLocale = (locale) => (/^zh\b/i.test(String(locale || '')) ? 'zh' : 'en');

  /* 把一段现成的 DOM（index.html 里写死的中文）换成译文：文字节点，以及提示、占位文字等属性 */
  const ATTRS = ['title', 'aria-label', 'placeholder', 'data-placeholder', 'data-placeholder-focus', 'alt'];
  function translateDom(lang, rootEl) {
    if (lang !== 'en' || !rootEl) return;
    const doc = rootEl.ownerDocument;
    const els = [rootEl, ...rootEl.querySelectorAll('*')];
    for (const node of els) {
      for (const a of ATTRS) {
        const v = node.getAttribute && node.getAttribute(a);
        if (v && Object.prototype.hasOwnProperty.call(EN, v)) node.setAttribute(a, translate(lang, v));
      }
    }
    const walker = doc.createTreeWalker(rootEl, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const key = n.data.trim();
      if (key && Object.prototype.hasOwnProperty.call(EN, key)) n.data = n.data.replace(key, translate(lang, key));
    }
  }

  return { EN, translate, formatDate, fromLocale, translateDom };
});

/* 渲染进程：定下这个窗口的语言（主进程通过 preload 同步给出），提供全局的 t() / fmtDate()，
   并在其他脚本运行之前把页面上写死的中文换掉 */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.LANG = (window.api && window.api.lang) === 'en' ? 'en' : 'zh';
  window.t = (s, ...args) => window.I18N.translate(window.LANG, s, ...args);
  window.fmtDate = (date, opts) => window.I18N.formatDate(window.LANG, date, opts);
  document.documentElement.lang = window.LANG === 'en' ? 'en' : 'zh-CN';
  document.body.classList.add('lang-' + window.LANG);
  window.I18N.translateDom(window.LANG, document.body);
}
