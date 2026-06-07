const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PROTOCOL_VERSION,
  createPublicEvent,
  serializePublicChatMessage,
  serializePublicSnapshot,
  serializePublicStatus,
  serializePublicViewers,
} = require('../src/public-realtime');

const sources = {
  twitch: {
    sourceId: 'twitch:monstercat',
    platform: 'twitch',
    channelLabel: 'monstercat',
    watchUrl: 'https://www.twitch.tv/monstercat',
    player: { provider: 'twitch', channel: 'monstercat', clientSecret: 'player-secret' },
    accessToken: 'source-secret',
  },
};

test('creates versioned public event envelopes', () => {
  assert.deepEqual(
    createPublicEvent(
      'viewers.update',
      { total: 42 },
      {
        eventId: 'event-1',
        emittedAt: '2026-06-06T20:00:00.000Z',
      },
    ),
    {
      protocolVersion: PROTOCOL_VERSION,
      type: 'viewers.update',
      eventId: 'event-1',
      emittedAt: '2026-06-06T20:00:00.000Z',
      data: { total: 42 },
    },
  );
});

test('serializes chat messages by allowlist', () => {
  const message = serializePublicChatMessage({
    id: 'message-1',
    platform: 'twitch',
    source: sources.twitch,
    author: {
      id: 'author-1',
      name: 'Ana',
      badges: [{ id: 'mod', label: 'Mod', secret: 'badge-secret' }],
      secret: 'author-secret',
    },
    text: 'Hello',
    timestamp: '2026-06-06T20:00:00.000Z',
    raw: { accessToken: 'raw-secret' },
    accessToken: 'message-secret',
  });

  assert.deepEqual(message, {
    id: 'message-1',
    source: {
      sourceId: 'twitch:monstercat',
      platform: 'twitch',
      channelLabel: 'monstercat',
    },
    author: {
      id: 'author-1',
      name: 'Ana',
      badges: [{ id: 'mod', label: 'Mod' }],
    },
    text: 'Hello',
    timestamp: '2026-06-06T20:00:00.000Z',
  });
  assert.doesNotMatch(JSON.stringify(message), /secret|raw|accessToken/);
});

test('serializes public manifest player config by allowlist', () => {
  const snapshot = serializePublicSnapshot(
    {
      manifest: { title: 'MarketBubble Demo' },
    },
    { sources, generatedAt: '2026-06-06T20:00:00.000Z' },
  );

  assert.deepEqual(snapshot.manifest.sources, [
    {
      sourceId: 'twitch:monstercat',
      platform: 'twitch',
      channelLabel: 'monstercat',
      watchUrl: 'https://www.twitch.tv/monstercat',
      player: { provider: 'twitch', channel: 'monstercat' },
    },
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|accessToken/);
});

test('rejects public chat messages without a source identity', () => {
  assert.throws(
    () =>
      serializePublicChatMessage({
        id: 'message-1',
        author: { id: 'author-1', name: 'Ana' },
        text: 'Hello',
        timestamp: '2026-06-06T20:00:00.000Z',
      }),
    /source is required/,
  );
});

test('serializes statuses without internal details or raw errors', () => {
  const status = serializePublicStatus(
    {
      platform: 'twitch',
      state: 'error',
      messageCount: 5,
      lastMessageAt: '2026-06-06T19:59:00.000Z',
      error: 'token secret failed',
      details: { authenticatedUser: 'private-user', capture: 'internal-selector' },
    },
    { sources, generatedAt: '2026-06-06T20:00:00.000Z' },
  );

  assert.deepEqual(status, {
    source: {
      sourceId: 'twitch:monstercat',
      platform: 'twitch',
      channelLabel: 'monstercat',
    },
    state: 'error',
    messageCount: 5,
    lastMessageAt: '2026-06-06T19:59:00.000Z',
    updatedAt: '2026-06-06T20:00:00.000Z',
  });
  assert.doesNotMatch(JSON.stringify(status), /token|private-user|internal-selector/);
});

test('serializes available viewers and recalculates the public total', () => {
  const viewers = serializePublicViewers(
    {
      platforms: [
        {
          platform: 'twitch',
          state: 'available',
          count: 42,
          updatedAt: '2026-06-06T20:00:00.000Z',
          error: 'internal error',
        },
        { platform: 'x', state: 'available', count: 100 },
      ],
      total: 999,
    },
    { sources },
  );

  assert.equal(viewers.total, 42);
  assert.equal(viewers.sources.length, 1);
  assert.equal(viewers.sources[0].count, 42);
  assert.equal(viewers.sources[0].error, undefined);
});

test('creates a public snapshot without internal runtime fields', () => {
  const snapshot = serializePublicSnapshot(
    {
      manifest: { title: 'MarketBubble Demo', secret: 'manifest-secret' },
      statuses: [{ platform: 'twitch', state: 'connected', details: { accessToken: 'token' } }],
      viewers: {
        platforms: [{ platform: 'twitch', state: 'available', count: 10 }],
      },
      configPath: 'C:\\private\\config.json',
      envOverrides: ['TWITCH_ACCESS_TOKEN'],
      config: { accessToken: 'token' },
    },
    { sources, generatedAt: '2026-06-06T20:00:00.000Z' },
  );

  assert.equal(snapshot.protocolVersion, PROTOCOL_VERSION);
  assert.equal(snapshot.generatedAt, '2026-06-06T20:00:00.000Z');
  assert.equal(snapshot.manifest.title, 'MarketBubble Demo');
  assert.equal(snapshot.statuses.length, 1);
  assert.equal(snapshot.viewers.total, 10);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /configPath|envOverrides|accessToken|manifest-secret|private/,
  );
});
