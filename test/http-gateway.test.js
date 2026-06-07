const assert = require('node:assert/strict');
const test = require('node:test');
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

test('rejects write methods and unknown routes', async () => {
  const gateway = createHttpGateway({ getSnapshot: () => ({}), port: 0 });

  try {
    const address = await gateway.start();
    const writeResponse = await fetch(address.snapshotUrl, { method: 'POST' });
    const missingResponse = await fetch(`http://${address.host}:${address.port}/api/v1/missing`);

    assert.equal(writeResponse.status, 405);
    assert.equal(writeResponse.headers.get('allow'), 'GET');
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
