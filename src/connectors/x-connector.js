const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ipcMain } = require('electron');
const { normalizeXMessage } = require('./x-message-parser');

const X_CAPTURE_WINDOW_WIDTH = 900;
const X_CAPTURE_WINDOW_HEIGHT = 760;
const X_CAPTURE_OFFSCREEN_POSITION = -10_000;
const X_CAPTURE_PARTITION = 'persist:x-capture';
const X_COMPOSER_UNAVAILABLE_CODE = 'x-composer-unavailable';
const X_COMPOSER_UNAVAILABLE_MESSAGE =
  'X chat composer is unavailable. X may require Premium or chat permission for this live; open the X capture window to confirm this account can write there.';

const createXConnector = ({
  liveUrl,
  BrowserWindow,
  ipcMainImpl = ipcMain,
  show = false,
  partition = X_CAPTURE_PARTITION,
} = {}) => {
  const events = new EventEmitter();
  const normalizedLiveUrl = normalizeXLiveUrl(liveUrl);
  const captureUrl = createXCaptureUrl(normalizedLiveUrl);
  let captureWindow;
  let unsubscribeIpc;

  const connect = async () => {
    if (captureWindow && !captureWindow.isDestroyed()) {
      return;
    }

    captureWindow = new BrowserWindow({
      width: X_CAPTURE_WINDOW_WIDTH,
      height: X_CAPTURE_WINDOW_HEIGHT,
      x: show ? undefined : X_CAPTURE_OFFSCREEN_POSITION,
      y: show ? undefined : X_CAPTURE_OFFSCREEN_POSITION,
      show: false,
      skipTaskbar: !show,
      focusable: show,
      autoHideMenuBar: true,
      title: 'X Chat Capture',
      webPreferences: {
        preload: path.join(__dirname, '..', 'x-capture-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition,
        backgroundThrottling: false,
      },
    });

    if (show) {
      captureWindow.show();
    } else {
      captureWindow.showInactive?.();
    }

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
      await captureWindow.loadURL(captureUrl);
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
    captureUrl,
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
    send,
  };

  async function send(text) {
    const normalizedText = normalizeXSendText(text);

    if (!captureWindow || captureWindow.isDestroyed()) {
      throw new Error('X capture window is not connected.');
    }

    const result = await captureWindow.webContents.executeJavaScript(
      createXSendMessageScript(normalizedText),
      true,
    );

    if (!result?.ok) {
      throw createXSendError(result);
    }

    return result;
  }
};

const normalizeXLiveUrl = (liveUrl) => {
  if (typeof liveUrl !== 'string' || liveUrl.trim().length === 0) {
    throw new TypeError('X live URL or handle must be a non-empty string.');
  }

  const trimmedValue = liveUrl.trim();
  const handleUrl = createXLiveChatUrlFromHandle(trimmedValue);

  if (handleUrl) {
    return handleUrl;
  }

  const parsedUrl = new URL(trimmedValue);

  if (!['x.com', 'twitter.com'].includes(parsedUrl.hostname.toLowerCase())) {
    throw new TypeError('X live URL must point to x.com or twitter.com.');
  }

  return parsedUrl.toString();
};

const createXCaptureUrl = (liveUrl) => {
  const parsedUrl = new URL(normalizeXLiveUrl(liveUrl));
  const normalizedPathname = parsedUrl.pathname.replace(/\/+$/, '');

  if (/^\/i\/broadcasts\/[^/]+$/i.test(normalizedPathname)) {
    parsedUrl.pathname = `${normalizedPathname}/chat`;
    parsedUrl.search = '';
    parsedUrl.hash = '';
  }

  return parsedUrl.toString();
};

const createXLiveChatUrlFromHandle = (value) => {
  const handle = value.replace(/^@/, '');

  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return undefined;
  }

  return `https://x.com/${handle}/livechat`;
};

const normalizeXSendText = (text) => {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new TypeError('X message text is required.');
  }

  return text.trim();
};

const createXSendError = (result = {}) => {
  const error = new Error(result.error || 'X send failed.');

  if (result.code) {
    error.code = result.code;
  }

  return error;
};

const isXComposerUnavailableError = (error) => error?.code === X_COMPOSER_UNAVAILABLE_CODE;

const createXSendMessageScript = (text) => `
(() => {
  const message = ${JSON.stringify(text)};
  const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const composer =
    document.querySelector("textarea[aria-label='Send a message']") ||
    document.querySelector("textarea[placeholder='Send a message']") ||
    document.querySelector("textarea[inputmode='text']") ||
    document.querySelector("[role='textbox'][contenteditable='true']");

  if (!composer) {
    return {
      ok: false,
      code: '${X_COMPOSER_UNAVAILABLE_CODE}',
      error: '${X_COMPOSER_UNAVAILABLE_MESSAGE}',
    };
  }

  composer.focus();

  if (composer.isContentEditable) {
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, message);
  } else {
    const valuePrototype =
      composer instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(valuePrototype, 'value');

    descriptor?.set?.call(composer, message);
  }

  composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
  composer.dispatchEvent(new Event('change', { bubbles: true }));

  const buttons = [...document.querySelectorAll("button, [role='button']")];
  const sendButton = buttons.find((button) => {
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    const label = normalizeText(
      [
        button.getAttribute('aria-label'),
        button.getAttribute('data-testid'),
        button.textContent,
      ].filter(Boolean).join(' '),
    );

    return /(^| )(send|post|reply|tweet)( |$)/i.test(label);
  });

  if (!sendButton) {
    return { ok: false, error: 'X send button was not found or is disabled.' };
  }

  sendButton.click();
  return { ok: true };
})();
`;

module.exports = {
  createXCaptureUrl,
  createXConnector,
  createXLiveChatUrlFromHandle,
  createXSendMessageScript,
  isXComposerUnavailableError,
  normalizeXLiveUrl,
  normalizeXSendText,
  X_CAPTURE_WINDOW_HEIGHT,
  X_CAPTURE_WINDOW_WIDTH,
  X_CAPTURE_OFFSCREEN_POSITION,
  X_CAPTURE_PARTITION,
  X_COMPOSER_UNAVAILABLE_CODE,
  X_COMPOSER_UNAVAILABLE_MESSAGE,
};
