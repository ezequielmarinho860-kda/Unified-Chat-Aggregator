const assert = require('node:assert/strict');
const test = require('node:test');
const {
  exchangeKickAuthorizationCode,
  resolveKickChannelBySlug,
  resolveKickCurrentUser,
  sendKickChatMessage,
  validateKickAccessToken,
} = require('../src/connectors/kick-api');

const createJsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});

test('exchanges a Kick authorization code for tokens', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://id.kick.com/oauth/token');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');

    const body = new URLSearchParams(options.body);

    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('client_id'), 'client-1');
    assert.equal(body.get('client_secret'), 'secret-1');
    assert.equal(body.get('redirect_uri'), 'http://localhost/kick/callback');
    assert.equal(body.get('code_verifier'), 'verifier-1');
    assert.equal(body.get('code'), 'code-1');

    return createJsonResponse({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'user:read channel:read chat:write',
    });
  };

  const token = await exchangeKickAuthorizationCode({
    code: 'code-1',
    clientId: 'client-1',
    clientSecret: 'secret-1',
    redirectUri: 'http://localhost/kick/callback',
    codeVerifier: 'verifier-1',
    fetchImpl,
  });

  assert.equal(token.accessToken, 'access-1');
  assert.equal(token.refreshToken, 'refresh-1');
  assert.equal(token.tokenType, 'Bearer');
  assert.deepEqual(token.scopes, ['user:read', 'channel:read', 'chat:write']);
  assert.match(token.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('exchanges a Kick authorization code through the OAuth broker', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://broker.example.com/kick/token');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), {
      clientId: 'client-1',
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'http://localhost/kick/callback',
    });

    return createJsonResponse({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'user:read channel:read chat:write',
    });
  };

  const token = await exchangeKickAuthorizationCode({
    code: 'code-1',
    clientId: 'client-1',
    oauthBrokerUrl: 'https://broker.example.com/',
    redirectUri: 'http://localhost/kick/callback',
    codeVerifier: 'verifier-1',
    fetchImpl,
  });

  assert.equal(token.accessToken, 'access-1');
  assert.equal(token.refreshToken, 'refresh-1');
});

test('validates a Kick access token', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://api.kick.com/public/v1/token/introspect');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer token');

    return createJsonResponse({
      data: {
        active: true,
        client_id: 'client-1',
        token_type: 'user',
        scope: 'user:read channel:read chat:write',
        exp: 1780603200,
      },
    });
  };

  const tokenInfo = await validateKickAccessToken({ accessToken: 'token', fetchImpl });

  assert.deepEqual(tokenInfo, {
    active: true,
    clientId: 'client-1',
    tokenType: 'user',
    scopes: ['user:read', 'channel:read', 'chat:write'],
    expiresAt: '2026-06-04T20:00:00.000Z',
  });
});

test('resolves the current Kick user', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://api.kick.com/public/v1/users');
    assert.equal(options.headers.Authorization, 'Bearer token');

    return createJsonResponse({
      data: [
        {
          user_id: 7,
          name: 'sender',
          profile_picture: 'https://kick.com/avatar.webp',
        },
      ],
    });
  };

  const user = await resolveKickCurrentUser({ accessToken: 'token', fetchImpl });

  assert.deepEqual(user, {
    userId: '7',
    login: 'sender',
    displayName: 'sender',
    profilePicture: 'https://kick.com/avatar.webp',
  });
});

test('resolves Kick current user when API returns username instead of name', async () => {
  const fetchImpl = async () =>
    createJsonResponse({
      data: {
        id: 7,
        username: 'sender',
        profilePicture: 'https://kick.com/avatar.webp',
      },
    });

  const user = await resolveKickCurrentUser({ accessToken: 'token', fetchImpl });

  assert.deepEqual(user, {
    userId: '7',
    login: 'sender',
    displayName: 'sender',
    profilePicture: 'https://kick.com/avatar.webp',
  });
});

test('resolves a Kick channel by slug', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://api.kick.com/public/v1/channels?slug=xqc');
    assert.equal(options.headers.Authorization, 'Bearer token');

    return createJsonResponse({
      data: [
        {
          broadcaster_user_id: 123,
          slug: 'xqc',
        },
      ],
    });
  };

  const channel = await resolveKickChannelBySlug({
    channel: 'https://kick.com/XQC',
    accessToken: 'token',
    fetchImpl,
  });

  assert.deepEqual(channel, {
    broadcasterUserId: 123,
    slug: 'xqc',
  });
});

test('sends a Kick chat message as the authenticated user', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });

    if (String(url).startsWith('https://api.kick.com/public/v1/channels')) {
      return createJsonResponse({
        data: [{ broadcaster_user_id: 123, slug: 'xqc' }],
      });
    }

    assert.equal(url, 'https://api.kick.com/public/v1/chat');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer token');
    assert.deepEqual(JSON.parse(options.body), {
      broadcaster_user_id: 123,
      content: 'hello kick',
      type: 'user',
    });

    return createJsonResponse({ message: 'OK' });
  };

  const result = await sendKickChatMessage({
    channel: 'xqc',
    accessToken: 'token',
    message: ' hello kick ',
    fetchImpl,
  });

  assert.deepEqual(result, { isSent: true, message: 'OK' });
  assert.equal(calls.length, 2);
});

test('surfaces Kick send failures', async () => {
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://api.kick.com/public/v1/channels')) {
      return createJsonResponse({
        data: [{ broadcaster_user_id: 123, slug: 'xqc' }],
      });
    }

    return createJsonResponse({ message: 'Unauthorized' }, { ok: false, status: 401 });
  };

  await assert.rejects(
    () =>
      sendKickChatMessage({
        channel: 'xqc',
        accessToken: 'token',
        message: 'hello',
        fetchImpl,
      }),
    /Unauthorized/,
  );
});

test('explains Kick send 403 channel permission failures', async () => {
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://api.kick.com/public/v1/channels')) {
      return createJsonResponse({
        data: [{ broadcaster_user_id: 123, slug: 'xqc' }],
      });
    }

    return createJsonResponse({ message: 'Forbidden' }, { ok: false, status: 403 });
  };

  await assert.rejects(
    () =>
      sendKickChatMessage({
        channel: 'xqc',
        accessToken: 'token',
        message: 'hello',
        fetchImpl,
      }),
    /may require the sender to follow/,
  );
});
