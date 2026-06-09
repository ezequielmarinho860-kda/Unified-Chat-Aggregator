const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  createBackendConnectorsFromBrowserConfig,
  createBrowserBackendExternalConnectors,
} = require('../src/browser-backend/external-connectors');

const createFakeConnectorFactory = (platform, createdConnectors) => ({ channel }) => {
  const events = new EventEmitter();
  const connector = {
    platform,
    channel,
    disconnected: false,
    async connect() {},
    async disconnect() {
      connector.disconnected = true;
    },
    emitMessage(message = {}) {
      events.emit('message', {
        id: `${platform}-message-1`,
        platform,
        source: {
          sourceId: `${platform}:${channel.toLowerCase()}`,
          platform,
          channelLabel: channel,
        },
        author: { id: 'author-1', name: 'Ana', badges: [] },
        text: 'hello backend',
        timestamp: '2026-06-09T12:00:00.000Z',
        ...message,
      });
    },
    onMessage(listener) {
      events.on('message', listener);
      return () => events.off('message', listener);
    },
    async send() {},
  };

  createdConnectors.push(connector);
  return connector;
};

test('builds backend Twitch and Kick connectors from browser admin config', () => {
  const connectors = createBackendConnectorsFromBrowserConfig(
    {
      sources: {
        kick: [{ channel: 'xqc', enabled: true }],
        twitch: [
          { channel: 'Monstercat', enabled: true },
          { channel: 'ESL_SC2', enabled: false },
        ],
        x: [{ enabled: true, liveUrl: '@chooserich' }],
      },
    },
    {
      createKick: ({ channel }) => ({ platform: 'kick', channel }),
      createTwitch: ({ channel }) => ({ platform: 'twitch', channel }),
    },
  );

  assert.deepEqual(
    connectors.map((connector) => `${connector.platform}:${connector.channel}`),
    ['twitch:Monstercat', 'kick:xqc'],
  );
});

test('publishes public backend connector status and chat events', async () => {
  const connectors = [];
  const events = [];
  const service = createBrowserBackendExternalConnectors({
    createKick: createFakeConnectorFactory('kick', connectors),
    createTwitch: createFakeConnectorFactory('twitch', connectors),
    onEvent: (event) => events.push(event),
  });

  await service.applyConfig({
    sources: {
      twitch: [{ channel: 'Monstercat', enabled: true }],
    },
  });
  connectors[0].emitMessage();
  await service.applyConfig({
    sources: {
      kick: [{ channel: 'xqc', enabled: true }],
    },
  });

  assert.equal(connectors[0].disconnected, true);
  assert.equal(connectors[1].platform, 'kick');
  assert.ok(events.some((event) => event.type === 'source.status'));

  const messageEvent = events.find((event) => event.type === 'chat.message');

  assert.equal(messageEvent.data.source.sourceId, 'twitch:monstercat');
  assert.equal(messageEvent.data.text, 'hello backend');
  assert.doesNotMatch(JSON.stringify(messageEvent), /accessToken|secret/);

  await service.stop();
  assert.equal(connectors[1].disconnected, true);
});
