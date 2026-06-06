const assert = require('node:assert/strict');
const test = require('node:test');
const {
  resolveKickChatroomForConfig,
} = require('../src/connectors/kick-config-resolver');

const createConfig = ({ channel = 'xqc', chatroomId = '123', enabled = true } = {}) => ({
  connectors: {
    kick: { enabled, channel, chatroomId },
    twitch: { enabled: true, channel: 'monstercat' },
  },
});

test('resolves and persists the Kick chatroom when the channel changes', async () => {
  const config = createConfig({ channel: 'new-channel', chatroomId: '' });
  const resolved = await resolveKickChatroomForConfig({
    config,
    previousConfig: createConfig(),
    resolveChannel: async ({ channel }) => ({
      channel,
      chatroomId: '999',
    }),
  });

  assert.equal(resolved.connectors.kick.channel, 'new-channel');
  assert.equal(resolved.connectors.kick.chatroomId, '999');
  assert.equal(resolved.connectors.twitch, config.connectors.twitch);
});

test('keeps the saved Kick chatroom when the channel is unchanged', async () => {
  const config = createConfig();
  let resolverCalled = false;
  const resolved = await resolveKickChatroomForConfig({
    config,
    previousConfig: createConfig(),
    resolveChannel: async () => {
      resolverCalled = true;
    },
  });

  assert.equal(resolved, config);
  assert.equal(resolverCalled, false);
});

test('does not resolve a disabled Kick connector', async () => {
  const config = createConfig({ channel: 'new-channel', chatroomId: '', enabled: false });
  const resolved = await resolveKickChatroomForConfig({
    config,
    previousConfig: createConfig(),
    resolveChannel: async () => {
      throw new Error('resolver should not run');
    },
  });

  assert.equal(resolved, config);
});
