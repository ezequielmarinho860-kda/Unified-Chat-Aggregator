const assert = require('node:assert/strict');
const test = require('node:test');
const {
  KICK_CHAT_MESSAGE_EVENT,
  KICK_GLOBAL_BADGE_IMAGE_URLS,
  normalizeKickBadges,
  parseKickEmoteFragments,
  parseKickPusherEnvelope,
} = require('../src/connectors/kick-pusher-parser');

test('parses Kick Pusher chat message events into canonical messages', () => {
  const parsed = parseKickPusherEnvelope(
    JSON.stringify({
      event: KICK_CHAT_MESSAGE_EVENT,
      data: JSON.stringify({
        id: 'message-1',
        chatroom_id: 12345,
        content: 'hello kick',
        created_at: '2026-06-04T20:00:00.000Z',
        sender: {
          id: 99,
          username: 'Streamer',
          profile_pic: 'https://example.com/avatar.png',
          badges: ['moderator', 'subscriber'],
        },
      }),
    }),
  );

  assert.equal(parsed.type, 'message');
  assert.equal(parsed.message.id, 'message-1');
  assert.equal(parsed.message.platform, 'kick');
  assert.equal(parsed.message.author.id, '99');
  assert.equal(parsed.message.author.name, 'Streamer');
  assert.equal(parsed.message.author.avatarUrl, 'https://example.com/avatar.png');
  assert.deepEqual(parsed.message.author.badges, [
    {
      id: 'moderator',
      label: 'Mod',
      version: undefined,
      imageUrl: KICK_GLOBAL_BADGE_IMAGE_URLS.moderator,
    },
    {
      id: 'subscriber',
      label: 'Sub',
      version: undefined,
      imageUrl: KICK_GLOBAL_BADGE_IMAGE_URLS.subscriber,
    },
  ]);
  assert.equal(parsed.message.text, 'hello kick');
});

test('parses Kick markup emotes into message fragments', () => {
  const parsed = parseKickPusherEnvelope(
    JSON.stringify({
      event: KICK_CHAT_MESSAGE_EVENT,
      data: JSON.stringify({
        id: 'message-1',
        content: 'hello [emote:123:kickpog]',
        sender: { id: 99, username: 'Streamer' },
      }),
    }),
  );

  assert.equal(parsed.message.text, 'hello kickpog');
  assert.deepEqual(parsed.message.fragments, [
    { type: 'text', text: 'hello ' },
    {
      type: 'emote',
      id: '123',
      text: 'kickpog',
      imageUrl: 'https://files.kick.com/emotes/123/fullsize',
    },
  ]);
});

test('parses Kick named emotes from payload metadata', () => {
  const parsed = parseKickPusherEnvelope(
    JSON.stringify({
      event: KICK_CHAT_MESSAGE_EVENT,
      data: JSON.stringify({
        id: 'message-1',
        content: ':kickpog: hello kickpog',
        emotes: [{ id: 123, name: 'kickpog' }],
        sender: { id: 99, username: 'Streamer' },
      }),
    }),
  );

  assert.deepEqual(parsed.message.fragments, [
    {
      type: 'emote',
      id: '123',
      text: 'kickpog',
      imageUrl: 'https://files.kick.com/emotes/123/fullsize',
    },
    { type: 'text', text: ' hello ' },
    {
      type: 'emote',
      id: '123',
      text: 'kickpog',
      imageUrl: 'https://files.kick.com/emotes/123/fullsize',
    },
  ]);
  assert.deepEqual(parseKickEmoteFragments('hello kick', []), [
    { type: 'text', text: 'hello kick' },
  ]);
});

test('normalizes Kick badge objects with images', () => {
  const badges = normalizeKickBadges({
    sender: {
      badges: [
        {
          id: 'vip',
          name: 'VIP',
          imageUrl: 'https://files.kick.com/badges/vip.webp',
        },
        {
          type: 'og',
          title: 'OG',
          image_url: 'https://files.kick.com/badges/og.webp',
        },
      ],
    },
  });

  assert.deepEqual(badges, [
    {
      id: 'vip',
      label: 'VIP',
      version: undefined,
      imageUrl: 'https://files.kick.com/badges/vip.webp',
    },
    {
      id: 'og',
      label: 'OG',
      version: undefined,
      imageUrl: 'https://files.kick.com/badges/og.webp',
    },
  ]);
});

test('derives fallback Kick badges from sender role flags', () => {
  const badges = normalizeKickBadges({
    sender: {
      role: 'moderator',
      is_subscribed: true,
      is_verified: true,
    },
  });

  assert.deepEqual(badges, [
    {
      id: 'moderator',
      label: 'Mod',
      version: undefined,
      imageUrl: KICK_GLOBAL_BADGE_IMAGE_URLS.moderator,
    },
    {
      id: 'subscriber',
      label: 'Sub',
      version: undefined,
      imageUrl: KICK_GLOBAL_BADGE_IMAGE_URLS.subscriber,
    },
    {
      id: 'verified',
      label: 'Verified',
      version: undefined,
      imageUrl: KICK_GLOBAL_BADGE_IMAGE_URLS.verified,
    },
  ]);
});

test('normalizes Kick numeric chat level badges', () => {
  const badges = normalizeKickBadges({
    sender: {
      chatroom_level: 14,
    },
  });

  assert.deepEqual(badges, [
    { id: 'level-14', label: '14', version: '14', imageUrl: undefined },
  ]);
});

test('normalizes numeric Kick badges from badge collections', () => {
  const badges = normalizeKickBadges({
    sender_badges: ['10', 'moderator'],
  });

  assert.deepEqual(badges, [
    { id: 'level-10', label: '10', version: '10', imageUrl: undefined },
    {
      id: 'moderator',
      label: 'Mod',
      version: undefined,
      imageUrl: KICK_GLOBAL_BADGE_IMAGE_URLS.moderator,
    },
  ]);
});

test('parses Pusher ping envelopes', () => {
  const parsed = parseKickPusherEnvelope(
    JSON.stringify({ event: 'pusher:ping', data: {} }),
  );

  assert.deepEqual(parsed, { type: 'ping' });
});

test('ignores non-chat Pusher events', () => {
  const parsed = parseKickPusherEnvelope(
    JSON.stringify({ event: 'pusher:connection_established', data: '{}' }),
  );

  assert.equal(parsed, undefined);
});
