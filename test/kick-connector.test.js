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
        content: 'ola kick',
        created_at: '2026-06-04T20:00:00.000Z',
        sender: { id: 7, username: 'Ana' },
      }),
    }),
  );

  assert.equal(received.length, 1);
  assert.equal(received[0].platform, 'kick');
  assert.equal(received[0].text, 'ola kick');

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
