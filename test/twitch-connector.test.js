const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const {
  TWITCH_IRC_URL,
  createTwitchConnector,
  normalizeChannelName,
} = require('../src/connectors/twitch-connector');

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
}

const createJsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});
const createEmptyBttvResponse = async () => createJsonResponse([]);
const flushAsyncMessages = () => new Promise((resolve) => setImmediate(resolve));

test('normalizes Twitch channel names', () => {
  assert.equal(normalizeChannelName(' #Monstercat '), 'monstercat');
});

test('connects to Twitch IRC and joins the configured channel', async () => {
  const sockets = [];
  const connector = createTwitchConnector({
    channel: 'Monstercat',
    fetchImpl: createEmptyBttvResponse,
    webSocketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  });

  await connector.connect();
  sockets[0].open();

  assert.equal(sockets[0].url, TWITCH_IRC_URL);
  assert.equal(sockets[0].sent[0], 'CAP REQ :twitch.tv/tags twitch.tv/commands');
  assert.equal(sockets[0].sent[1], 'PASS SCHMOOPIIE');
  assert.match(sockets[0].sent[2], /^NICK justinfan\d+$/);
  assert.equal(sockets[0].sent[3], 'JOIN #monstercat');

  await connector.disconnect();
});

test('loads Twitch badge images before parsing chat messages', async () => {
  const socket = new FakeWebSocket(TWITCH_IRC_URL);
  const connector = createTwitchConnector({
    channel: 'monstercat',
    accessToken: 'token',
    webSocketFactory: () => socket,
    fetchImpl: async (url) => {
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

      if (url === 'https://api.twitch.tv/helix/chat/badges/global') {
        return createJsonResponse({ data: [] });
      }

      return createJsonResponse({
        data: [
          {
            set_id: 'subscriber',
            versions: [
              {
                id: '12',
                title: 'Subscriber',
                image_url_2x: 'https://static-cdn.jtvnw.net/badges/v1/sub/2',
              },
            ],
          },
        ],
      });
    },
  });
  const received = [];
  const unsubscribe = connector.onMessage((message) => received.push(message));

  await connector.connect();
  socket.open();
  socket.receive(
    '@badges=subscriber/12;display-name=Ana;id=message-1;tmi-sent-ts=1780603200000;user-id=user-1 :ana!ana@ana.tmi.twitch.tv PRIVMSG #monstercat :hello twitch',
  );
  await flushAsyncMessages();

  assert.deepEqual(received[0].author.badges, [
    {
      id: 'subscriber',
      label: 'Subscriber',
      version: '12',
      imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/sub/2',
    },
  ]);

  unsubscribe();
  await connector.disconnect();
});

test('emits parsed Twitch chat messages', async () => {
  const socket = new FakeWebSocket(TWITCH_IRC_URL);
  const connector = createTwitchConnector({
    channel: 'monstercat',
    fetchImpl: createEmptyBttvResponse,
    webSocketFactory: () => socket,
  });
  const received = [];
  const unsubscribe = connector.onMessage((message) => received.push(message));

  await connector.connect();
  socket.open();
  socket.receive(
    '@display-name=Ana;id=message-1;tmi-sent-ts=1780603200000;user-id=user-1 :ana!ana@ana.tmi.twitch.tv PRIVMSG #monstercat :hello twitch',
  );
  await flushAsyncMessages();

  assert.equal(received.length, 1);
  assert.equal(received[0].platform, 'twitch');
  assert.equal(received[0].text, 'hello twitch');

  unsubscribe();
  await connector.disconnect();
});

test('responds to Twitch PING messages with PONG', async () => {
  const socket = new FakeWebSocket(TWITCH_IRC_URL);
  const connector = createTwitchConnector({
    channel: 'monstercat',
    fetchImpl: createEmptyBttvResponse,
    webSocketFactory: () => socket,
  });

  await connector.connect();
  socket.open();
  socket.receive('PING :tmi.twitch.tv');

  assert.equal(socket.sent.at(-1), 'PONG :tmi.twitch.tv');

  await connector.disconnect();
});

