const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeXMessage } = require('../src/connectors/x-message-parser');

test('normalizes X capture payloads into canonical chat messages', () => {
  const message = normalizeXMessage({
    authorName: 'Ana',
    username: '@ana',
    text: 'hello x',
    avatarUrl: 'https://example.com/avatar.jpg',
    timestamp: '2026-06-04T20:00:00.000Z',
  });

  assert.equal(message.platform, 'x');
  assert.equal(message.author.id, 'ana');
  assert.equal(message.author.name, 'Ana');
  assert.equal(message.author.avatarUrl, 'https://example.com/avatar.jpg');
  assert.equal(message.text, 'hello x');
  assert.equal(message.timestamp, '2026-06-04T20:00:00.000Z');
});

test('rejects X payloads without text', () => {
  assert.throws(
    () =>
      normalizeXMessage({
        authorName: 'Ana',
        username: '@ana',
      }),
    /text/,
  );
});
