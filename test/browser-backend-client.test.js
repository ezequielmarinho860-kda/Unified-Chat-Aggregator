const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createBrowserBackendClient } = require('../src/browser-backend/client');
const { createBrowserBackendRuntime } = require('../src/browser-backend/runtime');

const createTempDataDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'uca-browser-backend-client-'));

const createJsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  json: async () => body,
  ok,
  status,
});

test('loads snapshots and uses local chat endpoints through the backend client', async () => {
  const snapshot = { protocolVersion: '1', statuses: [], viewers: { sources: [], total: 0 } };
  const runtime = createBrowserBackendRuntime({
    dataDir: createTempDataDir(),
    env: {},
    getSnapshot: () => snapshot,
    port: 0,
  });

  try {
    const address = await runtime.start();
    const client = createBrowserBackendClient({ baseUrl: address.viewerUrl });
    const loadedSnapshot = await client.loadSnapshot();
    const registerResult = await client.registerLocalUser({
      email: 'mod@example.com',
      nick: 'ModUser',
    });
    runtime.localChatStore.addModerator({ email: 'mod@example.com' });

    const sessionResult = await client.getLocalSession(registerResult.session.token);
    const commandsResult = await client.getLocalModerationCommands();
    const messageResult = await client.sendLocalMessage({
      text: 'hello @ModUser',
      token: registerResult.session.token,
    });
    const moderationResult = await client.runLocalModerationCommand({
      command: '/mod ModUser',
      token: registerResult.session.token,
    });

    assert.deepEqual(loadedSnapshot, snapshot);
    assert.equal(registerResult.user.nick, 'ModUser');
    assert.equal(sessionResult.user.email, 'mod@example.com');
    assert(commandsResult.commands.some((command) => command.name === '/ban'));
    assert.equal(messageResult.message.text, 'hello @ModUser');
    assert.deepEqual(messageResult.message.fragments, [
      { type: 'text', text: 'hello ' },
      { type: 'mention', text: '@ModUser' },
    ]);
    assert.equal(moderationResult.moderation.action, 'mod');
  } finally {
    await runtime.stop();
  }
});

test('receives backend realtime events through the backend client', async () => {
  const runtime = createBrowserBackendRuntime({
    dataDir: createTempDataDir(),
    env: {},
    getSnapshot: () => ({ protocolVersion: '1', statuses: [], viewers: { sources: [], total: 0 } }),
    port: 0,
  });
  let connection;

  try {
    const address = await runtime.start();
    const client = createBrowserBackendClient({ baseUrl: address.viewerUrl });
    const events = [];
    const opened = new Promise((resolve) => {
      connection = client.connectEvents({
        onEvent: (event) => events.push(event),
        onOpen: resolve,
      });
    });

    await opened;
    await waitFor(() => events.length === 1);

    runtime.publish('viewers.update', { sources: [], total: 7 });
    await waitFor(() => events.length === 2);

    assert.equal(events[0].type, 'snapshot.replace');
    assert.equal(events[1].type, 'viewers.update');
    assert.deepEqual(events[1].data, { sources: [], total: 7 });
  } finally {
    connection?.close();
    await runtime.stop();
  }
});

test('receives local chat messages sent through the backend client', async () => {
  const runtime = createBrowserBackendRuntime({
    dataDir: createTempDataDir(),
    env: {},
    getSnapshot: () => ({ protocolVersion: '1', statuses: [], viewers: { sources: [], total: 0 } }),
    port: 0,
  });
  let connection;

  try {
    const address = await runtime.start();
    const client = createBrowserBackendClient({ baseUrl: address.viewerUrl });
    const registerResult = await client.registerLocalUser({
      email: 'ana@example.com',
      nick: 'Ana',
    });
    const events = [];
    const opened = new Promise((resolve) => {
      connection = client.connectEvents({
        onEvent: (event) => events.push(event),
        onOpen: resolve,
      });
    });

    await opened;
    await waitFor(() => events.length === 1);
    await client.sendLocalMessage({
      text: 'hello app',
      token: registerResult.session.token,
    });
    await waitFor(() => events.some((event) => event.type === 'chat.message'));

    const messageEvent = events.find((event) => event.type === 'chat.message');

    assert.equal(messageEvent.data.source.platform, 'local');
    assert.equal(messageEvent.data.author.name, 'Ana');
    assert.equal(messageEvent.data.text, 'hello app');
  } finally {
    connection?.close();
    await runtime.stop();
  }
});

test('builds backend client OAuth and app ingestion requests', async () => {
  const requests = [];
  const client = createBrowserBackendClient({
    appIngestToken: 'app-token',
    baseUrl: 'http://127.0.0.1:47831/viewer',
    fetchImpl: async (url, options = {}) => {
      requests.push({ options, url: url.toString() });
      return createJsonResponse({ ok: true });
    },
  });

  assert.equal(
    client.createGoogleOAuthStartUrl({ returnTo: '/viewer?debugChat=1' }),
    'http://127.0.0.1:47831/api/v1/auth/google/start?returnTo=%2Fviewer%3FdebugChat%3D1',
  );

  await client.publishAppEvent({ type: 'chat.message', data: { id: 'message-1' } });

  assert.equal(requests[0].url, 'http://127.0.0.1:47831/api/v1/app/events');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer app-token');
  assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
  assert.equal(requests[0].options.body, JSON.stringify({ type: 'chat.message', data: { id: 'message-1' } }));
});

test('surfaces backend client JSON errors', async () => {
  const client = createBrowserBackendClient({
    baseUrl: 'http://127.0.0.1:47831',
    fetchImpl: async () => createJsonResponse({ error: 'blocked' }, { ok: false, status: 403 }),
  });

  await assert.rejects(
    () => client.loadSnapshot(),
    /blocked/,
  );
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
