'use strict';

/**
 * 启动器：清除 ELECTRON_RUN_AS_NODE 后以桌面应用模式启动 Electron。
 * 某些终端/Agent 环境会设置 ELECTRON_RUN_AS_NODE=1，导致 Electron 以纯 Node 模式运行，
 * require('electron') 返回路径字符串而非 API。这里显式清除该变量。
 */
const { spawn } = require('child_process');
const electron = require('electron'); // 返回 electron.exe 路径字符串

delete process.env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.'], { stdio: 'inherit', env: process.env });
child.on('close', (code) => process.exit(code));
