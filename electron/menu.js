'use strict';

const { Menu, dialog, app } = require('electron');

/**
 * @param {() => import('electron').BrowserWindow|null} getMainWindow
 */
function buildApplicationMenu(getMainWindow) {
  const isMac = process.platform === 'darwin';

  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about', label: 'About MeepMap' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit', label: 'Quit MeepMap' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        isMac
          ? { role: 'close', label: 'Close Window' }
          : { role: 'quit', label: 'Quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => getMainWindow()?.webContents.reload(),
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => getMainWindow()?.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About MeepMap',
          click: () => {
            const win = getMainWindow();
            dialog.showMessageBox(win ?? undefined, {
              type: 'info',
              title: 'About MeepMap',
              message: 'MeepMap — WNBA Bet Predictor',
              detail: `Version ${app.getVersion()}\nDecision-driven betting intelligence platform.`,
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildApplicationMenu };
