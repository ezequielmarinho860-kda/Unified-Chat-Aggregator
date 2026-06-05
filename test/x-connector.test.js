const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const {
  createXConnector,
  normalizeXLiveUrl,
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

test('normalizes valid X live URLs', () => {
  assert.equal(normalizeXLiveUrl(' https://x.com/i/broadcasts/1 '), 'https://x.com/i/broadcasts/1');
  assert.equal(normalizeXLiveUrl('https://twitter.com/user/status/1'), 'https://twitter.com/user/status/1');
});

test('rejects non-X live URLs', () => {
  assert.throws(() => normalizeXLiveUrl('https://example.com/live'), /x.com/);
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

  assert.equal(captureWindow.loadedUrl, 'https://x.com/i/broadcasts/1');
  assert.equal(received.length, 1);
  assert.equal(received[0].platform, 'x');
  assert.equal(received[0].text, 'hello x');

  unsubscribe();
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
