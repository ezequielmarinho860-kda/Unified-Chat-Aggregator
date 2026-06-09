const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createEmptySnapshot,
  startStandaloneBrowserBackend,
} = require('../src/browser-backend/cli');
const { createBrowserBackendClient } = require('../src/browser-backend/client');

const createTempDataDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'uca-browser-backend-cli-'));

test('creates a standalone empty browser backend snapshot', () => {
  const snapshot = createEmptySnapshot();

  assert.equal(snapshot.protocolVersion, '1');
  assert.equal(snapshot.manifest.title, 'Unified Chat Aggregator');
  assert.deepEqual(snapshot.statuses, []);
  assert.deepEqual(snapshot.viewers, { sources: [], total: 0 });
});

test('starts and stops the standalone browser backend cli controller', async () => {
  const dataDir = createTempDataDir();
  const logs = [];
  const controller = await startStandaloneBrowserBackend({
    env: {
      APP_INGEST_TOKEN: 'app-token',
      BROWSER_BACKEND_DATA_DIR: dataDir,
      BROWSER_BACKEND_PORT: '0',
    },
    stdout: (message) => logs.push(message),
  });

  try {
    const response = await fetch(controller.address.snapshotUrl);
    const snapshot = await response.json();

    assert.equal(response.status, 200);
    assert.equal(snapshot.manifest.title, 'Unified Chat Aggregator');
    assert.equal(controller.config.dataDir, dataDir);
    assert.match(logs[0], /Browser backend listening/);
    assert.match(logs[1], /Browser backend data directory/);

    const client = createBrowserBackendClient({
      appIngestToken: 'app-token',
      baseUrl: controller.address.viewerUrl,
    });

    assert.deepEqual(
      await client.publishAppEvent({ data: { sources: [], total: 18 }, type: 'viewers.update' }),
      { accepted: true, published: 0 },
    );
    assert.equal((await client.loadSnapshot()).viewers.total, 18);
  } finally {
    await controller.stop();
  }
});

test('bridges app ingestion and browser local chat through standalone backend', async () => {
  const controller = await startStandaloneBrowserBackend({
    env: {
      APP_INGEST_TOKEN: 'app-token',
      BROWSER_BACKEND_DATA_DIR: createTempDataDir(),
      BROWSER_BACKEND_PORT: '0',
    },
    stdout: () => {},
  });
  let connection;

  try {
    const client = createBrowserBackendClient({
      appIngestToken: 'app-token',
      baseUrl: controller.address.viewerUrl,
    });
    const events = [];
    const opened = new Promise((resolve) => {
      connection = client.connectEvents({
        onEvent: (event) => events.push(event),
        onOpen: resolve,
      });
    });

    await opened;
    await waitFor(() => events.some((event) => event.type === 'snapshot.replace'));

    await client.publishAppEvent({
      data: {
        sources: [{
          channelLabel: 'Streamer',
          platform: 'twitch',
          sourceId: 'twitch:streamer',
        }],
        title: 'External Bridge',
      },
      type: 'manifest.update',
    });
    await client.publishAppEvent({
      data: {
        source: {
          channelLabel: 'Streamer',
          platform: 'twitch',
          sourceId: 'twitch:streamer',
        },
        state: 'connected',
        messageCount: 1,
        updatedAt: '2026-06-09T12:00:00.000Z',
      },
      type: 'source.status',
    });
    await client.publishAppEvent({
      data: {
        sources: [{
          count: 42,
          source: {
            channelLabel: 'Streamer',
            platform: 'twitch',
            sourceId: 'twitch:streamer',
          },
          state: 'available',
          updatedAt: '2026-06-09T12:00:00.000Z',
        }],
        total: 42,
      },
      type: 'viewers.update',
    });
    await client.publishAppEvent({
      data: {
        id: 'external-message-1',
        source: {
          channelLabel: 'Streamer',
          platform: 'twitch',
          sourceId: 'twitch:streamer',
        },
        author: { id: 'author-1', name: 'ViewerOne', badges: [] },
        text: 'hello from twitch',
        timestamp: '2026-06-09T12:00:01.000Z',
      },
      type: 'chat.message',
    });

    const registerResult = await client.registerLocalUser({
      email: 'ana@example.com',
      nick: 'ana',
    });

    await client.sendLocalMessage({
      text: 'hello from local',
      token: registerResult.session.token,
    });

    await waitFor(() =>
      events.some((event) => event.type === 'chat.message' && event.data.id === 'external-message-1') &&
      events.some((event) => event.type === 'chat.message' && event.data.source?.platform === 'local'));

    const snapshot = await client.loadSnapshot();
    const externalMessageEvent = events.find(
      (event) => event.type === 'chat.message' && event.data.id === 'external-message-1',
    );
    const localMessageEvent = events.find(
      (event) => event.type === 'chat.message' && event.data.source?.platform === 'local',
    );

    assert.equal(snapshot.manifest.title, 'External Bridge');
    assert.equal(snapshot.statuses[0].source.sourceId, 'twitch:streamer');
    assert.equal(snapshot.statuses[0].state, 'connected');
    assert.equal(snapshot.viewers.total, 42);
    assert.equal(externalMessageEvent.data.text, 'hello from twitch');
    assert.equal(localMessageEvent.data.author.name, 'ana');
    assert.equal(localMessageEvent.data.text, 'hello from local');
  } finally {
    connection?.close();
    await controller.stop();
  }
});

test('keeps browser backend online for local chat after app event connection closes', async () => {
  const controller = await startStandaloneBrowserBackend({
    env: {
      APP_INGEST_TOKEN: 'app-token',
      BROWSER_BACKEND_DATA_DIR: createTempDataDir(),
      BROWSER_BACKEND_PORT: '0',
    },
    stdout: () => {},
  });
  let appConnection;

  try {
    const appClient = createBrowserBackendClient({
      appIngestToken: 'app-token',
      baseUrl: controller.address.viewerUrl,
    });
    const viewerClient = createBrowserBackendClient({
      baseUrl: controller.address.viewerUrl,
    });
    const opened = new Promise((resolve) => {
      appConnection = appClient.connectEvents({ onOpen: resolve });
    });

    await opened;
    await appClient.publishAppEvent({
      data: { sources: [], total: 9 },
      type: 'viewers.update',
    });
    appConnection.close();
    appConnection = undefined;

    const registerResult = await viewerClient.registerLocalUser({
      email: 'viewer@example.com',
      nick: 'viewer',
    });
    const messageResult = await viewerClient.sendLocalMessage({
      text: 'still online',
      token: registerResult.session.token,
    });
    const snapshot = await viewerClient.loadSnapshot();

    assert.equal(messageResult.message.source.platform, 'local');
    assert.equal(messageResult.message.text, 'still online');
    assert.equal(snapshot.viewers.total, 9);
  } finally {
    appConnection?.close();
    await controller.stop();
  }
});

const waitFor = async (predicate) => {
  const expiresAt = Date.now() + 1_000;

  while (Date.now() < expiresAt) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error('Timed out waiting for condition.');
};
