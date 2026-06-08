const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createPublicViewerSources,
  normalizeKickChannel,
  normalizeTwitchPlayerChannel,
  normalizeXWatchUrl,
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
    'twitch:monstercat': {
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

test('adds multiple public sources for the same platform', () => {
  const sources = createPublicViewerSources({
    connectors: {
      twitch: {
        enabled: true,
        sources: [
          { enabled: true, channel: 'Monstercat' },
          { enabled: true, channel: 'ESL_SC2' },
        ],
      },
    },
  });

  assert.equal(sources['twitch:monstercat'].watchUrl, 'https://www.twitch.tv/monstercat');
  assert.equal(sources['twitch:esl_sc2'].watchUrl, 'https://www.twitch.tv/esl_sc2');
});

test('adds public fallback URLs for non Twitch sources without player config', () => {
  const sources = createPublicViewerSources({
    connectors: {
      twitch: { enabled: false },
      kick: { enabled: true, channel: 'https://kick.com/xqc', accessToken: 'secret' },
      x: { enabled: true, liveUrl: '@chooserich' },
    },
  });

  assert.equal(sources['kick:xqc'].watchUrl, 'https://kick.com/xqc');
  assert.equal(sources['kick:xqc'].player, undefined);
  assert.equal(sources['x:chooserich'].watchUrl, 'https://x.com/chooserich/live');
  assert.equal(sources['x:chooserich'].player, undefined);
  assert.doesNotMatch(JSON.stringify(sources), /secret|accessToken/);
});

test('normalizes Twitch player channels for embeds', () => {
  assert.equal(normalizeTwitchPlayerChannel('#Monstercat'), 'monstercat');
  assert.equal(normalizeTwitchPlayerChannel('  HasanAbi  '), 'hasanabi');
  assert.equal(normalizeTwitchPlayerChannel(''), undefined);
});

test('normalizes fallback watch URLs', () => {
  assert.equal(normalizeKickChannel('https://kick.com/JonVlogs'), 'JonVlogs');
  assert.equal(normalizeKickChannel('@xqc'), 'xqc');
  assert.equal(normalizeXWatchUrl('https://x.com/chooserich/live'), 'https://x.com/chooserich/live');
  assert.equal(normalizeXWatchUrl('@chooserich'), 'https://x.com/chooserich/live');
  assert.equal(normalizeXWatchUrl('https://example.com/live'), undefined);
});
