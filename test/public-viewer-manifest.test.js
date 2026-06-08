const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_PUBLIC_VIEWER_TITLE,
  createPublicViewerManifestContext,
  normalizePublicViewerManifest,
} = require('../src/public-viewer-manifest');

test('creates a validated public viewer manifest context from runtime config', () => {
  const { manifest, sources } = createPublicViewerManifestContext({
    title: 'MarketBubble Demo',
    config: {
      connectors: {
        twitch: {
          enabled: true,
          channel: 'Monstercat',
          accessToken: 'secret-token',
        },
        kick: {
          enabled: true,
          channel: 'xqc',
          clientSecret: 'secret-client',
        },
        x: {
          enabled: false,
          liveUrl: 'https://x.com/chooserich/live',
        },
      },
    },
  });

  assert.equal(manifest.title, 'MarketBubble Demo');
  assert.equal(manifest.sources.length, 2);
  assert.equal(manifest.sources[0].sourceId, 'twitch:monstercat');
  assert.deepEqual(manifest.sources[0].player, {
    provider: 'twitch',
    channel: 'monstercat',
  });
  assert.equal(sources['twitch:monstercat'].sourceId, 'twitch:monstercat');
  assert.equal(sources['kick:xqc'].watchUrl, 'https://kick.com/xqc');
  assert.doesNotMatch(JSON.stringify(manifest), /secret|accessToken|clientSecret/);
});

test('keeps duplicate platform sources separated by source id', () => {
  const { manifest, sources } = createPublicViewerManifestContext({
    config: {
      connectors: {
        x: {
          enabled: true,
          sources: [
            { enabled: true, liveUrl: '@streamerA' },
            { enabled: true, liveUrl: '@streamerB' },
          ],
        },
      },
    },
  });

  assert.deepEqual(
    manifest.sources.map((source) => source.sourceId),
    ['x:streamera', 'x:streamerb'],
  );
  assert.equal(sources['x:streamera'].channelLabel, '@streamerA');
  assert.equal(sources['x:streamerb'].channelLabel, '@streamerB');
});

test('normalizes manifest by allowlist', () => {
  const manifest = normalizePublicViewerManifest({
    title: '  Demo  ',
    secret: 'manifest-secret',
    sources: [
      {
        sourceId: 'twitch:demo',
        platform: 'twitch',
        channelLabel: ' demo ',
        accessToken: 'source-secret',
        watchUrl: 'https://www.twitch.tv/demo',
        player: {
          provider: 'twitch',
          channel: 'demo',
          clientSecret: 'player-secret',
        },
      },
    ],
  });

  assert.deepEqual(manifest, {
    title: 'Demo',
    sources: [
      {
        sourceId: 'twitch:demo',
        platform: 'twitch',
        channelLabel: 'demo',
        watchUrl: 'https://www.twitch.tv/demo',
        player: {
          provider: 'twitch',
          channel: 'demo',
        },
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(manifest), /secret|accessToken|clientSecret/);
});

test('uses a default title and rejects unsafe manifest fields', () => {
  assert.equal(normalizePublicViewerManifest().title, DEFAULT_PUBLIC_VIEWER_TITLE);
  assert.throws(
    () =>
      normalizePublicViewerManifest({
        sources: [{ sourceId: 'kick:xqc', platform: 'kick', watchUrl: 'file:///secret' }],
      }),
    /must be an HTTP URL/,
  );
  assert.throws(
    () =>
      normalizePublicViewerManifest({
        sources: [
          {
            sourceId: 'kick:xqc',
            platform: 'kick',
            player: { provider: 'kick', channel: 'xqc' },
          },
        ],
      }),
    /provider must be twitch/,
  );
});
