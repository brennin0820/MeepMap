'use strict';

const fs = require('fs');
const path = require('path');
const { app, screen } = require('electron');

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function isVisible(bounds) {
  if (bounds.x == null || bounds.y == null) return true;
  return screen.getAllDisplays().some((display) => {
    const b = display.bounds;
    return bounds.x >= b.x && bounds.y >= b.y && bounds.x < b.x + b.width && bounds.y < b.y + b.height;
  });
}

function load(fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const state = { ...fallback, ...parsed };
    return isVisible(state) ? state : fallback;
  } catch {
    return fallback;
  }
}

function track(win) {
  const save = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const bounds = win.getBounds();
    try {
      fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, isMaximized: win.isMaximized() }));
    } catch {
      // Best effort only; window state should never block quitting.
    }
  };

  win.on('resize', save);
  win.on('move', save);
  win.on('close', save);
}

module.exports = { load, track };
