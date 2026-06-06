const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const {
  createXCaptureUrl,
  createXConnector,
  createXLiveChatUrlFromHandle,
  createXSendMessageScript,
  isXComposerUnavailableError,
  normalizeXLiveUrl,
  normalizeXSendText,
  X_COMPOSER_UNAVAILABLE_CODE,
  X_COMPOSER_UNAVAILABLE_MESSAGE,
  X_CAPTURE_OFFSCREEN_POSITION,
  X_CAPTURE_WINDOW_HEIGHT,
  X_CAPTURE_WINDOW_WIDTH,
} = require('../src/connectors/x-connector');

class FakeIpcMain extends EventEmitter {
  on(channel, listener) {
    return super.on(channel, listener);
  }

  off(channel, listener) {
    return super.off(channel, listener);
  }
}

class FakeWebContents {
  constructor(id) {
    this.id = id;
    this.executedScripts = [];
    this.executeResult = { ok: true };
  }

  async executeJavaScript(script) {
    this.executedScripts.push(script);
    return this.executeResult;
  }
}

const createFakeBrowserWindowClass = () => {
  let nextId = 1;
  const instances = [];

  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new FakeWebContents(nextId);
      nextId += 1;
      this.loadedUrl = undefined;
      this.closed = false;
      this.shown = false;
      this.shownInactive = false;
      instances.push(this);
    }

    async loadURL(url) {
      this.loadedUrl = url;
    }

    isDestroyed() {
      return this.closed;
    }

    close() {
      this.closed = true;
      this.emit('closed');
    }

    show() {
      this.shown = true;
    }

    showInactive() {
      this.shownInactive = true;
    }
  }

  FakeBrowserWindow.instances = instances;
  return FakeBrowserWindow;
};

const createFailingBrowserWindowClass = () => {
  class FailingBrowserWindow extends EventEmitter {
    constructor() {
      super();
      this.webContents = new FakeWebContents(1);
      this.closed = false;
    }

    async loadURL() {
      throw new Error('load failed');
    }

    isDestroyed() {
      return this.closed;
    }

    close() {
      this.closed = true;
      this.emit('closed');
    }
  }

  return FailingBrowserWindow;
};

test('normalizes valid X live URLs and handles', () => {
  assert.equal(normalizeXLiveUrl(' https://x.com/i/broadcasts/1 '), 'https://x.com/i/broadcasts/1');
  assert.equal(normalizeXLiveUrl('https://twitter.com/user/status/1'), 'https://twitter.com/user/status/1');
  assert.equal(normalizeXLiveUrl('@chooserich'), 'https://x.com/chooserich/livechat');
  assert.equal(normalizeXLiveUrl('chooserich'), 'https://x.com/chooserich/livechat');
});

test('creates X live chat URLs from handles', () => {
  assert.equal(createXLiveChatUrlFromHandle('@chooserich'), 'https://x.com/chooserich/livechat');
  assert.equal(createXLiveChatUrlFromHandle('chooserich'), 'https://x.com/chooserich/livechat');
  assert.equal(createXLiveChatUrlFromHandle('not a handle'), undefined);
});

test('uses the broadcast chat URL for X capture windows', () => {
  assert.equal(
    createXCaptureUrl('https://x.com/i/broadcasts/1'),
    'https://x.com/i/broadcasts/1/chat',
  );
  assert.equal(
    createXCaptureUrl('https://x.com/i/broadcasts/1/chat'),
    'https://x.com/i/broadcasts/1/chat',
  );
  assert.equal(createXCaptureUrl('@chooserich'), 'https://x.com/chooserich/livechat');
});

test('rejects non-X live URLs', () => {
  assert.throws(() => normalizeXLiveUrl('https://example.com/live'), /x.com/);
});

test('normalizes X send text', () => {
  assert.equal(normalizeXSendText(' hello x '), 'hello x');
  assert.throws(() => normalizeXSendText('  '), /required/);
});

test('builds an X send script with escaped message text', () => {
  const script = createXSendMessageScript('hello "x"');

  assert.match(script, /hello \\"x\\"/);
  assert.match(script, /X chat composer/);
});

