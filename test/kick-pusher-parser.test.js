const assert = require('node:assert/strict');
const test = require('node:test');
const {
  KICK_CHAT_MESSAGE_EVENT,
  parseKickPusherEnvelope,
} = require('../src/connectors/kick-pusher-parser');

test('parses Kick Pusher chat message events into canonical messages', () => {
  const parsed = parseKickPusherEnvelope(
    JSON.stringify({
      event: KICK_CHAT_MESSAGE_EVENT,
      data: JSON.stringify({
        id: 'message-1',
        chatroom_id: 12345,
        content: 'ola kick',
        created_at: '2026-06-04T20:00:00.000Z',
        sender: {
          id: 99,
          username: 'Streamer',
          profile_pic: 'https://example.com/avatar.png',
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
  assert.equal(parsed.message.text, 'ola kick');
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
