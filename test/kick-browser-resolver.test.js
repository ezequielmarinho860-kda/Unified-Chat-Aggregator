const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildKickChannelFetchScript,
  normalizeResolvedKickPayload,
  resolveKickChannelInBrowser,
  resolveKickChannelWithBrowserFallback,
} = require('../src/connectors/kick-browser-resolver');

const createFakeBrowserWindow = (payload) => {
  const instances = [];

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.closed = false;
      this.webContents = {
        executeJavaScript: async (script) => {
          this.script = script;
          return payload;
        },
      };
      instances.push(this);
    }

    async loadURL(url) {
      this.url = url;
    }

    isDestroyed() {
      return this.closed;
    }

    close() {
      this.closed = true;
    }
  }

  return { BrowserWindow: FakeBrowserWindow, instances };
};

const createJsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});

test('normalizes Kick browser resolver payload', () => {
  const resolved = normalizeResolvedKickPayload('xqc', {
    id: 605185,
    chatroom: { id: 12345 },
  });

  assert.deepEqual(resolved, {
    channel: 'xqc',
    channelId: '605185',
    chatroomId: '12345',
  });
});

test('builds browser fetch script for Kick channel endpoint', () => {
  const script = buildKickChannelFetchScript('xqc');

  assert.match(script, /https:\/\/kick\.com\/api\/v2\/channels\/xqc/);
  assert.match(script, /credentials: 'include'/);
});

test('resolves Kick chatroom through BrowserWindow and closes it', async () => {
  const { BrowserWindow, instances } = createFakeBrowserWindow({
    id: 605185,
    chatroom: { id: 12345 },
  });

  const resolved = await resolveKickChannelInBrowser({
    channel: 'https://kick.com/XQC',
    BrowserWindow,
  });

  assert.equal(resolved.channel, 'xqc');
  assert.equal(resolved.chatroomId, '12345');
  assert.equal(instances[0].url, 'https://kick.com/xqc');
  assert.equal(instances[0].options.show, false);
  assert.equal(instances[0].closed, true);
});

test('uses HTTP resolver before browser fallback', async () => {
  const { BrowserWindow, instances } = createFakeBrowserWindow({
    id: 605185,
    chatroom: { id: 12345 },
  });

  const resolved = await resolveKickChannelWithBrowserFallback({
    channel: 'xqc',
    BrowserWindow,
    fetchImpl: async () =>
      createJsonResponse({
        id: 605185,
        chatroom: { id: 999 },
      }),
  });

  assert.equal(resolved.chatroomId, '999');
  assert.equal(instances.length, 0);
});

test('falls back to BrowserWindow when HTTP resolver is blocked', async () => {
  const { BrowserWindow, instances } = createFakeBrowserWindow({
    id: 605185,
    chatroom: { id: 12345 },
  });

  const resolved = await resolveKickChannelWithBrowserFallback({
    channel: 'xqc',
    BrowserWindow,
    fetchImpl: async () => createJsonResponse({}, { ok: false, status: 403 }),
  });

  assert.equal(resolved.chatroomId, '12345');
  assert.equal(instances.length, 1);
});
