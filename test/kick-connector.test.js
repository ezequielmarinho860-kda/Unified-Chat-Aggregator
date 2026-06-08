const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const {
  KICK_PUSHER_URL,
  createKickConnector,
} = require('../src/connectors/kick-connector');
const { KICK_CHAT_MESSAGE_EVENT } = require('../src/connectors/kick-pusher-parser');

class FakeWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
  }

  addEventListener(eventName, listener) {
    this.on(eventName, listener);
  }

  send(message) {
    this.sent.push(message);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open');
  }

  receive(data) {
    this.emit('message', { data });
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }

  error() {
    this.emit('error', new Error('socket error'));
  }
}

test('subscribes to the Kick chatroom channel on connect', async () => {
  const sockets = [];
  const connector = createKickConnector({
    channel: 'xqc',
    chatroomId: '12345',
    webSocketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  });

  await connector.connect();
  sockets[0].open();

  assert.equal(sockets[0].url, KICK_PUSHER_URL);
  assert.deepEqual(JSON.parse(sockets[0].sent[0]), {
    event: 'pusher:subscribe',
    data: {
      auth: '',
      channel: 'chatrooms.12345.v2',
    },
  });

  await connector.disconnect();
});

test('emits parsed Kick chat messages', async () => {
  const socket = new FakeWebSocket(KICK_PUSHER_URL);
  const connector = createKickConnector({
    channel: 'xqc',
    chatroomId: '12345',
    webSocketFactory: () => socket,
  });
  const received = [];
  const unsubscribe = connector.onMessage((message) => received.push(message));

  await connector.connect();
  socket.open();
  socket.receive(
    JSON.stringify({
      event: KICK_CHAT_MESSAGE_EVENT,
      data: JSON.stringify({
        id: 'message-1',
        content: 'hello kick',
        created_at: '2026-06-04T20:00:00.000Z',
        sender: { id: 7, username: 'Ana' },
      }),
    }),
  );

  assert.equal(received.length, 1);
  assert.equal(received[0].platform, 'kick');
  assert.equal(received[0].text, 'hello kick');

  unsubscribe();
  await connector.disconnect();
});

test('deduplicates repeated Kick chat message ids', async () => {
  const socket = new FakeWebSocket(KICK_PUSHER_URL);
  const connector = createKickConnector({
    channel: 'xqc',
    chatroomId: '12345',
    webSocketFactory: () => socket,
  });
  const received = [];
  const unsubscribe = connector.onMessage((message) => received.push(message));
  const rawMessage = JSON.stringify({
    event: KICK_CHAT_MESSAGE_EVENT,
    data: JSON.stringify({
      id: 'message-1',
      content: 'hello kick',
      created_at: '2026-06-04T20:00:00.000Z',
      sender: { id: 7, username: 'Ana' },
    }),
  });

  await connector.connect();
  socket.open();
  socket.receive(rawMessage);
  socket.receive(rawMessage);
  socket.receive(rawMessage);

  assert.equal(received.length, 1);

  unsubscribe();
  await connector.disconnect();
});

test('ignores messages from stale Kick sockets after reconnect', async () => {
  const sockets = [];
  const connector = createKickConnector({
    channel: 'xqc',
    chatroomId: '12345',
    reconnectMs: 1,
    webSocketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  });
  const received = [];
  const unsubscribe = connector.onMessage((message) => received.push(message));

  await connector.connect();
  sockets[0].open();
  sockets[0].close();
  await new Promise((resolve) => {
    setTimeout(resolve, 5);
  });
  sockets[1].open();
  sockets[0].receive(
    JSON.stringify({
      event: KICK_CHAT_MESSAGE_EVENT,
      data: JSON.stringify({
        id: 'stale-message',
        content: 'old socket',
        created_at: '2026-06-04T20:00:00.000Z',
        sender: { id: 7, username: 'Ana' },
      }),
    }),
  );
  sockets[1].receive(
    JSON.stringify({
      event: KICK_CHAT_MESSAGE_EVENT,
      data: JSON.stringify({
        id: 'fresh-message',
        content: 'fresh socket',
        created_at: '2026-06-04T20:00:00.000Z',
        sender: { id: 7, username: 'Ana' },
      }),
    }),
  );

  assert.deepEqual(
    received.map((message) => message.text),
    ['fresh socket'],
  );

  unsubscribe();
  await connector.disconnect();
});

