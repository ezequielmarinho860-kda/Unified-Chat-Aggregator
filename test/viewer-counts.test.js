const assert = require('node:assert/strict');
const test = require('node:test');
const {
  KICK_LIVESTREAMS_ENDPOINT,
  TWITCH_TOKEN_CACHE_TTL_MS,
  clearKickBroadcasterCache,
  clearTwitchTokenValidationCache,
  createRefreshingKickViewerFetcher,
  fetchKickViewerCount,
  fetchTwitchViewerCount,
  parseAbbreviatedCount,
  parseViewerCountText,
} = require('../src/viewer-counts');

const createJsonResponse = (body, { ok = true, status = 200, headers = {} } = {}) => ({
  ok,
  status,
  headers: { get: (name) => headers[name] },
  json: async () => body,
});

test.beforeEach(() => {
  clearKickBroadcasterCache();
  clearTwitchTokenValidationCache();
});

test('loads Twitch live viewer count', async () => {
  const fetchImpl = async (url, options) => {
    if (url === 'https://id.twitch.tv/oauth2/validate') {
      return createJsonResponse({
        client_id: 'client-1',
        user_id: 'sender-1',
        login: 'sender',
        scopes: [],
      });
    }

    assert.equal(url, 'https://api.twitch.tv/helix/streams?user_login=monstercat');
    assert.equal(options.headers['Client-Id'], 'client-1');
    return createJsonResponse(
      { data: [{ viewer_count: 1234 }] },
      {
        headers: {
          'Ratelimit-Limit': '800',
          'Ratelimit-Remaining': '799',
          'Ratelimit-Reset': '1780700000',
        },
      },
    );
  };

  assert.deepEqual(
    await fetchTwitchViewerCount({ channel: 'monstercat', accessToken: 'token', fetchImpl }),
    {
      count: 1234,
      rateLimit: { limit: 800, remaining: 799, resetAt: 1780700000 },
    },
  );
});

test('returns zero when Twitch stream is offline', async () => {
  const fetchImpl = async (url) =>
    url === 'https://id.twitch.tv/oauth2/validate'
      ? createJsonResponse({ client_id: 'client-1', user_id: 'sender-1', login: 'sender' })
      : createJsonResponse({ data: [] });

  assert.equal(
    (await fetchTwitchViewerCount({ channel: 'monstercat', accessToken: 'token', fetchImpl })).count,
    0,
  );
});

test('preserves Twitch rate-limit headers on viewer lookup errors', async () => {
  const fetchImpl = async (url) =>
    url === 'https://id.twitch.tv/oauth2/validate'
      ? createJsonResponse({ client_id: 'client-1', user_id: 'sender-1', login: 'sender' })
      : createJsonResponse(
          {},
          {
            ok: false,
            status: 429,
            headers: {
              'Ratelimit-Limit': '800',
              'Ratelimit-Remaining': '0',
              'Ratelimit-Reset': '1780700000',
            },
          },
        );

  await assert.rejects(
    () => fetchTwitchViewerCount({ channel: 'monstercat', accessToken: 'token', fetchImpl }),
    (error) =>
      error.message.includes('429') &&
      error.rateLimit.remaining === 0 &&
      error.rateLimit.resetAt === 1780700000,
  );
});

test('caches Twitch token validation between viewer polls', async () => {
  let validationCalls = 0;
  let streamCalls = 0;
  const fetchImpl = async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/validate') {
      validationCalls += 1;
      return createJsonResponse({ client_id: 'client-1', user_id: 'sender-1', login: 'sender' });
    }

    streamCalls += 1;
    return createJsonResponse({ data: [{ viewer_count: streamCalls }] });
  };

  await fetchTwitchViewerCount({ channel: 'monstercat', accessToken: 'token', fetchImpl });
  await fetchTwitchViewerCount({ channel: 'monstercat', accessToken: 'oauth:token', fetchImpl });

  assert.equal(validationCalls, 1);
  assert.equal(streamCalls, 2);
});

test('revalidates Twitch token after cache expiration', async () => {
  let validationCalls = 0;
  let currentTime = 1_000;
  const fetchImpl = async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/validate') {
      validationCalls += 1;
      return createJsonResponse({ client_id: 'client-1', user_id: 'sender-1', login: 'sender' });
    }

    return createJsonResponse({ data: [] });
  };

  await fetchTwitchViewerCount({
    channel: 'monstercat',
    accessToken: 'token',
    fetchImpl,
    now: () => currentTime,
  });
  currentTime += TWITCH_TOKEN_CACHE_TTL_MS + 1;
  await fetchTwitchViewerCount({
    channel: 'monstercat',
    accessToken: 'token',
    fetchImpl,
    now: () => currentTime,
  });

  assert.equal(validationCalls, 2);
});

