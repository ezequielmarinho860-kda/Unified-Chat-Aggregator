const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeXMessage } = require('../src/connectors/x-message-parser');

test('normalizes X capture payloads into canonical chat messages', () => {
  const message = normalizeXMessage({
    authorName: 'Ana',
    username: '@ana',
    text: 'hello x',
    avatarUrl: 'https://example.com/avatar.jpg',
    reply: {
      authorName: 'Frosen',
      username: '@Frosen',
      text: 'ello llama',
    },
    source: {
      sourceId: 'x:broadcast-1',
      platform: 'x',
      broadcasterName: 'Grave',
      channelLabel: 'X Live 1',
    },
    timestamp: '2026-06-04T20:00:00.000Z',
  });

  assert.equal(message.platform, 'x');
  assert.equal(message.author.id, 'ana');
  assert.equal(message.author.name, 'Ana');
  assert.equal(message.author.avatarUrl, 'https://example.com/avatar.jpg');
  assert.equal(message.author.profileUrl, 'https://x.com/ana');
  assert.equal(message.text, 'hello x');
  assert.deepEqual(message.reply, {
    authorName: 'Frosen',
    text: 'ello llama',
    username: 'Frosen',
  });
  assert.deepEqual(message.source, {
    sourceId: 'x:broadcast-1',
    platform: 'x',
    broadcasterName: 'Grave',
    channelLabel: 'X Live 1',
  });
  assert.equal(message.timestamp, '2026-06-04T20:00:00.000Z');
});

test('does not invent X profile URLs without a username', () => {
  const message = normalizeXMessage({
    authorName: 'Ana',
    text: 'hello x',
    timestamp: '2026-06-04T20:00:00.000Z',
  });

  assert.equal(message.author.id, 'Ana');
  assert.equal(message.author.profileUrl, undefined);
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
