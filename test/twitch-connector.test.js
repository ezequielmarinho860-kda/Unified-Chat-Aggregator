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

test('normalizes Twitch channel names', () => {
  assert.equal(normalizeChannelName(' #Monstercat '), 'monstercat');
});

test('connects to Twitch IRC and joins the configured channel', async () => {
  const sockets = [];
  const connector = createTwitchConnector({
    channel: 'Monstercat',
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

test('emits parsed Twitch chat messages', async () => {
  const socket = new FakeWebSocket(TWITCH_IRC_URL);
  const connector = createTwitchConnector({
    channel: 'monstercat',
    webSocketFactory: () => socket,
  });
  const received = [];
  const unsubscribe = connector.onMessage((message) => received.push(message));

  await connector.connect();
  socket.open();
  socket.receive(
    '@display-name=Ana;id=message-1;tmi-sent-ts=1780603200000;user-id=user-1 :ana!ana@ana.tmi.twitch.tv PRIVMSG #monstercat :hello twitch',
  );

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
    webSocketFactory: () => socket,
  });

  await connector.connect();
  socket.open();
  socket.receive('PING :tmi.twitch.tv');

  assert.equal(socket.sent.at(-1), 'PONG :tmi.twitch.tv');

  await connector.disconnect();
});
