const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeKickChannelName,
  resolveKickChannel,
} = require('../src/connectors/kick-resolver');

const createJsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});

test('normalizes Kick channel slugs', () => {
  assert.equal(normalizeKickChannelName(' @XQC '), 'xqc');
});

test('normalizes Kick channel URLs', () => {
  assert.equal(normalizeKickChannelName('https://kick.com/XQC?ref=chat'), 'xqc');
  assert.equal(normalizeKickChannelName('kick.com/XQC'), 'xqc');
});

test('resolves chatroom id from the channel endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return createJsonResponse({
      id: 605185,
      chatroom: { id: 12345 },
    });
  };

  const resolved = await resolveKickChannel({ channel: 'xqc', fetchImpl });

  assert.equal(resolved.channel, 'xqc');
  assert.equal(resolved.channelId, '605185');
  assert.equal(resolved.chatroomId, '12345');
  assert.equal(calls.length, 1);
});

test('falls back to the chatroom endpoint when channel payload has no chatroom', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);

    if (calls.length === 1) {
      return createJsonResponse({ id: 605185 });
    }

    return createJsonResponse({ id: 54321, channel_id: 605185 });
  };

  const resolved = await resolveKickChannel({ channel: 'xqc', fetchImpl });

  assert.equal(resolved.channelId, '605185');
  assert.equal(resolved.chatroomId, '54321');
  assert.equal(calls.length, 2);
});

test('throws when Kick blocks the resolver request', async () => {
  const fetchImpl = async () => createJsonResponse({}, { ok: false, status: 403 });

  await assert.rejects(
    () => resolveKickChannel({ channel: 'xqc', fetchImpl }),
    /403/,
  );
});
