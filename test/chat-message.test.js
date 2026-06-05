const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeChatMessage } = require('../src/chat-message');

test('normalizes a canonical chat message', () => {
  const message = normalizeChatMessage({
    id: '1',
    platform: 'twitch',
    author: { id: 'author-1', name: 'Ana' },
    text: 'Test message',
    timestamp: '2026-06-04T20:00:00.000Z',
  });

  assert.deepEqual(message, {
    id: '1',
    platform: 'twitch',
    author: { id: 'author-1', name: 'Ana', avatarUrl: undefined, badges: [] },
    text: 'Test message',
    timestamp: '2026-06-04T20:00:00.000Z',
    avatarUrl: undefined,
    raw: null,
  });
});

test('normalizes author badges', () => {
  const message = normalizeChatMessage({
    id: '1',
    platform: 'twitch',
    author: {
      id: 'author-1',
      name: 'Ana',
      badges: [
        {
          id: 'moderator',
          label: 'Mod',
          version: '1',
          imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/mod/2',
        },
      ],
    },
    text: 'Test message',
    timestamp: '2026-06-04T20:00:00.000Z',
  });

  assert.deepEqual(message.author.badges, [
    {
      id: 'moderator',
      label: 'Mod',
      version: '1',
      imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/mod/2',
    },
  ]);
});

test('rejects a message without text', () => {
  assert.throws(
    () =>
      normalizeChatMessage({
        id: '1',
        platform: 'twitch',
        author: { id: 'author-1', name: 'Ana' },
        timestamp: '2026-06-04T20:00:00.000Z',
      }),
    /text/,
  );
});
