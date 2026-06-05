const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_KICK_REDIRECT_URI,
  buildKickAuthorizeUrl,
  createPkceCodeChallenge,
  extractKickAuthorizationCode,
} = require('../src/connectors/kick-auth');

test('builds a Kick authorization code OAuth URL with PKCE', () => {
  const url = new URL(
    buildKickAuthorizeUrl({
      clientId: 'client-1',
      redirectUri: DEFAULT_KICK_REDIRECT_URI,
      scopes: ['user:read', 'channel:read', 'chat:write'],
      state: 'state-1',
      codeChallenge: 'challenge-1',
    }),
  );

  assert.equal(url.origin + url.pathname, 'https://id.kick.com/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'client-1');
  assert.equal(url.searchParams.get('redirect_uri'), DEFAULT_KICK_REDIRECT_URI);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'user:read channel:read chat:write');
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-1');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('extracts Kick authorization code from redirect', () => {
  const result = extractKickAuthorizationCode(
    'http://localhost/kick/callback?code=code-1&state=state-1',
    'state-1',
  );

  assert.deepEqual(result, { code: 'code-1' });
});

test('ignores non Kick OAuth callback URLs', () => {
  assert.equal(extractKickAuthorizationCode('https://kick.com/login', 'state-1'), undefined);
});

test('rejects Kick OAuth state mismatches', () => {
  assert.throws(
    () =>
      extractKickAuthorizationCode(
        'http://localhost/kick/callback?code=code-1&state=bad-state',
        'state-1',
      ),
    /state/,
  );
});

test('surfaces Kick OAuth errors', () => {
  assert.throws(
    () =>
      extractKickAuthorizationCode(
        'http://localhost/kick/callback?error=access_denied&error_description=Denied&state=state-1',
        'state-1',
      ),
    /Denied/,
  );
});

test('creates a stable S256 PKCE challenge', () => {
  assert.equal(
    createPkceCodeChallenge('verifier-1'),
    'xTYRBLTDt1gS3-rw_3FBVafZ0iNg9bZYBbG8fRPvkEs',
  );
});
