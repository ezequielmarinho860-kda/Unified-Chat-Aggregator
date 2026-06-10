const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const {
  attachXNetworkCapture,
  createXCaptureUrl,
  createXConnector,
  createXDebugCaptureContextScript,
  createXLiveChatUrlFromHandle,
  createXResolveMessageContextScript,
  createXSendMessageScript,
  isXComposerUnavailableError,
  normalizeXLiveUrl,
  normalizeXSendText,
  rankXHandleCandidates,
  scoreXHandleCandidate,
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
    this.debugger = new FakeDebugger();
    this.executedScripts = [];
    this.executeResult = { ok: true };
  }

  async executeJavaScript(script) {
    this.executedScripts.push(script);
    return this.executeResult;
  }
}

class FakeDebugger extends EventEmitter {
  constructor() {
    super();
    this.attached = false;
    this.commands = [];
    this.responseBodies = new Map();
  }

  attach(version) {
    this.attached = true;
    this.version = version;
  }

  detach() {
    this.attached = false;
  }

  isAttached() {
    return this.attached;
  }

  sendCommand(method, params, callback) {
    this.commands.push({ method, params });

    if (method === 'Network.getResponseBody') {
      callback?.(undefined, this.responseBodies.get(params.requestId) ?? { body: '{}' });
      return;
    }

    callback?.(undefined, {});
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

const waitForMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

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
    'https://x.com/i/broadcasts/1',
  );
  assert.equal(
    createXCaptureUrl('https://x.com/i/broadcasts/1/chat'),
    'https://x.com/i/broadcasts/1',
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

test('builds an X capture debug script for visible handle candidates', () => {
  const script = createXDebugCaptureContextScript();

  assert.match(script, /UserCell/);
  assert.match(script, /candidates/);
  assert.match(script, /getBoundingClientRect/);
  assert.match(script, /href/);
});

test('waits for an avatar before returning X message context when needed', () => {
  const script = createXResolveMessageContextScript({
    authorName: 'Ana',
    needsAvatar: true,
    username: '@ana',
  });

  assert.match(script, /const shouldWaitForAvatar = true/);
  assert.match(script, /isLastAttempt && hasSourceContext/);
  assert.doesNotMatch(script, /if \(avatarUrl \|\| channelLabel \|\| broadcasterName\)/);
});

test('prefers the streamer handle over sidebar navigation handles', () => {
  const sidebarHandle = {
    handle: '@home',
    href: '/home',
    inArticle: false,
    inChatPanel: false,
    inListItem: false,
    isVisible: true,
    rect: {
      height: 50,
      left: 19,
      top: 58,
      width: 50,
    },
    tag: 'a',
    text: '',
    userCell: false,
    userName: false,
    viewport: {
      height: 853,
      width: 1264,
    },
  };
  const streamerHandle = {
    handle: '@Jugguer_',
    href: '/Jugguer_',
    inArticle: true,
    inChatPanel: false,
    inListItem: false,
    isVisible: true,
    rect: {
      height: 21,
      left: 149,
      top: 517,
      width: 71,
    },
    tag: 'a',
    text: '@Jugguer_',
    userCell: true,
    userName: false,
    viewport: {
      height: 853,
      width: 1264,
    },
  };

  assert.ok(scoreXHandleCandidate(streamerHandle) > scoreXHandleCandidate(sidebarHandle));
  assert.equal(rankXHandleCandidates([sidebarHandle, streamerHandle]), '@Jugguer_');
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
  await waitForMicrotasks();

  assert.equal(connector.liveUrl, 'https://x.com/i/broadcasts/1');
  assert.equal(connector.captureUrl, 'https://x.com/i/broadcasts/1');
  assert.equal(captureWindow.loadedUrl, 'https://x.com/i/broadcasts/1');
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

test('enriches X network messages with avatars from the capture page DOM', async () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const connector = createXConnector({
    liveUrl: 'https://x.com/i/broadcasts/1',
    BrowserWindow,
    ipcMainImpl: new FakeIpcMain(),
    source: {
      sourceId: 'x:broadcast-1',
      platform: 'x',
      channelLabel: 'X Live 1',
    },
  });
  const received = [];

  connector.onMessage((message) => received.push(message));
  await connector.connect();
  const captureWindow = BrowserWindow.instances[0];

  captureWindow.webContents.executeResult = {
    avatarUrl: 'https://example.com/ana.jpg',
    broadcasterName: 'Grave',
    channelLabel: '@Jugger_',
  };
  captureWindow.webContents.debugger.emit('message', {}, 'Network.webSocketFrameReceived', {
    response: {
      payloadData: JSON.stringify({
        id: 'network-message-1',
        message: { text: 'from network' },
        sender: { displayName: 'Ana', username: '@ana' },
      }),
      url: 'https://chatman-replay.pscp.tv/chatapi/v1/chatnow',
    },
  });
  await waitForMicrotasks();

  assert.equal(received.length, 1);
  assert.equal(received[0].author.avatarUrl, 'https://example.com/ana.jpg');
  assert.deepEqual(received[0].source, {
    sourceId: 'x:broadcast-1',
    platform: 'x',
    broadcasterName: 'Grave',
    channelLabel: '@Jugger_',
  });
  assert.match(captureWindow.webContents.executedScripts.at(-1), /targetUsername/);

  await connector.disconnect();
});

test('preserves an X channel label when later enrichment only returns a broadcaster name', async () => {
  const BrowserWindow = createFakeBrowserWindowClass();
  const connector = createXConnector({
    liveUrl: 'https://x.com/i/broadcasts/1',
    BrowserWindow,
    ipcMainImpl: new FakeIpcMain(),
    source: {
      sourceId: 'x:broadcast-1',
      platform: 'x',
      channelLabel: '@Jugguer_',
    },
  });
  const received = [];

  connector.onMessage((message) => received.push(message));
  await connector.connect();
  const captureWindow = BrowserWindow.instances[0];

  captureWindow.webContents.executeResult = {
    broadcasterName: 'Grave',
  };
  captureWindow.webContents.debugger.emit('message', {}, 'Network.webSocketFrameReceived', {
    response: {
      payloadData: JSON.stringify({
        id: 'network-message-2',
        message: { text: 'from network 2' },
        sender: { displayName: 'Ana', username: '@ana' },
      }),
      url: 'https://chatman-replay.pscp.tv/chatapi/v1/chatnow',
    },
  });
  await waitForMicrotasks();

  assert.equal(received.length, 1);
  assert.deepEqual(received[0].source, {
    sourceId: 'x:broadcast-1',
    platform: 'x',
    broadcasterName: 'Grave',
    channelLabel: '@Jugguer_',
  });

  await connector.disconnect();
});

test('captures X messages and viewers from network payloads', async () => {
  const webContents = new FakeWebContents(1);
  const messages = [];
  const statuses = [];
  const detach = attachXNetworkCapture(webContents, {
    onMessage: (message) => messages.push(message),
    onStatus: (status) => statuses.push(status),
  });

  webContents.debugger.emit('message', {}, 'Network.webSocketFrameReceived', {
    response: {
      payloadData: JSON.stringify({
        id: 'network-message-1',
        message: { text: 'from network' },
        sender: { displayName: 'Ana', username: '@ana' },
      }),
    },
  });

  webContents.debugger.responseBodies.set('request-1', {
    body: JSON.stringify({ room: { participant_count: 321 } }),
  });
  webContents.debugger.emit('message', {}, 'Network.responseReceived', {
    requestId: 'request-1',
    response: {
      type: 'XHR',
      url: 'https://chatman-replay.pscp.tv/chatapi/v1/chatnow',
    },
  });
  webContents.debugger.emit('message', {}, 'Network.loadingFinished', {
    requestId: 'request-1',
  });
  await Promise.resolve();

  assert.equal(webContents.debugger.attached, true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'from network');
  assert.deepEqual(statuses.at(-1), {
    capture: 'network-observing',
    state: 'observing',
    viewerCount: 321,
  });

  detach();
  assert.equal(webContents.debugger.attached, false);
});

test('maps X websocket URLs before parsing broadcast frames', async () => {
  const webContents = new FakeWebContents(1);
  const messages = [];
  const detach = attachXNetworkCapture(webContents, {
    onMessage: (message) => messages.push(message),
  });

  webContents.debugger.emit('message', {}, 'Network.webSocketCreated', {
    requestId: 'socket-1',
    url: 'wss://chatman-replay.pscp.tv/chatapi/v1/chatnow',
  });
  webContents.debugger.emit('message', {}, 'Network.webSocketFrameReceived', {
    requestId: 'socket-1',
    response: {
      payloadData: JSON.stringify({
        payload: JSON.stringify({
          body: 'from broadcast ws',
          participant: {
            display_name: 'Ana',
            username: '@ana',
          },
        }),
      }),
    },
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'from broadcast ws');

  detach();
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
