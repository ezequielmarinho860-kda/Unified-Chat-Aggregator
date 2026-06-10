const assert = require('node:assert/strict');
const test = require('node:test');
const {
  extractXNetworkEvents,
  extractXNetworkMessages,
  extractXNetworkViewerCount,
  extractXNetworkViewerCountMatch,
} = require('../src/connectors/x-network-parser');

test('extracts X messages from GraphQL-style payloads', () => {
  const messages = extractXNetworkMessages({
    data: {
      tweetResult: {
        result: {
          rest_id: 'message-1',
          core: {
            user_results: {
              result: {
                legacy: {
                  name: 'Ana',
                  profile_image_url_https: 'https://example.com/ana.jpg',
                  screen_name: 'ana',
                },
              },
            },
          },
          legacy: {
            created_at: 'Thu Jun 04 20:00:00 +0000 2026',
            full_text: 'hello network x',
          },
        },
      },
    },
  });

  assert.deepEqual(messages, [
    {
      authorName: 'Ana',
      avatarUrl: 'https://example.com/ana.jpg',
      id: 'message-1',
      text: 'hello network x',
      timestamp: 'Thu Jun 04 20:00:00 +0000 2026',
      username: 'ana',
    },
  ]);
});

test('extracts X messages from live chat-style payloads', () => {
  const { messages } = extractXNetworkEvents(JSON.stringify({
    entries: [
      {
        id: 'chat-1',
        message: { text: 'gm' },
        sender: {
          displayName: 'Jugger',
          username: '@Jugger_',
          profile_image_url_https: 'https://example.com/jugger.jpg',
        },
        timestamp: '2026-06-09T20:00:00.000Z',
      },
    ],
  }), { url: 'https://x.com/i/api/live/chat' });

  assert.deepEqual(messages, [
    {
      authorName: 'Jugger',
      avatarUrl: 'https://example.com/jugger.jpg',
      id: 'chat-1',
      text: 'gm',
      timestamp: '2026-06-09T20:00:00.000Z',
      username: 'Jugger_',
    },
  ]);
});

test('extracts X reply metadata from live chat-style payloads', () => {
  const { messages } = extractXNetworkEvents(JSON.stringify({
    entries: [
      {
        id: 'chat-2',
        message: {
          text: 'nice one',
          reply: {
            displayName: 'Frosen',
            username: '@Frosen',
            text: 'ello llama',
          },
        },
        sender: {
          displayName: 'YungSp5der',
          username: '@YungSp5der11',
        },
      },
    ],
  }), { url: 'https://x.com/i/api/live/chat' });

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].reply, {
    authorName: 'Frosen',
    text: 'ello llama',
    username: 'Frosen',
  });
});

test('extracts X viewer counts from network payloads', () => {
  assert.equal(extractXNetworkViewerCount({ live: { viewer_count: 1234 } }), 1234);
  assert.equal(extractXNetworkViewerCount({ label: '2.5K watching' }), 2500);
  assert.equal(extractXNetworkViewerCount({ room: { participant_count: 87 } }), 87);
});

test('returns debug metadata for X network viewer count matches', () => {
  assert.deepEqual(extractXNetworkViewerCountMatch({ live: { viewer_count: 1234 } }), {
    count: 1234,
    key: 'viewer_count',
    source: 'network-number',
    value: 1234,
  });
});

test('ignores X participant index fields as viewer counts', () => {
  assert.equal(
    extractXNetworkViewerCount({
      room: { participant_index: 595731339 },
    }),
    undefined,
  );
});

test('ignores unrelated non-X payloads by URL', () => {
  assert.deepEqual(
    extractXNetworkEvents(
      { message: { text: 'not x' }, sender: { displayName: 'Ana', username: 'ana' } },
      { url: 'https://example.com/graphql' },
    ),
    { messages: [], viewerCount: undefined },
  );
});

test('extracts X broadcast events from Periscope transport payloads', () => {
  const { messages, viewerCount } = extractXNetworkEvents(JSON.stringify({
    payload: JSON.stringify({
      body: 'from pscp',
      participant: {
        display_name: 'Emblem Vault',
        username: '@EmblemVault',
      },
      room: {
        participant_count: 16185,
      },
    }),
  }), { url: 'https://chatman-replay.pscp.tv/chatapi/v1/chatnow' });

  assert.equal(viewerCount, 16185);
  assert.deepEqual(messages, [
    {
      authorName: 'Emblem Vault',
      avatarUrl: undefined,
      id: undefined,
      text: 'from pscp',
      timestamp: undefined,
      username: 'EmblemVault',
    },
  ]);
});

test('does not emit raw JSON transport bodies as chat messages', () => {
  const { messages } = extractXNetworkEvents(JSON.stringify({
    body: JSON.stringify({
      body: 'Ronaldo vini and yamal will cook',
      displayName: 'YungSp5der💀🏀',
      timestamp: 1781044647486,
      username: 'YungSp5der11',
      uuid: '069869ac-882a-4aab-84de-d21c17a9cb3a',
    }),
    displayName: 'YungSp5der💀🏀',
    username: 'YungSp5der11',
  }), { url: 'https://chatman-replay.pscp.tv/chatapi/v1/chatnow' });

  assert.deepEqual(messages, [
    {
      authorName: 'YungSp5der💀🏀',
      avatarUrl: undefined,
      id: '069869ac-882a-4aab-84de-d21c17a9cb3a',
      text: 'Ronaldo vini and yamal will cook',
      timestamp: '1781044647486',
      username: 'YungSp5der11',
    },
  ]);
});

test('extracts X broadcast events from SSE-style data lines', () => {
  const { messages } = extractXNetworkEvents(
    'data: {"message":{"text":"from sse"},"sender":{"displayName":"Ana","username":"ana"}}',
    { url: 'https://x.com/i/api/live/chat' },
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'from sse');
});