test('responds to Pusher ping with pong', async () => {
  const socket = new FakeWebSocket(KICK_PUSHER_URL);
  const connector = createKickConnector({
    channel: 'xqc',
    chatroomId: '12345',
    webSocketFactory: () => socket,
  });

  await connector.connect();
  socket.open();
  socket.receive(JSON.stringify({ event: 'pusher:ping', data: {} }));

  assert.deepEqual(JSON.parse(socket.sent.at(-1)), {
    event: 'pusher:pong',
    data: {},
  });

  await connector.disconnect();
});

test('closes Kick socket errors without recursive close loops', async () => {
  class RecursiveErrorSocket extends FakeWebSocket {
    close() {
      this.error();
      super.close();
    }
  }

  const socket = new RecursiveErrorSocket(KICK_PUSHER_URL);
  const connector = createKickConnector({
    channel: 'xqc',
    chatroomId: '12345',
    reconnectMs: 60_000,
    webSocketFactory: () => socket,
  });

  await connector.connect();
  socket.open();

  assert.doesNotThrow(() => socket.error());
  assert.equal(socket.readyState, FakeWebSocket.CLOSED);

  await connector.disconnect();
});

test('sends Kick chat messages through the public API', async () => {
  const socket = new FakeWebSocket(KICK_PUSHER_URL);
  const apiCalls = [];
  const connector = createKickConnector({
    channel: 'xqc',
    chatroomId: '12345',
    accessToken: 'token',
    webSocketFactory: () => socket,
    fetchImpl: async (url, options = {}) => {
      apiCalls.push({ url, options });

      if (String(url).startsWith('https://api.kick.com/public/v1/channels')) {
        return createJsonResponse({
          data: [{ broadcaster_user_id: 123, slug: 'xqc' }],
        });
      }

      return createJsonResponse({ message: 'OK' });
    },
  });

  const result = await connector.send('hello kick');

  assert.deepEqual(result, { isSent: true, message: 'OK' });
  assert.equal(apiCalls.at(-1).url, 'https://api.kick.com/public/v1/chat');
});

test('refreshes Kick access tokens and retries sends after 401', async () => {
  const socket = new FakeWebSocket(KICK_PUSHER_URL);
  const apiCalls = [];
  const authUpdates = [];
  let channelAttempts = 0;
  const connector = createKickConnector({
    channel: 'xqc',
    chatroomId: '12345',
    accessToken: 'expired-token',
    refreshToken: 'refresh-1',
    clientId: 'client-1',
    oauthBrokerUrl: 'https://broker.example.com',
    onAuthUpdate: async (authPatch) => {
      authUpdates.push(authPatch);
    },
    webSocketFactory: () => socket,
    fetchImpl: async (url, options = {}) => {
      apiCalls.push({ url, options });

      if (String(url).startsWith('https://api.kick.com/public/v1/channels')) {
        channelAttempts += 1;

        if (channelAttempts === 1) {
          return createJsonResponse({ message: 'Unauthorized' }, { ok: false, status: 401 });
        }

        assert.equal(options.headers.Authorization, 'Bearer fresh-token');
        return createJsonResponse({
          data: [{ broadcaster_user_id: 123, slug: 'xqc' }],
        });
      }

      if (url === 'https://broker.example.com/kick/refresh') {
        assert.deepEqual(JSON.parse(options.body), {
          clientId: 'client-1',
          refreshToken: 'refresh-1',
        });

        return createJsonResponse({
          access_token: 'fresh-token',
          refresh_token: 'refresh-2',
          expires_in: 3600,
        });
      }

      return createJsonResponse({ message: 'OK' });
    },
  });

  const result = await connector.send('hello kick');

  assert.deepEqual(result, { isSent: true, message: 'OK' });
  assert.equal(apiCalls.at(-1).url, 'https://api.kick.com/public/v1/chat');
  assert.deepEqual(authUpdates, [
    {
      accessToken: 'fresh-token',
      refreshToken: 'refresh-2',
      expiresAt: authUpdates[0].expiresAt,
    },
  ]);
  assert.match(authUpdates[0].expiresAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('reports resolver failure without throwing from connect', async () => {
  const connector = createKickConnector({
    channel: 'xqc',
    reconnectMs: 60_000,
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }),
  });
  const errors = [];
  const unsubscribe = connector.onError((error) => errors.push(error));

  await connector.connect();

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /403/);

  unsubscribe();
  await connector.disconnect();
});

const createJsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});
