const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applyBttvEmotesToFragments,
  parseTwitchIrcLine,
  parseTwitchBadges,
  parseTwitchEmoteFragments,
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
    '@badge-info=;badges=broadcaster/1,moderator/1,subscriber/12;color=#8A2BE2;display-name=Streamer;id=message-1;tmi-sent-ts=1780603200000;user-id=user-1 :streamer!streamer@streamer.tmi.twitch.tv PRIVMSG #channel :real message',
    {
      badgeCatalog: {
        subscriber: {
          12: {
            label: 'Subscriber',
            imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/sub/2',
          },
        },
      },
    },
  );

  assert.equal(message.id, 'message-1');
  assert.equal(message.platform, 'twitch');
  assert.equal(message.author.id, 'user-1');
  assert.equal(message.author.name, 'Streamer');
  assert.deepEqual(message.author.badges, [
    { id: 'broadcaster', label: 'Broadcaster', version: '1', imageUrl: undefined },
    { id: 'moderator', label: 'Mod', version: '1', imageUrl: undefined },
    {
      id: 'subscriber',
      label: 'Subscriber',
      version: '12',
      imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/sub/2',
    },
  ]);
  assert.equal(message.text, 'real message');
  assert.equal(message.timestamp, '2026-06-04T20:00:00.000Z');
});

test('parses Twitch badges from IRC tags', () => {
  assert.deepEqual(parseTwitchBadges('vip/1,premium/1,unknown/3'), [
    { id: 'vip', label: 'VIP', version: '1', imageUrl: undefined },
    { id: 'premium', label: 'Prime', version: '1', imageUrl: undefined },
    { id: 'unknown', label: 'unknown', version: '3', imageUrl: undefined },
  ]);
});

test('parses Twitch emotes into message fragments', () => {
  const message = parseTwitchPrivmsg(
    '@display-name=Ana;emotes=25:0-4,12-16/1902:6-10;id=message-1;tmi-sent-ts=1780603200000;user-id=user-1 :ana!ana@ana.tmi.twitch.tv PRIVMSG #channel :Kappa Keepo Kappa',
  );

  assert.deepEqual(message.fragments, [
    {
      type: 'emote',
      id: '25',
      text: 'Kappa',
      imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0',
    },
    { type: 'text', text: ' ' },
    {
      type: 'emote',
      id: '1902',
      text: 'Keepo',
      imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/1902/default/dark/2.0',
    },
    { type: 'text', text: ' ' },
    {
      type: 'emote',
      id: '25',
      text: 'Kappa',
      imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0',
    },
  ]);
});

test('falls back to text fragments when Twitch emotes are missing', () => {
  assert.deepEqual(parseTwitchEmoteFragments('hello chat', ''), [
    { type: 'text', text: 'hello chat' },
  ]);
});

test('parses BetterTTV emotes only from remaining text fragments', () => {
  assert.deepEqual(
    applyBttvEmotesToFragments(
      [
        { type: 'text', text: 'OMEGALUL ' },
        {
          type: 'emote',
          id: '25',
          text: 'Kappa',
          imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0',
        },
      ],
      {
        OMEGALUL: {
          id: 'bttv-1',
          imageUrl: 'https://cdn.betterttv.net/emote/bttv-1/2x',
        },
        Kappa: {
          id: 'bttv-2',
          imageUrl: 'https://cdn.betterttv.net/emote/bttv-2/2x',
        },
      },
    ),
    [
      {
        type: 'emote',
        id: 'bttv:bttv-1',
        text: 'OMEGALUL',
        imageUrl: 'https://cdn.betterttv.net/emote/bttv-1/2x',
      },
      { type: 'text', text: ' ' },
      {
        type: 'emote',
        id: '25',
        text: 'Kappa',
        imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0',
      },
    ],
  );
});

test('ignores non chat commands', () => {
  assert.equal(parseTwitchPrivmsg(':tmi.twitch.tv PONG :tmi.twitch.tv'), undefined);
});
