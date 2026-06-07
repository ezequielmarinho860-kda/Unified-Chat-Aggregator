const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const { WebSocket } = require('ws');
const { createHttpGateway, GATEWAY_HOST } = require('../src/gateway/http-gateway');

test('serves the public snapshot on the versioned read-only endpoint', async () => {
  const snapshot = { protocolVersion: '1', statuses: [], viewers: { sources: [], total: 0 } };
  const gateway = createHttpGateway({ getSnapshot: () => snapshot, port: 0 });

  try {
    const address = await gateway.start();
    const response = await fetch(address.snapshotUrl);

    assert.equal(address.host, GATEWAY_HOST);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(await response.json(), snapshot);
  } finally {
    await gateway.stop();
  }
});

test('serves the browser-native viewer mode shell and assets', async () => {
  const gateway = createHttpGateway({ getSnapshot: () => ({}), port: 0 });

  try {
    const address = await gateway.start();
    const viewerResponse = await fetch(address.viewerUrl);
    const scriptResponse = await fetch(`http://${address.host}:${address.port}/viewer/viewer-mode.js`);
    const styleResponse = await fetch(`http://${address.host}:${address.port}/viewer/viewer-mode.css`);
    const html = await viewerResponse.text();
    const script = await scriptResponse.text();

    assert.equal(viewerResponse.status, 200);
    assert.match(viewerResponse.headers.get('content-type'), /^text\/html/);
    assert.match(html, /Viewer Mode/);
    assert.match(html, /data-viewer-updated/);
    assert.match(html, /data-chat-list/);
    assert.doesNotMatch(html, /window\.chatAggregator/);
    assert.equal(scriptResponse.status, 200);
    assert.match(scriptResponse.headers.get('content-type'), /^text\/javascript/);
    assert.match(script, /new WebSocket/);
    assert.match(script, /chat\.message/);
    assert.match(script, /viewers\.update/);
    assert.match(script, /source-viewer-state/);
    assert.match(script, /MAX_MESSAGES/);
    assert.doesNotMatch(script, /window\.chatAggregator/);
    assert.equal(styleResponse.status, 200);
    assert.match(styleResponse.headers.get('content-type'), /^text\/css/);
  } finally {
    await gateway.stop();
  }
});

test('rejects write methods and unknown routes', async () => {
  const gateway = createHttpGateway({ getSnapshot: () => ({}), port: 0 });

  try {
    const address = await gateway.start();
    const writeResponse = await fetch(address.snapshotUrl, { method: 'POST' });
    const viewerWriteResponse = await fetch(address.viewerUrl, { method: 'POST' });
    const missingResponse = await fetch(`http://${address.host}:${address.port}/api/v1/missing`);

    assert.equal(writeResponse.status, 405);
    assert.equal(writeResponse.headers.get('allow'), 'GET');
    assert.equal(viewerWriteResponse.status, 405);
    assert.equal(viewerWriteResponse.headers.get('allow'), 'GET');
    assert.equal(missingResponse.status, 404);
  } finally {
    await gateway.stop();
  }
});

test('does not expose snapshot errors', async () => {
  const gateway = createHttpGateway({
    getSnapshot: () => {
      throw new Error('secret token failed');
    },
    port: 0,
  });

  try {
    const address = await gateway.start();
    const response = await fetch(address.snapshotUrl);
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, { error: 'Snapshot unavailable.' });
    assert.doesNotMatch(JSON.stringify(body), /secret|token/);
  } finally {
    await gateway.stop();
  }
});

test('starts once and stops idempotently', async () => {
  const gateway = createHttpGateway({ getSnapshot: () => ({}), port: 0 });
  const firstAddress = await gateway.start();
  const secondAddress = await gateway.start();

  assert.deepEqual(secondAddress, firstAddress);

  await gateway.stop();
  await gateway.stop();
  assert.equal(gateway.getAddress(), undefined);
});

test('rejects invalid configured ports', () => {
  assert.throws(
    () => createHttpGateway({ getSnapshot: () => ({}), port: 'invalid' }),
    /port must be an integer/,
  );
});

test('sends an initial snapshot and publishes realtime events', async () => {
  const snapshot = { protocolVersion: '1', statuses: [], viewers: { sources: [], total: 0 } };
  const gateway = createHttpGateway({ getSnapshot: () => snapshot, port: 0 });
  let client;

  try {
    const address = await gateway.start();
    client = new WebSocket(address.eventsUrl);
    const [initialPayload] = await once(client, 'message');
    const initialEvent = JSON.parse(initialPayload.toString());

    assert.equal(initialEvent.type, 'snapshot.replace');
    assert.deepEqual(initialEvent.data, snapshot);

    const nextMessage = once(client, 'message');
    assert.equal(gateway.publish('viewers.update', { total: 42 }), 1);

    const [updatePayload] = await nextMessage;
    const updateEvent = JSON.parse(updatePayload.toString());

    assert.equal(updateEvent.type, 'viewers.update');
    assert.deepEqual(updateEvent.data, { total: 42 });
    assert.match(updateEvent.eventId, /.+/);
    assert.match(updateEvent.emittedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    client?.close();
    await gateway.stop();
  }
});

test('returns zero when publishing without connected clients', async () => {
  const gateway = createHttpGateway({ getSnapshot: () => ({}), port: 0 });

  try {
    await gateway.start();
    assert.equal(gateway.publish('viewers.update', { total: 0 }), 0);
  } finally {
    await gateway.stop();
  }
});

test('rejects browser websocket connections from external origins', async () => {
  const gateway = createHttpGateway({ getSnapshot: () => ({}), port: 0 });

  try {
    const address = await gateway.start();
    const client = new WebSocket(address.eventsUrl, {
      origin: 'https://external.example',
    });
    const [error] = await once(client, 'error');

    assert.match(error.message, /Unexpected server response: 403/);
  } finally {
    await gateway.stop();
  }
});
