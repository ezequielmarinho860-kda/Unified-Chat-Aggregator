const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeChatMessage } = require('../src/chat-message');

test('normalizes a canonical chat message', () => {
  const message = normalizeChatMessage({
    id: '1',
    platform: 'mock',
    author: { id: 'author-1', name: 'Ana' },
    text: 'Test message',
    timestamp: '2026-06-04T20:00:00.000Z',
  });

  assert.deepEqual(message, {
    id: '1',
    platform: 'mock',
    author: { id: 'author-1', name: 'Ana', avatarUrl: undefined },
    text: 'Test message',
    timestamp: '2026-06-04T20:00:00.000Z',
    avatarUrl: undefined,
    raw: null,
  });
});

test('rejects a message without text', () => {
  assert.throws(
    () =>
      normalizeChatMessage({
        id: '1',
        platform: 'mock',
        author: { id: 'author-1', name: 'Ana' },
        timestamp: '2026-06-04T20:00:00.000Z',
      }),
    /text/,
  );
});
