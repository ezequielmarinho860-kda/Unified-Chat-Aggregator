const assert = require('node:assert/strict');
const test = require('node:test');
const {
  resolveTwitchUserByLogin,
  sendTwitchChatMessage,
  validateTwitchAccessToken,
} = require('../src/connectors/twitch-api');

const createJsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});

test('validates a Twitch access token', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://id.twitch.tv/oauth2/validate');
    assert.equal(options.headers.Authorization, 'OAuth token');

    return createJsonResponse({
      client_id: 'client-1',
      user_id: 'sender-1',
      login: 'sender',
      scopes: ['user:write:chat'],
    });
  };

  const tokenInfo = await validateTwitchAccessToken({ accessToken: 'oauth:token', fetchImpl });

  assert.deepEqual(tokenInfo, {
    clientId: 'client-1',
    userId: 'sender-1',
    login: 'sender',
    scopes: ['user:write:chat'],
  });
});

test('resolves a Twitch user by login', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://api.twitch.tv/helix/users?login=monstercat');
    assert.equal(options.headers.Authorization, 'Bearer token');
    assert.equal(options.headers['Client-Id'], 'client-1');

    return createJsonResponse({
      data: [{ id: 'broadcaster-1', login: 'monstercat', display_name: 'Monstercat' }],
    });
  };

  const user = await resolveTwitchUserByLogin({
    login: 'Monstercat',
    accessToken: 'token',
    clientId: 'client-1',
    fetchImpl,
  });

  assert.deepEqual(user, {
    id: 'broadcaster-1',
    login: 'monstercat',
    displayName: 'Monstercat',
  });
});

test('sends a Twitch chat message', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });

    if (url === 'https://id.twitch.tv/oauth2/validate') {
      return createJsonResponse({
        client_id: 'client-1',
        user_id: 'sender-1',
        login: 'sender',
        scopes: ['user:write:chat'],
      });
    }

    if (String(url).startsWith('https://api.twitch.tv/helix/users')) {
      return createJsonResponse({
        data: [{ id: 'broadcaster-1', login: 'monstercat' }],
      });
    }

    assert.equal(url, 'https://api.twitch.tv/helix/chat/messages');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer token');
    assert.equal(options.headers['Client-Id'], 'client-1');
    assert.deepEqual(JSON.parse(options.body), {
      broadcaster_id: 'broadcaster-1',
      sender_id: 'sender-1',
      message: 'hello chat',
    });

    return createJsonResponse({
      data: [{ message_id: 'message-1', is_sent: true }],
    });
  };

  const result = await sendTwitchChatMessage({
    channel: 'monstercat',
    accessToken: 'token',
    message: ' hello chat ',
    fetchImpl,
  });

  assert.deepEqual(result, { messageId: 'message-1', isSent: true });
  assert.equal(calls.length, 3);
});

test('rejects Twitch tokens without write scope', async () => {
  const fetchImpl = async () =>
    createJsonResponse({
      client_id: 'client-1',
      user_id: 'sender-1',
      login: 'sender',
      scopes: [],
    });

  await assert.rejects(
    () =>
      sendTwitchChatMessage({
        channel: 'monstercat',
        accessToken: 'token',
        message: 'hello',
        fetchImpl,
      }),
    /user:write:chat/,
  );
});

test('rejects dropped Twitch chat messages', async () => {
  const fetchImpl = async (url) => {
    if (url === 'https://id.twitch.tv/oauth2/validate') {
      return createJsonResponse({
        client_id: 'client-1',
        user_id: 'sender-1',
        login: 'sender',
        scopes: ['user:write:chat'],
      });
    }

    if (String(url).startsWith('https://api.twitch.tv/helix/users')) {
      return createJsonResponse({
        data: [{ id: 'broadcaster-1', login: 'monstercat' }],
      });
    }

    return createJsonResponse({
      data: [
        {
          message_id: 'message-1',
          is_sent: false,
          drop_reason: { message: 'Message blocked by AutoMod.' },
        },
      ],
    });
  };

  await assert.rejects(
    () =>
      sendTwitchChatMessage({
        channel: 'monstercat',
        accessToken: 'token',
        message: 'hello',
        fetchImpl,
      }),
    /AutoMod/,
  );
});
