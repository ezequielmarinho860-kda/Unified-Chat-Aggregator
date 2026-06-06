const assert = require('node:assert/strict');
const test = require('node:test');
const { createConnectorSource } = require('../src/source-identity');

test('creates source identity from a connector channel', () => {
  assert.deepEqual(
    createConnectorSource({
      platform: 'twitch',
      channel: 'Monstercat',
    }),
    {
      sourceId: 'twitch:monstercat',
      platform: 'twitch',
      channelLabel: 'Monstercat',
    },
  );
});

test('creates source identity from an X handle URL', () => {
  assert.deepEqual(
    createConnectorSource({
      platform: 'x',
      liveUrl: 'https://x.com/chooserich/livechat',
    }),
    {
      sourceId: 'x:chooserich',
      platform: 'x',
      channelLabel: '@chooserich',
    },
  );
});

test('creates stable source identity from an X broadcast URL without inventing a label', () => {
  const broadcastSource = createConnectorSource({
    platform: 'x',
    liveUrl: 'https://x.com/i/broadcasts/123',
  });
  const chatSource = createConnectorSource({
    platform: 'x',
    liveUrl: 'https://x.com/i/broadcasts/123/chat',
  });

  assert.deepEqual(chatSource, {
    sourceId: 'x:broadcast-123',
    platform: 'x',
  });
  assert.deepEqual(broadcastSource, chatSource);
});

test('returns no source when a connector has no channel or live URL', () => {
  assert.equal(createConnectorSource({ platform: 'twitch' }), undefined);
});
