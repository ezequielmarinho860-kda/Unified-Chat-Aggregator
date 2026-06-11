const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const readSource = (fileName) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', fileName), 'utf8');

const readViewerSource = (fileName) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', 'viewer', fileName), 'utf8');

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

test('setup local chat uses Google login without technical backend controls', () => {
  const setupHtml = readSource('setup.html');

  assert.match(setupHtml, /id="local-chat-google-login"/);
  assert.match(setupHtml, /Continue with Google/);
  assert.doesNotMatch(setupHtml, /id="local-chat-google-login" disabled/);
  assert.doesNotMatch(setupHtml, /name="email"/);
  assert.doesNotMatch(setupHtml, /id="reconnect-browser-backend"/);
  assert.doesNotMatch(setupHtml, /id="backend-status"/);

  const rendererSource = readSource('renderer.js');
  const stylesSource = readSource('styles.css');

  assert.doesNotMatch(rendererSource, /Email is required\./);
  assert.match(stylesSource, /\.local-chat-panel \[hidden\]/);
});

test('browser viewer local chat is Google OAuth only', () => {
  const viewerHtml = readViewerSource('index.html');
  const viewerScript = readViewerSource('viewer-mode.js');

  assert.match(viewerHtml, /Continue with Google/);
  assert.doesNotMatch(viewerHtml, /name="email"/);
  assert.doesNotMatch(viewerScript, /pendingLocalRegistrationEmail/);
  assert.doesNotMatch(viewerScript, /loginLocalUser/);
});
