const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createLocalChatStore, LOCAL_CHAT_SOURCE } = require('../src/local-chat-store');

const createTestStore = ({ now = () => new Date('2026-06-08T12:00:00.000Z') } = {}) => {
  let id = 0;
  const filePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'uca-local-chat-')),
    'local-chat.json',
  );

  return createLocalChatStore({
    filePath,
    idFactory: () => `id-${++id}`,
    now: () => new Date(typeof now === 'function' ? now() : now),
  });
};

test('registers users with unique case-insensitive nicks', () => {
  const store = createTestStore();
  const user = store.registerUser({ email: ' ANA@Example.com ', nick: 'Ana_1' });

  assert.equal(user.emailKey, 'ana@example.com');
  assert.equal(user.nick, 'Ana_1');
  assert.equal(user.nickKey, 'ana_1');
  assert.throws(
    () => store.registerUser({ email: 'other@example.com', nick: 'ana_1' }),
    /nick is already taken/,
  );
  assert.equal(store.registerUser({ email: 'ana@example.com', nick: 'Ana_1' }).id, user.id);
});

test('creates sessions and resolves session users', () => {
  const store = createTestStore();
  const user = store.registerUser({ email: 'ana@example.com', nick: 'ana' });
  const { session } = store.createSession({ email: 'ANA@example.com' });

  assert.equal(session.userId, user.id);
  assert.equal(store.getSessionUser(session.token).nick, 'ana');
  assert.equal(store.getUserByEmail('ANA@example.com').id, user.id);
  assert.equal(store.getUserByNick('ANA').id, user.id);
});

test('creates normalized local chat messages', () => {
  const store = createTestStore();

  store.registerUser({ email: 'ana@example.com', nick: 'ana' });
  const { session } = store.createSession({ email: 'ana@example.com' });
  const message = store.createMessage({ token: session.token, text: ' hello local ' });

  assert.deepEqual(message.source, LOCAL_CHAT_SOURCE);
  assert.equal(message.platform, 'local');
  assert.equal(message.author.name, 'ana');
  assert.equal(message.text, 'hello local');
  assert.deepEqual(message.fragments, [{ type: 'text', text: 'hello local' }]);
  assert.equal(store.load().messages.length, 1);
});

test('creates mention fragments for local chat messages', () => {
  const store = createTestStore();

  store.registerUser({ email: 'ana@example.com', nick: 'ana' });
  const { session } = store.createSession({ email: 'ana@example.com' });
  const message = store.createMessage({ token: session.token, text: 'oi @Bia_2 tudo bem' });

  assert.deepEqual(message.fragments, [
    { type: 'text', text: 'oi ' },
    { type: 'mention', text: '@Bia_2' },
    { type: 'text', text: ' tudo bem' },
  ]);
});

test('marks configured moderators by email and nick', () => {
  const store = createTestStore();

  store.registerUser({ email: 'mod@example.com', nick: 'some_mod' });
  store.addModerator({ email: 'MOD@example.com' });
  store.registerUser({ email: 'nickmod@example.com', nick: 'NickMod' });
  store.addModerator({ nick: 'nickmod' });

  const users = store.load().users;

  assert.equal(users.find((user) => user.emailKey === 'mod@example.com').role, 'moderator');
  assert.equal(users.find((user) => user.nickKey === 'nickmod').role, 'moderator');
});

test('applies moderator rules when users register after the rule exists', () => {
  const store = createTestStore();

  store.addModerator({ email: 'future@example.com' });
  store.addModerator({ nick: 'future_mod' });

  assert.equal(
    store.registerUser({ email: 'future@example.com', nick: 'regular' }).role,
    'moderator',
  );
  assert.equal(
    store.registerUser({ email: 'other@example.com', nick: 'future_mod' }).role,
    'moderator',
  );
});

test('rejects messages from banned users by email or nick', () => {
  const store = createTestStore();

  store.registerUser({ email: 'ana@example.com', nick: 'ana' });
  const { session } = store.createSession({ email: 'ana@example.com' });
  store.banUser({ email: 'ANA@example.com', reason: 'spam' });

  assert.throws(
    () => store.createMessage({ token: session.token, text: 'blocked' }),
    /banned/,
  );

  const otherStore = createTestStore();

  otherStore.registerUser({ email: 'bia@example.com', nick: 'bia' });
  const { session: otherSession } = otherStore.createSession({ email: 'bia@example.com' });
  otherStore.banUser({ nick: 'BIA' });

  assert.throws(
    () => otherStore.createMessage({ token: otherSession.token, text: 'blocked' }),
    /banned/,
  );
});

test('rejects messages from timed out users until the timeout expires', () => {
  let current = new Date('2026-06-08T12:00:00.000Z');
  const store = createTestStore({ now: () => current });

  store.registerUser({ email: 'ana@example.com', nick: 'ana' });
  const { session } = store.createSession({ email: 'ana@example.com' });
  store.timeoutUser({ nick: 'ana', durationSeconds: 60 });

  assert.throws(
    () => store.createMessage({ token: session.token, text: 'too soon' }),
    /timed out/,
  );

  current = new Date('2026-06-08T12:01:01.000Z');
  assert.equal(store.createMessage({ token: session.token, text: 'after timeout' }).text, 'after timeout');
});

test('rejects invalid sessions and overlong messages', () => {
  const store = createTestStore();

  assert.throws(
    () => store.createMessage({ token: 'missing', text: 'hello' }),
    /session is invalid/,
  );

  store.registerUser({ email: 'ana@example.com', nick: 'ana' });
  const { session } = store.createSession({ email: 'ana@example.com' });

  assert.throws(
    () => store.createMessage({ token: session.token, text: 'x'.repeat(501) }),
    /500 characters/,
  );
});
