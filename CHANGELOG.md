# Changelog

**English** | [简体中文](CHANGELOG.zh-CN.md)

On each release, the Unreleased section becomes the English half of that version's release notes. The Chinese half comes from the 未发布 section of [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md).
Keep both files up to date. Write for people who use the app: say what changed and what it means for them, and leave out code details.

## Unreleased

### Added

- English interface. The language follows your system by default, and you can pick Auto, 中文 or English under Settings → Language. The tray menu, system dialogs, notifications and the welcome note switch with it.
- The installer shows English or Chinese to match the system language.

## v1.0.6 (2026-11-12)

### Appearance

- Corner radii follow one scale: the card, menus and buttons step down from the outside in, so they look consistent. Desktop notes use a slightly smaller radius.
- The active note no longer has a blue outline. Its border picks up a hint of the theme color and its shadow gets a little stronger. Shadows are no longer cut off at the window edge.
- On ruled, grid and dotted paper, headings, to-dos and lists sit on the lines.
- Long notes get a thin, rounded scrollbar that stays faint until you hover over the note.
- Checkboxes in Settings are now toggle switches. Menus open with a subtle animation. The switcher list is wider, so titles show more text.
- The resize handle is a short arc that follows the corner. Captured quotes, the strikethrough on finished to-dos and the "×" on tags are all softer.

## v1.0.5 (2026-11-12)

### Fixed

- The first line of a long to-do stays aligned with its wrapped lines. Font size, indentation and inline formatting such as bold no longer shift it.
- Pressing Enter at the end of a to-do that contains bold text or pasted paragraphs reliably starts a new, separate to-do.
- Pressing Enter in the middle of a to-do keeps the text and formatting on both sides. The new to-do keeps the indentation and starts unchecked. Undo and redo work.
- To-dos saved by earlier versions keep their text and checked state. Shift+Enter still adds a line break inside a to-do.
- The Up arrow can reach the line above an empty to-do. The caret no longer jumps back and forth between the start and end of the next to-do.
- Up and Down move by visual line inside long to-dos and keep the caret's horizontal position. Consecutive empty to-dos, indentation and inline formatting no longer get in the way.
- The caret stays visible while you move up and down through a long note. After you reposition it with the mouse or the Left and Right keys, the new horizontal position is used.

## v1.0.4 (2026-11-10)

### Fixed

- When a note sits above your browser, you can click it and drag to select text. Dragging past the edge of the card no longer breaks the selection.
- One press of the hotkey brings the notebook back when it is in the background, hidden or docked. Pressing it again while the notebook is in front hides it.
- The pin button, the Settings panel and the actual window state stay in agreement. Each window's choice is restored after a restart, after waking from sleep and after settings sync.
- The temporary always-on-top state used while docked does not change your own setting, which comes back when the note leaves the edge.
- Clicking the tray icon always shows the notebook. The tray menu's show/hide item hides the window correctly even though opening the menu takes focus away.
- The pin button's tooltip says whether it is on or off. Turn on Always on top if you want a note to stay above your browser.

## v1.0.3 (2026-11-09)

### Fixed

- One Backspace at the start of a to-do removes the checkbox. It used to take two, and the caret jumped in front of the checkbox.
- Delete at the end of a line pulls up the text of the to-do below, instead of leaving half a to-do behind.
- The Left arrow no longer gets stuck at the start of a to-do. Shift+Home no longer selects the checkbox.
- Backspace at the start of a list item removes the bullet or number first and leaves the text on its line.
- In a very narrow window, the buttons on the right side of the toolbar are no longer pushed out of view.
- The desktop icon no longer keeps showing the old icon after an update.

### Added

- Bullet list with `Ctrl+Shift+8`, numbered list with `Ctrl+Shift+7`. Typing `- ` or `1. ` at the start of a line also works.
- Settings shows the full path of the folder where your notes are saved, with a button to open it.
- The note's ⋯ menu has a "Delete this note" item.

## v1.0.2 (2026-11-09)

The first public release.

- A welcome note on first launch walks you through the basics with a short checklist.
- A To-do button in the toolbar. Hover a note to add a tag directly.
- The ⋯ button in the toolbar holds settings for the current note: color, paper, rename, tags and stick to desktop.
- Resize from any edge or corner.
- `Ctrl+N` creates a note, `Ctrl+F` searches your notes.
- The Undo prompt moved to the bottom, so it no longer covers your text.
- "Always on top" now refers only to the window staying above others. Keeping a note first in the list is a separate star button.
