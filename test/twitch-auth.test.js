const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_TWITCH_REDIRECT_URI,
  TWITCH_AUTH_PARTITION,
  buildTwitchAuthorizeUrl,
  extractTwitchImplicitAuthResult,
} = require('../src/connectors/twitch-auth');

test('uses a persistent Twitch auth browser partition', () => {
  assert.equal(TWITCH_AUTH_PARTITION, 'persist:twitch-auth');
});

test('builds a Twitch implicit OAuth URL', () => {
  const url = new URL(
    buildTwitchAuthorizeUrl({
      clientId: 'client-1',
      redirectUri: DEFAULT_TWITCH_REDIRECT_URI,
      scopes: ['user:write:chat'],
      state: 'state-1',
    }),
  );

  assert.equal(url.origin + url.pathname, 'https://id.twitch.tv/oauth2/authorize');
  assert.equal(url.searchParams.get('client_id'), 'client-1');
  assert.equal(url.searchParams.get('redirect_uri'), DEFAULT_TWITCH_REDIRECT_URI);
  assert.equal(url.searchParams.get('response_type'), 'token');
  assert.equal(url.searchParams.get('scope'), 'user:write:chat');
  assert.equal(url.searchParams.get('state'), 'state-1');
});

test('extracts Twitch token from implicit OAuth redirect', () => {
  const result = extractTwitchImplicitAuthResult(
    'http://localhost/twitch/callback#access_token=token&scope=user%3Awrite%3Achat&state=state-1',
    'state-1',
  );

  assert.deepEqual(result, {
    accessToken: 'token',
    scopes: ['user:write:chat'],
  });
});

test('ignores non Twitch OAuth callback URLs', () => {
  assert.equal(
    extractTwitchImplicitAuthResult('https://www.twitch.tv/login', 'state-1'),
    undefined,
  );
});

test('rejects Twitch OAuth state mismatches', () => {
  assert.throws(
    () =>
      extractTwitchImplicitAuthResult(
        'http://localhost/twitch/callback#access_token=token&state=bad-state',
        'state-1',
      ),
    /state/,
  );
});

test('surfaces Twitch OAuth errors', () => {
  assert.throws(
    () =>
      extractTwitchImplicitAuthResult(
        'http://localhost/twitch/callback#error=access_denied&error_description=Denied&state=state-1',
        'state-1',
      ),
    /Denied/,
  );
});
