const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ipcMain } = require('electron');
const { normalizeXMessage } = require('./x-message-parser');

const createXConnector = ({
  liveUrl,
  BrowserWindow,
  ipcMainImpl = ipcMain,
  show = false,
  partition = 'persist:x-capture',
} = {}) => {
  const events = new EventEmitter();
  const normalizedLiveUrl = normalizeXLiveUrl(liveUrl);
  let captureWindow;
  let unsubscribeIpc;

  const connect = async () => {
    if (captureWindow && !captureWindow.isDestroyed()) {
      return;
    }

    captureWindow = new BrowserWindow({
      width: 420,
      height: 760,
      show,
      title: 'X Chat Capture',
      webPreferences: {
        preload: path.join(__dirname, '..', 'x-capture-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition,
      },
    });

    const senderId = captureWindow.webContents.id;

    const onMessage = (event, payload) => {
      if (event.sender.id !== senderId) {
        return;
      }

      try {
        events.emit('message', normalizeXMessage(payload));
      } catch (error) {
        events.emit('connector-error', error);
      }
    };

    const onStatus = (event, status) => {
      if (event.sender.id === senderId) {
        events.emit('status', status);
      }
    };

    ipcMainImpl.on('x-capture:message', onMessage);
    ipcMainImpl.on('x-capture:status', onStatus);
    unsubscribeIpc = () => {
      ipcMainImpl.off('x-capture:message', onMessage);
      ipcMainImpl.off('x-capture:status', onStatus);
    };

    captureWindow.on('closed', () => {
      captureWindow = undefined;
      unsubscribeIpc?.();
      unsubscribeIpc = undefined;
    });

    try {
      await captureWindow.loadURL(normalizedLiveUrl);
    } catch (error) {
      events.emit('connector-error', error);
    }
  };

  const disconnect = async () => {
    unsubscribeIpc?.();
    unsubscribeIpc = undefined;

    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.close();
    }

    captureWindow = undefined;
  };

  return {
    platform: 'x',
    liveUrl: normalizedLiveUrl,
    onMessage: (listener) => {
      events.on('message', listener);
      return () => events.off('message', listener);
    },
    onError: (listener) => {
      events.on('connector-error', listener);
      return () => events.off('connector-error', listener);
    },
    onStatus: (listener) => {
      events.on('status', listener);
      return () => events.off('status', listener);
    },
    connect,
    disconnect,
    send: async () => {
      throw new Error('X send is not implemented in the read MVP.');
    },
  };
};

const normalizeXLiveUrl = (liveUrl) => {
  if (typeof liveUrl !== 'string' || liveUrl.trim().length === 0) {
    throw new TypeError('X live URL must be a non-empty string.');
  }

  const parsedUrl = new URL(liveUrl.trim());

  if (!['x.com', 'twitter.com'].includes(parsedUrl.hostname.toLowerCase())) {
    throw new TypeError('X live URL must point to x.com or twitter.com.');
  }

  return parsedUrl.toString();
};

module.exports = {
  createXConnector,
  normalizeXLiveUrl,
};
