const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BTTV_CDN_ORIGIN,
  createBttvEmoteCatalog,
  fetchBttvEmoteCatalog,
} = require('../src/connectors/bttv-api');

const createJsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});

test('creates a BetterTTV emote catalog', () => {
  assert.deepEqual(
    createBttvEmoteCatalog([{ id: 'emote-1', code: 'OMEGALUL', animated: true }]),
    {
      OMEGALUL: {
        id: 'emote-1',
        code: 'OMEGALUL',
        imageUrl: `${BTTV_CDN_ORIGIN}/emote-1/2x`,
        animated: true,
      },
    },
  );
});

test('loads BetterTTV global and Twitch channel emotes', async () => {
  const calls = [];
  const catalog = await fetchBttvEmoteCatalog({
    providerId: 'channel-1',
    fetchImpl: async (url) => {
      calls.push(url);

      if (url.endsWith('/cached/emotes/global')) {
        return createJsonResponse([{ id: 'global-1', code: 'OMEGALUL' }]);
      }

      return createJsonResponse({
        channelEmotes: [{ id: 'channel-1', code: 'monkaS' }],
        sharedEmotes: [{ id: 'shared-1', code: 'pepeLaugh' }],
      });
    },
  });

  assert.deepEqual(Object.keys(catalog), ['OMEGALUL', 'monkaS', 'pepeLaugh']);
  assert.equal(calls.length, 2);
});

test('keeps BetterTTV global emotes when channel lookup fails', async () => {
  const catalog = await fetchBttvEmoteCatalog({
    providerId: 'missing-channel',
    fetchImpl: async (url) =>
      url.endsWith('/cached/emotes/global')
        ? createJsonResponse([{ id: 'global-1', code: 'OMEGALUL' }])
        : createJsonResponse({}, { ok: false, status: 404 }),
  });

  assert.deepEqual(Object.keys(catalog), ['OMEGALUL']);
});
