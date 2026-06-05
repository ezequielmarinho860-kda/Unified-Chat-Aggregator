const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { createChatHub } = require('../src/chat-hub');

const createTestConnector = () => {
  const events = new EventEmitter();

  return {
    platform: 'mock',
    connect: async () => {},
    disconnect: async () => {},
    send: async (_text) => {},
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
  const connector = createTestConnector();
  const hub = createChatHub({ connectors: [connector] });
  const received = [];

  hub.onMessage((message) => received.push(message));

  connector.emitMessage({
    id: 'hub-1',
    platform: 'mock',
    author: { id: 'author-1', name: 'Ana' },
    text: 'Mensagem pelo hub',
    timestamp: '2026-06-04T20:00:00.000Z',
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].text, 'Mensagem pelo hub');

  await hub.stop();
});

test('tracks connector statuses and message counts', async () => {
  const connector = createTestConnector();
  const hub = createChatHub({ connectors: [connector] });
  const statuses = [];

  hub.onStatus((status) => statuses.push(status));

  await hub.start();
  connector.emitMessage({
    id: 'hub-1',
    platform: 'mock',
    author: { id: 'author-1', name: 'Ana' },
    text: 'Mensagem pelo hub',
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

test('rejects duplicate connector platforms', () => {
  const connector = createTestConnector();

  assert.throws(
    () => createChatHub({ connectors: [connector, createTestConnector()] }),
    /already registered/,
  );
});
