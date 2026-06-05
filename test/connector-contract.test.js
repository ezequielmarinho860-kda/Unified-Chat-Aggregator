const assert = require('node:assert/strict');
const test = require('node:test');
const { validateConnector } = require('../src/connectors/connector-contract');

test('accepts a connector with the required contract', () => {
  const connector = {
    platform: 'twitch',
    connect: async () => {},
    disconnect: async () => {},
    send: async (_text) => {},
  };

  assert.equal(validateConnector(connector), connector);
});

test('rejects a connector without send()', () => {
  const connector = {
    platform: 'twitch',
    connect: async () => {},
    disconnect: async () => {},
  };

  assert.throws(() => validateConnector(connector), /send/);
});
