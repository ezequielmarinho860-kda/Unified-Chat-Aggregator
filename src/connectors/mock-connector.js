const { EventEmitter } = require('node:events');
const { normalizeChatMessage } = require('../chat-message');

const MOCK_AUTHORS = [
  { id: 'mock-ana', name: 'Ana' },
  { id: 'mock-bruno', name: 'Bruno' },
  { id: 'mock-camila', name: 'Camila' },
  { id: 'mock-diego', name: 'Diego' },
];

const MOCK_TEXTS = [
  'Twitch e Kick vao cair no mesmo feed?',
  'Esse dashboard ja parece app desktop.',
  'Mensagem falsa chegando pelo IPC.',
  'Quando entrar o X, esse pipe ja vai estar pronto.',
];

const createMockConnector = ({ intervalMs = 2200 } = {}) => {
  const events = new EventEmitter();
  let timer = null;
  let sequence = 0;

  const emitMessage = (text) => {
    const author = MOCK_AUTHORS[sequence % MOCK_AUTHORS.length];
    const messageText = text ?? MOCK_TEXTS[sequence % MOCK_TEXTS.length];
    sequence += 1;

    events.emit(
      'message',
      normalizeChatMessage({
        id: `mock-${Date.now()}-${sequence}`,
        platform: 'mock',
        author,
        text: messageText,
        timestamp: new Date().toISOString(),
        raw: { source: 'mock-connector', sequence },
      }),
    );
  };

  return {
    platform: 'mock',
    onMessage: (listener) => {
      events.on('message', listener);
      return () => events.off('message', listener);
    },
    connect: async () => {
      if (timer) {
        return;
      }

      emitMessage('Mock connector conectado.');
      timer = setInterval(emitMessage, intervalMs);
    },
    disconnect: async () => {
      if (!timer) {
        return;
      }

      clearInterval(timer);
      timer = null;
    },
    send: async (text) => {
      emitMessage(`[eco local] ${text}`);
    },
  };
};

module.exports = {
  createMockConnector,
};