test('invalidates cached Twitch validation after stream unauthorized response', async () => {
  let validationCalls = 0;
  let streamCalls = 0;
  const fetchImpl = async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/validate') {
      validationCalls += 1;
      return createJsonResponse({ client_id: 'client-1', user_id: 'sender-1', login: 'sender' });
    }

    streamCalls += 1;
    return streamCalls === 1
      ? createJsonResponse({}, { ok: false, status: 401 })
      : createJsonResponse({ data: [] });
  };

  await assert.rejects(
    () => fetchTwitchViewerCount({ channel: 'monstercat', accessToken: 'token', fetchImpl }),
    /401/,
  );
  await fetchTwitchViewerCount({ channel: 'monstercat', accessToken: 'token', fetchImpl });

  assert.equal(validationCalls, 2);
});

test('loads Kick live viewer count', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer token');

    if (url === 'https://api.kick.com/public/v1/channels?slug=xqc') {
      return createJsonResponse({ data: [{ broadcaster_user_id: 123, slug: 'xqc' }] });
    }

    assert.equal(url, `${KICK_LIVESTREAMS_ENDPOINT}?broadcaster_user_id=123`);
    return createJsonResponse({ data: [{ viewer_count: 9876 }] });
  };

  assert.equal(await fetchKickViewerCount({ channel: 'XQC', accessToken: 'token', fetchImpl }), 9876);
});

test('returns zero when Kick stream is offline', async () => {
  const fetchImpl = async (url) =>
    url.includes('/channels?')
      ? createJsonResponse({ data: [{ broadcaster_user_id: 123, slug: 'xqc' }] })
      : createJsonResponse({ data: [] });

  assert.equal(await fetchKickViewerCount({ channel: 'xqc', accessToken: 'token', fetchImpl }), 0);
});

test('caches Kick broadcaster id between viewer polls', async () => {
  let channelCalls = 0;
  let livestreamCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes('/channels?')) {
      channelCalls += 1;
      return createJsonResponse({ data: [{ broadcaster_user_id: 123, slug: 'xqc' }] });
    }

    livestreamCalls += 1;
    return createJsonResponse({ data: [{ viewer_count: livestreamCalls }] });
  };

  await fetchKickViewerCount({ channel: 'xqc', accessToken: 'token', fetchImpl });
  await fetchKickViewerCount({ channel: 'https://kick.com/XQC', accessToken: 'token', fetchImpl });

  assert.equal(channelCalls, 1);
  assert.equal(livestreamCalls, 2);
});

test('refreshes an unauthorized Kick viewer token and retries', async () => {
  const configs = [];
  const authUpdates = [];
  const fetchViewerCount = async (config) => {
    configs.push(config);

    if (config.accessToken === 'expired') {
      const error = new Error('Kick channel lookup failed with status 401.');

      error.status = 401;
      throw error;
    }

    return 55;
  };
  const fetchKick = createRefreshingKickViewerFetcher({
    fetchViewerCount,
    refreshAccessToken: async () => ({
      accessToken: 'fresh',
      refreshToken: 'refresh-2',
      expiresAt: '2026-06-07T00:00:00.000Z',
    }),
    onAuthUpdate: async (patch) => authUpdates.push(patch),
  });

  assert.equal(
    await fetchKick({ accessToken: 'expired', refreshToken: 'refresh-1' }),
    55,
  );
  assert.equal(configs[1].accessToken, 'fresh');
  assert.deepEqual(authUpdates[0], {
    accessToken: 'fresh',
    refreshToken: 'refresh-2',
    expiresAt: '2026-06-07T00:00:00.000Z',
  });
});

test('parses viewer labels and abbreviated counts', () => {
  assert.equal(parseViewerCountText('1,234 viewers'), 1234);
  assert.equal(parseViewerCountText('2.5K watching'), 2500);
  assert.equal(parseViewerCountText('3,2 mil espectadores'), 3200);
  assert.equal(parseAbbreviatedCount('1.2M'), 1_200_000);
  assert.equal(parseViewerCountText('No live data'), undefined);
});
