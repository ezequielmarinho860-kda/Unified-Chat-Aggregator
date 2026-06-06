const { randomUUID } = require('node:crypto');
const { validateTwitchAccessToken } = require('./twitch-api');

const TWITCH_AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
const DEFAULT_TWITCH_REDIRECT_URI = 'http://localhost/twitch/callback';
const DEFAULT_TWITCH_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const TWITCH_AUTH_PARTITION = 'persist:twitch-auth';
const TWITCH_AUTH_SCOPES = [
  'user:write:chat',
  'moderator:manage:announcements',
  'moderator:manage:banned_users',
  'moderator:manage:chat_messages',
  'channel:manage:moderators',
];

const connectTwitchWithImplicitOAuth = async ({
  BrowserWindow,
  clientId,
  redirectUri = DEFAULT_TWITCH_REDIRECT_URI,
  scopes = TWITCH_AUTH_SCOPES,
  timeoutMs = DEFAULT_TWITCH_AUTH_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) => {
  if (!BrowserWindow) {
    throw new TypeError('BrowserWindow is required for Twitch OAuth.');
  }

  const normalizedClientId = normalizeRequiredString(clientId, 'Twitch client ID');
  const state = randomUUID();
  const authUrl = buildTwitchAuthorizeUrl({
    clientId: normalizedClientId,
    redirectUri,
    scopes,
    state,
  });
  const authWindow = new BrowserWindow({
    width: 560,
    height: 720,
    show: true,
    title: 'Connect Twitch',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: TWITCH_AUTH_PARTITION,
    },
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish(reject, new Error('Twitch authorization timed out.'));
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

    const resolveToken = async (url) => {
      try {
        const authResult = extractTwitchImplicitAuthResult(url, state);

        if (!authResult) {
          return;
        }

        const tokenInfo = await validateTwitchAccessToken({
          accessToken: authResult.accessToken,
          fetchImpl,
        });

        finish(resolve, {
          accessToken: authResult.accessToken,
          clientId: tokenInfo.clientId,
          userId: tokenInfo.userId,
          login: tokenInfo.login,
          displayName: tokenInfo.login,
          scopes: tokenInfo.scopes,
        });
      } catch (error) {
        finish(reject, error);
      }
    };

    const inspectNavigation = (_event, url) => {
      void resolveToken(url);
    };

    const inspectFailedNavigation = (_event, _errorCode, _errorDescription, url) => {
      void resolveToken(url);
    };

    const handleClosed = () => {
      finish(reject, new Error('Twitch authorization window was closed.'));
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

const buildTwitchAuthorizeUrl = ({ clientId, redirectUri, scopes, state }) => {
  const url = new URL(TWITCH_AUTHORIZE_URL);

  url.searchParams.set('client_id', normalizeRequiredString(clientId, 'Twitch client ID'));
  url.searchParams.set('redirect_uri', normalizeRequiredString(redirectUri, 'Twitch redirect URI'));
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', normalizeRequiredString(state, 'Twitch OAuth state'));

  return url.toString();
};

const extractTwitchImplicitAuthResult = (url, expectedState) => {
  const parsedUrl = new URL(url);

  if (parsedUrl.origin !== 'http://localhost' || parsedUrl.pathname !== '/twitch/callback') {
    return undefined;
  }

  const params = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));
  const error = params.get('error');

  if (error) {
    throw new Error(params.get('error_description') || `Twitch authorization failed: ${error}.`);
  }

  const state = params.get('state');

  if (state !== expectedState) {
    throw new Error('Twitch authorization state did not match.');
  }

  return {
    accessToken: normalizeRequiredString(params.get('access_token'), 'Twitch access token'),
    scopes: (params.get('scope') || '').split(/\s+/).filter(Boolean),
  };
};

const normalizeRequiredString = (value, fieldName) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
};

module.exports = {
  DEFAULT_TWITCH_REDIRECT_URI,
  TWITCH_AUTH_PARTITION,
  TWITCH_AUTH_SCOPES,
  buildTwitchAuthorizeUrl,
  connectTwitchWithImplicitOAuth,
  extractTwitchImplicitAuthResult,
};
