const crypto = require('node:crypto');

const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const GOOGLE_OAUTH_SCOPE = 'openid email profile';
const DEFAULT_TICKET_TTL_MS = 10 * 60 * 1000;

const createGoogleOAuthService = ({
  clientId = '',
  clientSecret = '',
  redirectUri = '',
  fetchImpl = globalThis.fetch,
  idFactory = crypto.randomUUID,
  now = () => Date.now(),
  ticketTtlMs = DEFAULT_TICKET_TTL_MS,
} = {}) => {
  const states = new Map();
  const tickets = new Map();
  const results = new Map();

  const isConfigured = () =>
    Boolean(
      requireOptionalString(clientId) &&
        requireOptionalString(clientSecret) &&
        requireOptionalString(redirectUri) &&
        typeof fetchImpl === 'function',
    );

  const requireConfigured = () => {
    if (!isConfigured()) {
      const error = new Error('Google OAuth is not configured.');

      error.statusCode = 404;
      throw error;
    }
  };

  const createAuthorizationUrl = ({ returnTo = '/viewer', resultKey } = {}) => {
    requireConfigured();
    cleanupExpired();
    const state = idFactory();

    states.set(state, {
      createdAt: now(),
      resultKey: requireOptionalString(resultKey),
      returnTo: requireOptionalString(returnTo) || '/viewer',
    });

    const url = new URL(GOOGLE_AUTHORIZATION_URL);

    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_OAUTH_SCOPE);
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'online');
    return url;
  };

  const handleCallback = async ({ code, state }) => {
    requireConfigured();
    cleanupExpired();
    const pendingState = states.get(requireString(state, 'state'));

    if (!pendingState) {
      const error = new Error('Google OAuth state is invalid or expired.');

      error.statusCode = 400;
      throw error;
    }

    states.delete(state);
    const tokens = await exchangeCodeForTokens(requireString(code, 'code'));
    const profile = await fetchGoogleProfile(tokens.access_token);
    const ticket = idFactory();
    const result = {
      profile,
      returnTo: pendingState.returnTo,
      ticket,
    };

    tickets.set(ticket, {
      createdAt: now(),
      profile,
    });

    if (pendingState.resultKey) {
      results.set(pendingState.resultKey, {
        createdAt: now(),
        ...result,
      });
    }

    return result;
  };

  const consumeTicket = (ticket) => {
    cleanupExpired();
    const pendingTicket = tickets.get(requireString(ticket, 'ticket'));

    if (!pendingTicket) {
      const error = new Error('Google OAuth ticket is invalid or expired.');

      error.statusCode = 400;
      throw error;
    }

    tickets.delete(ticket);
    return pendingTicket.profile;
  };

  const consumeResult = (resultKey) => {
    cleanupExpired();
    const result = results.get(requireString(resultKey, 'result key'));

    if (!result) {
      return undefined;
    }

    results.delete(resultKey);
    return createPublicOAuthResult(result);
  };

  const exchangeCodeForTokens = async (code) => {
    const response = await fetchImpl(GOOGLE_TOKEN_URL, {
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.access_token) {
      const error = new Error(payload.error_description || payload.error || 'Google OAuth token exchange failed.');

      error.statusCode = 502;
      throw error;
    }

    return payload;
  };

  const fetchGoogleProfile = async (accessToken) => {
    const response = await fetchImpl(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(payload.error_description || payload.error || 'Google profile request failed.');

      error.statusCode = 502;
      throw error;
    }

    return normalizeGoogleProfile(payload);
  };

  const cleanupExpired = () => {
    const cutoff = now() - ticketTtlMs;

    for (const [key, value] of states) {
      if (value.createdAt < cutoff) {
        states.delete(key);
      }
    }

    for (const [key, value] of tickets) {
      if (value.createdAt < cutoff) {
        tickets.delete(key);
      }
    }

    for (const [key, value] of results) {
      if (value.createdAt < cutoff) {
        results.delete(key);
      }
    }
  };

  return {
    consumeResult,
    consumeTicket,
    createAuthorizationUrl,
    handleCallback,
    isConfigured,
  };
};

const normalizeGoogleProfile = (profile = {}) => {
  if (profile.email_verified === false) {
    const error = new Error('Google account email is not verified.');

    error.statusCode = 400;
    throw error;
  }

  return {
    email: requireEmail(profile.email),
    name: requireOptionalString(profile.name),
    picture: requireOptionalString(profile.picture),
    provider: 'google',
    providerUserId: requireString(profile.sub, 'Google profile id'),
  };
};

const createPublicOAuthResult = ({ profile, returnTo, ticket }) => ({
  profile,
  returnTo,
  ticket,
});

const requireEmail = (email) => {
  const normalized = requireString(email?.trim(), 'Google profile email');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    const error = new Error('Google profile email is invalid.');

    error.statusCode = 400;
    throw error;
  }

  return normalized.toLowerCase();
};

const requireString = (value, label) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    const error = new Error(`Google OAuth ${label} is required.`);

    error.statusCode = 400;
    throw error;
  }

  return value.trim();
};

const requireOptionalString = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

module.exports = {
  GOOGLE_OAUTH_SCOPE,
  createGoogleOAuthService,
};
