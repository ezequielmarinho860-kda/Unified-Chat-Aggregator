const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseTwitchIrcLine,
  parseTwitchPrivmsg,
} = require('../src/connectors/twitch-irc-parser');

test('parses IRC tags, prefix, command, params and trailing text', () => {
  const parsed = parseTwitchIrcLine(
    '@display-name=Ana\\sMaria;id=abc :ana!ana@ana.tmi.twitch.tv PRIVMSG #channel :hello chat',
  );

  assert.equal(parsed.tags['display-name'], 'Ana Maria');
  assert.equal(parsed.tags.id, 'abc');
  assert.equal(parsed.prefix, 'ana!ana@ana.tmi.twitch.tv');
  assert.equal(parsed.command, 'PRIVMSG');
  assert.deepEqual(parsed.params, ['#channel']);
  assert.equal(parsed.trailing, 'hello chat');
});

test('converts Twitch PRIVMSG into the canonical chat message model', () => {
  const message = parseTwitchPrivmsg(
    '@badge-info=;badges=;color=#8A2BE2;display-name=Streamer;id=message-1;tmi-sent-ts=1780603200000;user-id=user-1 :streamer!streamer@streamer.tmi.twitch.tv PRIVMSG #channel :real message',
  );

  assert.equal(message.id, 'message-1');
  assert.equal(message.platform, 'twitch');
  assert.equal(message.author.id, 'user-1');
  assert.equal(message.author.name, 'Streamer');
  assert.equal(message.text, 'real message');
  assert.equal(message.timestamp, '2026-06-04T20:00:00.000Z');
});

test('ignores non chat commands', () => {
  assert.equal(parseTwitchPrivmsg(':tmi.twitch.tv PONG :tmi.twitch.tv'), undefined);
});
