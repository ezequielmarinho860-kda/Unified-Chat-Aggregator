const assert = require('node:assert/strict');
const test = require('node:test');
const { createMockConnector } = require('../src/connectors/mock-connector');

test('emits a canonical local echo when send is called', async () => {
  const connector = createMockConnector({ intervalMs: 60_000 });
  const received = [];
  const unsubscribe = connector.onMessage((message) => received.push(message));

  await connector.send('ola');

  assert.equal(received.length, 1);
  assert.equal(received[0].platform, 'mock');
  assert.equal(received[0].text, '[eco local] ola');

  unsubscribe();
  await connector.disconnect();
});