test('renders BetterTTV global emotes from Twitch chat text', async () => {
  const socket = new FakeWebSocket(TWITCH_IRC_URL);
  const connector = createTwitchConnector({
    channel: 'monstercat',
    webSocketFactory: () => socket,
    fetchImpl: async () => createJsonResponse([{ id: 'bttv-1', code: 'OMEGALUL' }]),
  });
  const received = [];
  const unsubscribe = connector.onMessage((message) => received.push(message));

  await connector.connect();
  socket.open();
  socket.receive(
    '@display-name=Ana;id=message-1;tmi-sent-ts=1780603200000;user-id=user-1 :ana!ana@ana.tmi.twitch.tv PRIVMSG #monstercat :OMEGALUL chat',
  );
  await flushAsyncMessages();

  assert.deepEqual(received[0].fragments, [
    {
      type: 'emote',
      id: 'bttv:bttv-1',
      text: 'OMEGALUL',
      imageUrl: 'https://cdn.betterttv.net/emote/bttv-1/2x',
    },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'chat' },
  ]);

  unsubscribe();
  await connector.disconnect();
});

test('renders 7TV global emotes from Twitch chat text', async () => {
  const socket = new FakeWebSocket(TWITCH_IRC_URL);
  const connector = createTwitchConnector({
    channel: 'monstercat',
    webSocketFactory: () => socket,
    fetchImpl: async (url) => {
      if (String(url).includes('7tv.io/v3/emote-sets/global')) {
        return createJsonResponse({
          emotes: [{ name: 'catJAM', data: { id: 'seventv-1' } }],
        });
      }

      return createJsonResponse([]);
    },
  });
  const received = [];
  const unsubscribe = connector.onMessage((message) => received.push(message));

  await connector.connect();
  socket.open();
  socket.receive(
    '@display-name=Ana;id=message-1;tmi-sent-ts=1780603200000;user-id=user-1 :ana!ana@ana.tmi.twitch.tv PRIVMSG #monstercat :catJAM chat',
  );
  await flushAsyncMessages();

  assert.deepEqual(received[0].fragments, [
    {
      type: 'emote',
      id: '7tv:seventv-1',
      text: 'catJAM',
      imageUrl: 'https://cdn.7tv.app/emote/seventv-1/2x.webp',
    },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'chat' },
  ]);

  unsubscribe();
  await connector.disconnect();
});

test('resolves unknown shared BetterTTV emotes on first use', async () => {
  const socket = new FakeWebSocket(TWITCH_IRC_URL);
  const connector = createTwitchConnector({
    channel: 'monstercat',
    webSocketFactory: () => socket,
    fetchImpl: async (url) => {
      if (String(url).includes('/cached/emotes/global')) {
        return createJsonResponse([]);
      }

      if (String(url).includes('/emotes/shared/search')) {
        return createJsonResponse([{ id: 'shared-1', code: 'modCheck' }]);
      }

      return createJsonResponse([]);
    },
  });
  const received = [];
  const unsubscribe = connector.onMessage((message) => received.push(message));

  await connector.connect();
  socket.open();
  socket.receive(
    '@display-name=Ana;id=message-1;tmi-sent-ts=1780603200000;user-id=user-1 :ana!ana@ana.tmi.twitch.tv PRIVMSG #monstercat :modCheck',
  );
  await flushAsyncMessages();

  assert.deepEqual(received[0].fragments, [
    {
      type: 'emote',
      id: 'bttv:shared-1',
      text: 'modCheck',
      imageUrl: 'https://cdn.betterttv.net/emote/shared-1/2x',
    },
  ]);

  unsubscribe();
  await connector.disconnect();
});

test('sends Twitch chat messages through the Helix API', async () => {
  const socket = new FakeWebSocket(TWITCH_IRC_URL);
  const apiCalls = [];
  const connector = createTwitchConnector({
    channel: 'monstercat',
    accessToken: 'token',
    webSocketFactory: () => socket,
    fetchImpl: async (url, options = {}) => {
      apiCalls.push({ url, options });

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
        data: [{ message_id: 'message-1', is_sent: true }],
      });
    },
  });

  const result = await connector.send('hello twitch');

  assert.deepEqual(result, { messageId: 'message-1', isSent: true });
  assert.equal(apiCalls.at(-1).url, 'https://api.twitch.tv/helix/chat/messages');
});
