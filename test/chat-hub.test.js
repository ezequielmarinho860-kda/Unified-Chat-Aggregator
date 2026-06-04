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
    emitMessage: (message) => events.emit('message', message),
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

test('rejects duplicate connector platforms', () => {
  const connector = createTestConnector();

  assert.throws(
    () => createChatHub({ connectors: [connector, createTestConnector()] }),
    /already registered/,
  );
});
