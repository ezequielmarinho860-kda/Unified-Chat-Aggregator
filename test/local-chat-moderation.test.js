const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { applyModerationCommand } = require('../src/local-chat-moderation');
const { createLocalChatStore } = require('../src/local-chat-store');

const createTestStore = () => {
  let id = 0;

  return createLocalChatStore({
    filePath: path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'uca-local-chat-moderation-')),
      'local-chat.json',
    ),
    idFactory: () => `id-${++id}`,
    now: () => new Date('2026-06-08T12:00:00.000Z'),
  });
};

test('unmods a user by nick even when the moderator rule was stored by email', () => {
  const store = createTestStore();
  const moderator = store.registerUser({ email: 'owner@example.com', nick: 'Owner' });

  store.registerUser({ email: 'mod@example.com', nick: 'ModUser' });
  store.addModerator({ email: 'mod@example.com' });

  assert.equal(store.getUserByNick('ModUser').role, 'moderator');

  const result = applyModerationCommand(store, '/unmod ModUser', moderator);

  assert.equal(result.action, 'unmod');
  assert.equal(result.removed, 1);
  assert.equal(store.getUserByNick('ModUser').role, 'user');
});
