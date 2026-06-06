const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  createIdentityFromMessageAuthor,
  createLoggedIdentity,
  doesMessageMentionIdentity,
  isMessageFromIdentity,
  splitTextByMention,
} = require('../src/message-highlights');

test('creates a normalized identity only for connected accounts', () => {
  assert.equal(createLoggedIdentity({ connected: false, login: 'sender' }), undefined);
  assert.deepEqual(
    createLoggedIdentity({
      connected: true,
      userId: ' User-1 ',
      login: '@Sender',
      displayName: 'Sender Name',
    }),
    {
      id: 'user-1',
      login: 'sender',
      displayName: 'sender name',
    },
  );
});

test('matches own messages by provider id or account login', () => {
  const identity = createLoggedIdentity({
    connected: true,
    userId: 'user-1',
    login: 'sender',
  });

  assert.equal(
    isMessageFromIdentity({ author: { id: 'user-1', name: 'Different Name' } }, identity),
    true,
  );
  assert.equal(
    isMessageFromIdentity({ author: { id: 'sender', name: 'Sender' } }, identity),
    true,
  );
  assert.equal(
    isMessageFromIdentity({ author: { id: 'other', name: 'Other' } }, identity),
    false,
  );
});

test('matches exact case-insensitive account mentions without matching longer handles', () => {
  const identity = createLoggedIdentity({
    connected: true,
    userId: '1234',
    login: 'Cat_Bot',
  });

  assert.equal(
    doesMessageMentionIdentity({ text: 'Hey @cat_bot, look here' }, identity),
    true,
  );
  assert.equal(
    doesMessageMentionIdentity({ text: 'Not @cat_bot_extra' }, identity),
    false,
  );
  assert.equal(
    doesMessageMentionIdentity({ text: 'mail@cat_bot.example' }, identity),
    false,
  );
  assert.equal(doesMessageMentionIdentity({ text: 'Not the handle @1234' }, identity), false);
});

test('learns a normalized X identity from an echoed own message', () => {
  assert.deepEqual(
    createIdentityFromMessageAuthor({
      author: { id: '@LoggedXUser', name: 'Logged X User' },
    }),
    {
      id: 'loggedxuser',
      login: 'loggedxuser',
      displayName: 'logged x user',
    },
  );
});

test('splits exact connected account mentions for inline highlighting', () => {
  const identities = [
    createLoggedIdentity({ connected: true, login: 'jugger2187' }),
    createLoggedIdentity({ connected: true, login: 'cat_bot' }),
  ];

  assert.deepEqual(splitTextByMention('Oi @jugger2187 e @CAT_BOT!', identities), [
    { type: 'text', text: 'Oi ' },
    { type: 'mention', text: '@jugger2187' },
    { type: 'text', text: ' e ' },
    { type: 'mention', text: '@CAT_BOT' },
    { type: 'text', text: '!' },
  ]);
});

test('does not split longer or embedded account handles', () => {
  const identities = [createLoggedIdentity({ connected: true, login: 'cat_bot' })];

  assert.deepEqual(splitTextByMention('@cat_bot_extra mail@cat_bot.example', identities), [
    { type: 'text', text: '@cat_bot_extra mail@cat_bot.example' },
  ]);
});

test('does not leak helper bindings into the renderer classic-script scope', () => {
  const context = vm.createContext({ window: {} });
  const helperSource = readFileSync(
    path.join(__dirname, '..', 'src', 'message-highlights.js'),
    'utf8',
  );

  vm.runInContext(helperSource, context);

  assert.equal(typeof context.window.messageHighlights.createLoggedIdentity, 'function');
  assert.doesNotThrow(() => {
    vm.runInContext('const createLoggedIdentity = "renderer binding";', context);
  });
});
