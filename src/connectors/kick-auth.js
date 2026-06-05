const { createHash, randomBytes, randomUUID } = require('node:crypto');
const {
  exchangeKickAuthorizationCode,
  resolveKickCurrentUser,
  validateKickAccessToken,
} = require('./kick-api');

const KICK_AUTHORIZE_URL = 'https://id.kick.com/oauth/authorize';
const DEFAULT_KICK_REDIRECT_URI = 'http://localhost/kick/callback';
const DEFAULT_KICK_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const KICK_AUTH_SCOPES = ['user:read', 'channel:read', 'chat:write'];

const connectKickWithOAuth = async ({
  BrowserWindow,
  clientId,
  clientSecret,
  oauthBrokerUrl,
  redirectUri = DEFAULT_KICK_REDIRECT_URI,
  scopes = KICK_AUTH_SCOPES,
  timeoutMs = DEFAULT_KICK_AUTH_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) => {
  if (!BrowserWindow) {
    throw new TypeError('BrowserWindow is required for Kick OAuth.');
  }

  const normalizedClientId = normalizeRequiredString(clientId, 'Kick client ID');
  const normalizedClientSecret = normalizeOptionalString(clientSecret);
  const normalizedOauthBrokerUrl = normalizeOptionalString(oauthBrokerUrl);

  if (!normalizedClientSecret && !normalizedOauthBrokerUrl) {
    throw new TypeError('Kick OAuth Broker URL or Client Secret is required.');
  }

  const state = randomUUID();
  const codeVerifier = createPkceCodeVerifier();
  const authUrl = buildKickAuthorizeUrl({
    clientId: normalizedClientId,
    redirectUri,
    scopes,
    state,
    codeChallenge: createPkceCodeChallenge(codeVerifier),
  });
  const authWindow = new BrowserWindow({
    width: 560,
    height: 720,
    show: true,
    title: 'Connect Kick',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:kick-auth',
    },
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish(reject, new Error('Kick authorization timed out.'));
    }, timeoutMs);

    const finish = (settle, value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      authWindow.webContents.off('will-redirect', inspectNavigation);
      authWindow.webContents.off('will-navigate', inspectNavigation);
      authWindow.webContents.off('did-navigate', inspectNavigation);
      authWindow.webContents.off('did-fail-load', inspectFailedNavigation);
      authWindow.off('closed', handleClosed);

      if (!authWindow.isDestroyed()) {
        authWindow.close();
      }

      settle(value);
    };

    const resolveCode = async (url) => {
      try {
        const authResult = extractKickAuthorizationCode(url, state);

        if (!authResult) {
          return;
        }

        const token = await exchangeKickAuthorizationCode({
          code: authResult.code,
          clientId: normalizedClientId,
          clientSecret: normalizedClientSecret,
          oauthBrokerUrl: normalizedOauthBrokerUrl,
          redirectUri,
          codeVerifier,
          fetchImpl,
        });
        const [tokenInfo, user] = await Promise.all([
          validateKickAccessToken({ accessToken: token.accessToken, fetchImpl }),
          resolveKickCurrentUser({ accessToken: token.accessToken, fetchImpl }),
        ]);

        finish(resolve, {
          ...token,
          clientId: tokenInfo.clientId || normalizedClientId,
          clientSecret: normalizedClientSecret,
          oauthBrokerUrl: normalizedOauthBrokerUrl,
          userId: user.userId,
          login: user.login,
          displayName: user.displayName,
          scopes: tokenInfo.scopes.length > 0 ? tokenInfo.scopes : token.scopes,
        });
      } catch (error) {
        finish(reject, error);
      }
    };

    const inspectNavigation = (_event, url) => {
      void resolveCode(url);
    };

    const inspectFailedNavigation = (_event, _errorCode, _errorDescription, url) => {
      void resolveCode(url);
    };

    const handleClosed = () => {
      finish(reject, new Error('Kick authorization window was closed.'));
    };

    authWindow.webContents.on('will-redirect', inspectNavigation);
    authWindow.webContents.on('will-navigate', inspectNavigation);
    authWindow.webContents.on('did-navigate', inspectNavigation);
    authWindow.webContents.on('did-fail-load', inspectFailedNavigation);
    authWindow.on('closed', handleClosed);
    authWindow.loadURL(authUrl).catch((error) => {
      if (!settled) {
        finish(reject, error);
      }
    });
  });
};

const buildKickAuthorizeUrl = ({ clientId, redirectUri, scopes, state, codeChallenge }) => {
  const url = new URL(KICK_AUTHORIZE_URL);

  url.searchParams.set('client_id', normalizeRequiredString(clientId, 'Kick client ID'));
  url.searchParams.set('redirect_uri', normalizeRequiredString(redirectUri, 'Kick redirect URI'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', normalizeRequiredString(state, 'Kick OAuth state'));
  url.searchParams.set(
    'code_challenge',
    normalizeRequiredString(codeChallenge, 'Kick code challenge'),
  );
  url.searchParams.set('code_challenge_method', 'S256');

  return url.toString();
};

const extractKickAuthorizationCode = (url, expectedState) => {
  const parsedUrl = new URL(url);

  if (parsedUrl.origin !== 'http://localhost' || parsedUrl.pathname !== '/kick/callback') {
    return undefined;
  }

  const error = parsedUrl.searchParams.get('error');

  if (error) {
    throw new Error(
      parsedUrl.searchParams.get('error_description') || `Kick authorization failed: ${error}.`,
    );
  }

  const state = parsedUrl.searchParams.get('state');

  if (state !== expectedState) {
    throw new Error('Kick authorization state did not match.');
  }

  return {
    code: normalizeRequiredString(
      parsedUrl.searchParams.get('code'),
      'Kick authorization code',
    ),
  };
};

const createPkceCodeVerifier = () => base64UrlEncode(randomBytes(64));

const createPkceCodeChallenge = (codeVerifier) =>
  base64UrlEncode(createHash('sha256').update(codeVerifier).digest());

const base64UrlEncode = (buffer) =>
  Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');

const normalizeRequiredString = (value, fieldName) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
};

const normalizeOptionalString = (value) =>
  typeof value === 'string' ? value.trim() : '';

module.exports = {
  DEFAULT_KICK_REDIRECT_URI,
  KICK_AUTH_SCOPES,
  buildKickAuthorizeUrl,
  connectKickWithOAuth,
  createPkceCodeChallenge,
  extractKickAuthorizationCode,
};
