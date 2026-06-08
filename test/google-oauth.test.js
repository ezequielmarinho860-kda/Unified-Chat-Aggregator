const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GOOGLE_OAUTH_SCOPE,
  createGoogleOAuthService,
} = require('../src/google-oauth');

const createJsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  json: async () => body,
  ok,
  status,
});

test('builds Google OAuth authorization URLs with state', () => {
  const ids = ['state-1'];
  const service = createGoogleOAuthService({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetchImpl: async () => createJsonResponse({}),
    idFactory: () => ids.shift(),
    redirectUri: 'http://127.0.0.1:47831/api/v1/auth/google/callback',
  });
  const url = service.createAuthorizationUrl({
    resultKey: 'result-1',
    returnTo: '/viewer?debugChat=1',
  });

  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('client_id'), 'client-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:47831/api/v1/auth/google/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), GOOGLE_OAUTH_SCOPE);
  assert.equal(url.searchParams.get('state'), 'state-1');
});

test('exchanges callback codes for normalized Google profiles and tickets', async () => {
  const ids = ['state-1', 'ticket-1'];
  const requests = [];
  const service = createGoogleOAuthService({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetchImpl: async (url, options = {}) => {
      requests.push({ options, url });

      if (String(url).includes('/token')) {
        return createJsonResponse({ access_token: 'access-token' });
      }

      return createJsonResponse({
        email: 'USER@Example.com',
        email_verified: true,
        name: 'User Name',
        picture: 'https://example.com/avatar.png',
        sub: 'google-user-id',
      });
    },
    idFactory: () => ids.shift(),
    redirectUri: 'http://127.0.0.1:47831/api/v1/auth/google/callback',
  });

  service.createAuthorizationUrl({ resultKey: 'result-1', returnTo: '/viewer' });
  const result = await service.handleCallback({ code: 'code-1', state: 'state-1' });

  assert.equal(result.ticket, 'ticket-1');
  assert.equal(result.returnTo, '/viewer');
  assert.deepEqual(result.profile, {
    email: 'user@example.com',
    name: 'User Name',
    picture: 'https://example.com/avatar.png',
    provider: 'google',
    providerUserId: 'google-user-id',
  });
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer access-token');
  assert.deepEqual(service.consumeResult('result-1'), result);
  assert.deepEqual(service.consumeTicket('ticket-1'), result.profile);
  assert.throws(() => service.consumeTicket('ticket-1'), /ticket is invalid or expired/);
});

test('rejects unverified Google emails', async () => {
  const ids = ['state-1'];
  const service = createGoogleOAuthService({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetchImpl: async (url) =>
      String(url).includes('/token')
        ? createJsonResponse({ access_token: 'access-token' })
        : createJsonResponse({
            email: 'user@example.com',
            email_verified: false,
            sub: 'google-user-id',
          }),
    idFactory: () => ids.shift(),
    redirectUri: 'http://127.0.0.1:47831/api/v1/auth/google/callback',
  });

  service.createAuthorizationUrl();

  await assert.rejects(
    () => service.handleCallback({ code: 'code-1', state: 'state-1' }),
    /email is not verified/,
  );
});
