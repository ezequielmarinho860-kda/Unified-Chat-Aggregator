const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { createChatHub } = require('../src/chat-hub');

const createTestConnector = ({
  platform = 'twitch',
  channel,
  liveUrl,
  sendImpl = async (_text) => {},
  onConnect = async () => {},
  onDisconnect = async () => {},
} = {}) => {
  const events = new EventEmitter();

  return {
    platform,
    channel,
    liveUrl,
    connect: onConnect,
    disconnect: onDisconnect,
    send: sendImpl,
    onMessage: (listener) => {
      events.on('message', listener);
      return () => events.off('message', listener);
    },
    onError: (listener) => {
      events.on('connector-error', listener);
      return () => events.off('connector-error', listener);
    },
    emitMessage: (message) => events.emit('message', message),
    emitError: (error) => events.emit('connector-error', error),
  };
};

test('publishes connector messages as canonical chat messages', async () => {
  const connector = createTestConnector({ channel: 'monstercat' });
  const hub = createChatHub({ connectors: [connector] });
  const received = [];

  hub.onMessage((message) => received.push(message));

  connector.emitMessage({
    id: 'hub-1',
    platform: 'twitch',
    author: { id: 'author-1', name: 'Ana' },
    text: 'Message through the hub',
    timestamp: '2026-06-04T20:00:00.000Z',
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].text, 'Message through the hub');
  assert.deepEqual(received[0].source, {
    sourceId: 'twitch:monstercat',
    platform: 'twitch',
    broadcasterName: undefined,
    channelLabel: 'monstercat',
  });

  await hub.stop();
});

test('preserves a source supplied by the connector', () => {
  const connector = createTestConnector({ channel: 'monstercat' });
  const hub = createChatHub({ connectors: [connector] });
  const received = [];

  hub.onMessage((message) => received.push(message));
  connector.emitMessage({
    id: 'hub-1',
    platform: 'twitch',
    source: {
      sourceId: 'twitch:special-event',
      platform: 'twitch',
      broadcasterName: 'Special Event',
    },
    author: { id: 'author-1', name: 'Ana' },
    text: 'Message through the hub',
    timestamp: '2026-06-04T20:00:00.000Z',
  });

  assert.equal(received[0].source.sourceId, 'twitch:special-event');
  assert.equal(received[0].source.broadcasterName, 'Special Event');
});

test('tracks connector statuses and message counts', async () => {
  const connector = createTestConnector();
  const hub = createChatHub({ connectors: [connector] });
  const statuses = [];

  hub.onStatus((status) => statuses.push(status));

  await hub.start();
  connector.emitMessage({
    id: 'hub-1',
    platform: 'twitch',
    author: { id: 'author-1', name: 'Ana' },
    text: 'Message through the hub',
    timestamp: '2026-06-04T20:00:00.000Z',
  });

  assert.equal(hub.getStatuses()[0].state, 'connected');
  assert.equal(hub.getStatuses()[0].messageCount, 1);
  assert.equal(statuses.at(-1).lastMessageAt, '2026-06-04T20:00:00.000Z');

  await hub.stop();
});

test('tracks connector errors without throwing', () => {
  const connector = createTestConnector();
  const hub = createChatHub({ connectors: [connector] });

  connector.emitError(new Error('resolver blocked'));

  assert.equal(hub.getStatuses()[0].state, 'error');
  assert.equal(hub.getStatuses()[0].error, 'resolver blocked');
});

test('allows duplicate connector platforms with different sources', async () => {
  const first = createTestConnector({ channel: 'streamer-a' });
  const second = createTestConnector({ channel: 'streamer-b' });
  const hub = createChatHub({ connectors: [first, second] });

  assert.deepEqual(
    hub.getStatuses().map(({ source }) => source.sourceId),
    ['twitch:streamer-a', 'twitch:streamer-b'],
  );

  await hub.stop();
});

test('rejects duplicate connector sources', () => {
  assert.throws(
    () =>
      createChatHub({
        connectors: [
          createTestConnector({ channel: 'streamer-a' }),
          createTestConnector({ channel: 'streamer-a' }),
        ],
      }),
    /already registered/,
  );
});

test('sends a message through one registered connector', async () => {
  const sent = [];
  const connector = createTestConnector({
    sendImpl: async (text) => {
      sent.push(text);
    },
  });
  const hub = createChatHub({ connectors: [connector] });

  const result = await hub.sendMessage({
    platform: ' twitch ',
    text: ' hello chat ',
  });

  assert.deepEqual(sent, ['hello chat']);
  assert.equal(result.platform, 'twitch');
  assert.equal(result.text, 'hello chat');
  assert.match(result.sentAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('rejects sends to inactive connectors', async () => {
  const hub = createChatHub();

  await assert.rejects(
    () => hub.sendMessage({ platform: 'kick', text: 'hello' }),
    /not active/,
  );
});

test('tracks connector send failures as status errors', async () => {
  const connector = createTestConnector({
    sendImpl: async () => {
      throw new Error('write disabled');
    },
  });
  const hub = createChatHub({ connectors: [connector] });

  await assert.rejects(
    () => hub.sendMessage({ platform: 'twitch', text: 'hello' }),
    /write disabled/,
  );

  assert.equal(hub.getStatuses()[0].state, 'error');
  assert.equal(hub.getStatuses()[0].error, 'write disabled');
});

test('replaces one connector without disconnecting other platforms', async () => {
  const disconnected = [];
  const sent = [];
  const twitch = createTestConnector({
    platform: 'twitch',
    onDisconnect: async () => disconnected.push('old-twitch'),
  });
  const x = createTestConnector({
    platform: 'x',
    onDisconnect: async () => disconnected.push('x'),
  });
  const replacementTwitch = createTestConnector({
    platform: 'twitch',
    sendImpl: async (text) => sent.push(text),
  });
  const hub = createChatHub({ connectors: [twitch, x] });

  await hub.start();
  await hub.replaceConnector(replacementTwitch);
  await hub.sendMessage({ platform: 'twitch', text: 'new token send' });

  assert.deepEqual(disconnected, ['old-twitch']);
  assert.deepEqual(sent, ['new token send']);

  await hub.stop();
});

test('adds platform sources without blocking or disconnecting existing sources', async () => {
  let slowStarted = false;
  let oldDisconnected = false;
  const received = [];
  const existing = createTestConnector({
    channel: 'streamer-a',
    onDisconnect: async () => {
      oldDisconnected = true;
    },
  });
  const slow = createTestConnector({
    channel: 'streamer-b',
    onConnect: async () => {
      slowStarted = true;
      await new Promise(() => {});
    },
  });
  const hub = createChatHub({ connectors: [existing] });

  hub.onMessage((message) => received.push(message));
  await hub.start();
  await hub.replacePlatformConnectors('twitch', [existing, slow]);
  existing.emitMessage({
    id: 'hub-2',
    platform: 'twitch',
    author: { id: 'author-1', name: 'Ana' },
    text: 'still live',
    timestamp: '2026-06-04T20:00:00.000Z',
  });

  assert.equal(slowStarted, true);
  assert.equal(oldDisconnected, false);
  assert.equal(received[0].text, 'still live');
  assert.equal(received[0].source.sourceId, 'twitch:streamer-a');
});
