const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createPublicViewerSources,
  normalizeTwitchPlayerChannel,
} = require('../src/public-viewer-sources');

test('adds public Twitch player config without credentials', () => {
  const sources = createPublicViewerSources({
    connectors: {
      twitch: {
        enabled: true,
        channel: '#Monstercat',
        accessToken: 'secret-token',
      },
      kick: { enabled: false, channel: 'xqc' },
      x: { enabled: false, liveUrl: 'https://x.com/example/live' },
    },
  });

  assert.deepEqual(sources, {
    twitch: {
      sourceId: 'twitch:monstercat',
      platform: 'twitch',
      channelLabel: 'monstercat',
      watchUrl: 'https://www.twitch.tv/monstercat',
      player: {
        provider: 'twitch',
        channel: 'monstercat',
      },
    },
  });
  assert.doesNotMatch(JSON.stringify(sources), /secret|accessToken/);
});

test('keeps non Twitch sources playerless', () => {
  const sources = createPublicViewerSources({
    connectors: {
      twitch: { enabled: false },
      kick: { enabled: true, channel: 'xqc' },
      x: { enabled: true, liveUrl: 'https://x.com/chooserich/live' },
    },
  });

  assert.equal(sources.kick.player, undefined);
  assert.equal(sources.x.player, undefined);
});

test('normalizes Twitch player channels for embeds', () => {
  assert.equal(normalizeTwitchPlayerChannel('#Monstercat'), 'monstercat');
  assert.equal(normalizeTwitchPlayerChannel('  HasanAbi  '), 'hasanabi');
  assert.equal(normalizeTwitchPlayerChannel(''), undefined);
});
