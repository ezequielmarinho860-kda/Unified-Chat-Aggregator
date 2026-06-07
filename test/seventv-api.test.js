const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SEVENTV_CDN_ORIGIN,
  createSevenTvEmoteCatalog,
  fetchSevenTvEmoteCatalog,
} = require('../src/connectors/seventv-api');

const createJsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});

test('creates a 7TV emote catalog', () => {
  assert.deepEqual(
    createSevenTvEmoteCatalog([
      {
        name: 'peepoHappy',
        data: { id: 'emote-1', animated: true },
      },
    ]),
    {
      peepoHappy: {
        id: 'emote-1',
        code: 'peepoHappy',
        imageUrl: `${SEVENTV_CDN_ORIGIN}/emote-1/2x.webp`,
        animated: true,
        provider: '7tv',
      },
    },
  );
});

test('loads 7TV global and Twitch channel emotes', async () => {
  const calls = [];
  const catalog = await fetchSevenTvEmoteCatalog({
    providerId: 'channel-1',
    fetchImpl: async (url) => {
      calls.push(url);

      if (url.endsWith('/emote-sets/global')) {
        return createJsonResponse({
          emotes: [{ name: 'peepoHappy', data: { id: 'global-1' } }],
        });
      }

      return createJsonResponse({
        emote_set: {
          emotes: [{ name: 'catJAM', data: { id: 'channel-1' } }],
        },
      });
    },
  });

  assert.deepEqual(Object.keys(catalog), ['peepoHappy', 'catJAM']);
  assert.equal(calls.length, 2);
});

test('keeps 7TV global emotes when channel lookup fails', async () => {
  const catalog = await fetchSevenTvEmoteCatalog({
    providerId: 'missing-channel',
    fetchImpl: async (url) =>
      url.endsWith('/emote-sets/global')
        ? createJsonResponse({ emotes: [{ name: 'peepoHappy', data: { id: 'global-1' } }] })
        : createJsonResponse({}, { ok: false, status: 404 }),
  });

  assert.deepEqual(Object.keys(catalog), ['peepoHappy']);
});