test('loads the X capture window and emits IPC messages', async () => {
  const ipcMainImpl = new FakeIpcMain();
  const BrowserWindow = createFakeBrowserWindowClass();
  const connector = createXConnector({
    liveUrl: 'https://x.com/i/broadcasts/1',
    BrowserWindow,
    ipcMainImpl,
  });
  const received = [];
  const unsubscribe = connector.onMessage((message) => received.push(message));

  await connector.connect();
  const captureWindow = BrowserWindow.instances[0];
  ipcMainImpl.emit('x-capture:message', {
    sender: { id: captureWindow.webContents.id },
  }, {
    authorName: 'Ana',
    username: '@ana',
    text: 'hello x',
    timestamp: '2026-06-04T20:00:00.000Z',
  });

  assert.equal(connector.liveUrl, 'https://x.com/i/broadcasts/1');
  assert.equal(connector.captureUrl, 'https://x.com/i/broadcasts/1/chat');
  assert.equal(captureWindow.loadedUrl, 'https://x.com/i/broadcasts/1/chat');
  assert.equal(captureWindow.options.width, X_CAPTURE_WINDOW_WIDTH);
  assert.equal(captureWindow.options.height, X_CAPTURE_WINDOW_HEIGHT);
  assert.equal(captureWindow.options.x, X_CAPTURE_OFFSCREEN_POSITION);
  assert.equal(captureWindow.options.y, X_CAPTURE_OFFSCREEN_POSITION);
  assert.equal(captureWindow.options.show, false);
  assert.equal(captureWindow.options.skipTaskbar, true);
  assert.equal(captureWindow.options.focusable, false);
  assert.equal(captureWindow.options.webPreferences.backgroundThrottling, false);
  assert.equal(captureWindow.shownInactive, true);
  assert.equal(received.length, 1);
  assert.equal(received[0].platform, 'x');
  assert.equal(received[0].text, 'hello x');

  unsubscribe();
  await connector.disconnect();
});

test('shows the X capture window normally when requested', async () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const connector = createXConnector({
    liveUrl: '@chooserich',
    BrowserWindow,
    ipcMainImpl: new FakeIpcMain(),
    show: true,
  });

  await connector.connect();
  const captureWindow = BrowserWindow.instances[0];

  assert.equal(connector.liveUrl, 'https://x.com/chooserich/livechat');
  assert.equal(captureWindow.options.x, undefined);
  assert.equal(captureWindow.options.y, undefined);
  assert.equal(captureWindow.options.skipTaskbar, false);
  assert.equal(captureWindow.options.focusable, true);
  assert.equal(captureWindow.shown, true);
  assert.equal(captureWindow.shownInactive, false);

  await connector.disconnect();
});

test('sends X chat messages through the capture composer', async () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const connector = createXConnector({
    liveUrl: '@chooserich',
    BrowserWindow,
    ipcMainImpl: new FakeIpcMain(),
  });

  await connector.connect();
  await connector.send(' hello x ');

  const captureWindow = BrowserWindow.instances[0];

  assert.equal(captureWindow.webContents.executedScripts.length, 1);
  assert.match(captureWindow.webContents.executedScripts[0], /hello x/);

  await connector.disconnect();
});

test('surfaces missing X composer as a permission-oriented error', async () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const connector = createXConnector({
    liveUrl: '@chooserich',
    BrowserWindow,
    ipcMainImpl: new FakeIpcMain(),
  });

  await connector.connect();
  BrowserWindow.instances[0].webContents.executeResult = {
    ok: false,
    code: X_COMPOSER_UNAVAILABLE_CODE,
    error: X_COMPOSER_UNAVAILABLE_MESSAGE,
  };

  await assert.rejects(
    () => connector.send('hello x'),
    (error) =>
      isXComposerUnavailableError(error) &&
      error.message === X_COMPOSER_UNAVAILABLE_MESSAGE,
  );
  await connector.disconnect();
});

test('surfaces X composer send failures', async () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const connector = createXConnector({
    liveUrl: '@chooserich',
    BrowserWindow,
    ipcMainImpl: new FakeIpcMain(),
  });

  await connector.connect();
  BrowserWindow.instances[0].webContents.executeResult = {
    ok: false,
    error: 'X send button was not found or is disabled.',
  };

  await assert.rejects(() => connector.send('hello x'), /send button/);
  await connector.disconnect();
});

test('reports X load failures without rejecting connect', async () => {
  const connector = createXConnector({
    liveUrl: 'https://x.com/i/broadcasts/1',
    BrowserWindow: createFailingBrowserWindowClass(),
    ipcMainImpl: new FakeIpcMain(),
  });
  const errors = [];
  const unsubscribe = connector.onError((error) => errors.push(error));

  await connector.connect();

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /load failed/);

  unsubscribe();
  await connector.disconnect();
});
