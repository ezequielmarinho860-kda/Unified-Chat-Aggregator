const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseTwitchChatCommand,
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

test('parses supported Twitch slash commands', () => {
  assert.deepEqual(parseTwitchChatCommand('/ban @baduser bad behavior'), {
    type: 'ban',
    username: 'baduser',
    reason: 'bad behavior',
  });
  assert.deepEqual(parseTwitchChatCommand('/timeout baduser 60 chill'), {
    type: 'timeout',
    username: 'baduser',
    duration: 60,
    reason: 'chill',
  });
  assert.deepEqual(parseTwitchChatCommand('/announce purple Stream starting'), {
    type: 'announce',
    color: 'purple',
    message: 'Stream starting',
  });
  assert.deepEqual(parseTwitchChatCommand('/clear'), { type: 'clear' });
});

test('routes Twitch ban commands to moderation API', async () => {
  const calls = [];
  const fetchImpl = createTwitchCommandFetch(calls);

  const result = await sendTwitchChatMessage({
    channel: 'monstercat',
    accessToken: 'token',
    message: '/ban baduser no spam',
    fetchImpl,
  });
  const commandCall = calls.at(-1);

  assert.deepEqual(result, {
    command: 'ban',
    targetUserId: 'target-1',
    isSent: true,
  });
  assert.equal(
    commandCall.url,
    'https://api.twitch.tv/helix/moderation/bans?broadcaster_id=broadcaster-1&moderator_id=sender-1',
  );
  assert.equal(commandCall.options.method, 'POST');
  assert.deepEqual(JSON.parse(commandCall.options.body), {
    data: {
      user_id: 'target-1',
      reason: 'no spam',
    },
  });
});

test('routes Twitch timeout commands to moderation API', async () => {
  const calls = [];
  const fetchImpl = createTwitchCommandFetch(calls);

  await sendTwitchChatMessage({
    channel: 'monstercat',
    accessToken: 'token',
    message: '/timeout baduser 120 cool down',
    fetchImpl,
  });
  const commandCall = calls.at(-1);

  assert.deepEqual(JSON.parse(commandCall.options.body), {
    data: {
      user_id: 'target-1',
      duration: 120,
      reason: 'cool down',
    },
  });
});

test('routes Twitch unban commands to moderation API', async () => {
  const calls = [];
  const fetchImpl = createTwitchCommandFetch(calls);

  await sendTwitchChatMessage({
    channel: 'monstercat',
    accessToken: 'token',
    message: '/unban baduser',
    fetchImpl,
  });

  assert.equal(
    calls.at(-1).url,
    'https://api.twitch.tv/helix/moderation/bans?broadcaster_id=broadcaster-1&moderator_id=sender-1&user_id=target-1',
  );
  assert.equal(calls.at(-1).options.method, 'DELETE');
});

test('routes Twitch clear commands to moderation chat API', async () => {
  const calls = [];
  const fetchImpl = createTwitchCommandFetch(calls);

  await sendTwitchChatMessage({
    channel: 'monstercat',
    accessToken: 'token',
    message: '/clear',
    fetchImpl,
  });

  assert.equal(
    calls.at(-1).url,
    'https://api.twitch.tv/helix/moderation/chat?broadcaster_id=broadcaster-1&moderator_id=sender-1',
  );
  assert.equal(calls.at(-1).options.method, 'DELETE');
});

test('routes Twitch announcement commands to chat announcement API', async () => {
  const calls = [];
  const fetchImpl = createTwitchCommandFetch(calls);

  await sendTwitchChatMessage({
    channel: 'monstercat',
    accessToken: 'token',
    message: '/announce green Hello chat',
    fetchImpl,
  });

  assert.equal(
    calls.at(-1).url,
    'https://api.twitch.tv/helix/chat/announcements?broadcaster_id=broadcaster-1&moderator_id=sender-1',
  );
  assert.equal(calls.at(-1).options.method, 'POST');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
    message: 'Hello chat',
    color: 'green',
  });
});

test('routes Twitch mod commands to moderators API', async () => {
  const calls = [];
  const fetchImpl = createTwitchCommandFetch(calls);

  await sendTwitchChatMessage({
    channel: 'monstercat',
    accessToken: 'token',
    message: '/mod newmod',
    fetchImpl,
  });

  assert.equal(
    calls.at(-1).url,
    'https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=broadcaster-1&user_id=target-1',
  );
  assert.equal(calls.at(-1).options.method, 'POST');
});

test('rejects Twitch commands when token is missing the command scope', async () => {
  const fetchImpl = createTwitchCommandFetch([], { scopes: ['user:write:chat'] });

  await assert.rejects(
    () =>
      sendTwitchChatMessage({
        channel: 'monstercat',
        accessToken: 'token',
        message: '/ban baduser',
        fetchImpl,
      }),
    /moderator:manage:banned_users/,
  );
});

test('rejects unsupported Twitch commands', async () => {
  const fetchImpl = createTwitchCommandFetch([]);

  await assert.rejects(
    () =>
      sendTwitchChatMessage({
        channel: 'monstercat',
        accessToken: 'token',
        message: '/unknown test',
        fetchImpl,
      }),
    /Unsupported Twitch command/,
  );
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

const createTwitchCommandFetch =
  (
    calls,
    {
      scopes = [
        'user:write:chat',
        'moderator:manage:announcements',
        'moderator:manage:banned_users',
        'moderator:manage:chat_messages',
        'channel:manage:moderators',
      ],
    } = {},
  ) =>
  async (url, options = {}) => {
    calls.push({ url, options });

    if (url === 'https://id.twitch.tv/oauth2/validate') {
      return createJsonResponse({
        client_id: 'client-1',
        user_id: 'sender-1',
        login: 'sender',
        scopes,
      });
    }

    if (String(url).startsWith('https://api.twitch.tv/helix/users?login=monstercat')) {
      return createJsonResponse({
        data: [{ id: 'broadcaster-1', login: 'monstercat' }],
      });
    }

    if (String(url).startsWith('https://api.twitch.tv/helix/users?login=baduser')) {
      return createJsonResponse({
        data: [{ id: 'target-1', login: 'baduser' }],
      });
    }

    if (String(url).startsWith('https://api.twitch.tv/helix/users?login=newmod')) {
      return createJsonResponse({
        data: [{ id: 'target-1', login: 'newmod' }],
      });
    }

    return createJsonResponse(undefined, { status: 204 });
  };
