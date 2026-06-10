const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const readSource = (fileName) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', fileName), 'utf8');

test('local chat login remains in setup and is not rendered in the dashboard', () => {
  const setupHtml = readSource('setup.html');
  const dashboardHtml = readSource('dashboard.html');

  assert.match(setupHtml, /id="local-chat-auth-form"/);
  assert.doesNotMatch(dashboardHtml, /id="local-chat-auth-form"/);
  assert.match(dashboardHtml, /id="local-chat-login-required"/);
  assert.match(dashboardHtml, /id="local-chat-message-form"/);
});

test('setup uses the first configuration card for local chat and a compact theme control', () => {
  const setupHtml = readSource('setup.html');
  const localChatPosition = setupHtml.indexOf('local-chat-panel--setup');
  const twitchPosition = setupHtml.indexOf('connector-settings--twitch');

  assert.match(setupHtml, /id="theme-toggle"/);
  assert.match(setupHtml, /type="hidden" name="ui\.theme"/);
  assert.doesNotMatch(setupHtml, /connector-settings--appearance/);
  assert.ok(localChatPosition >= 0 && localChatPosition < twitchPosition);
});
