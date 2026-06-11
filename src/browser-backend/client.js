const { WebSocket } = require('ws');

const EVENTS_PATH = '/api/v1/events';
const GOOGLE_AUTH_COMPLETE_PATH = '/api/v1/auth/google/complete';
const GOOGLE_AUTH_START_PATH = '/api/v1/auth/google/start';
const GOOGLE_AUTH_STATUS_PATH = '/api/v1/auth/google/status';
const LOCAL_LOGIN_PATH = '/api/v1/local/login';
const LOCAL_ME_PATH = '/api/v1/local/me';
const LOCAL_MESSAGES_PATH = '/api/v1/local/messages';
const LOCAL_MODERATION_COMMANDS_PATH = '/api/v1/local/moderation-commands';
const LOCAL_MODERATION_PATH = '/api/v1/local/moderation';
const LOCAL_REGISTER_PATH = '/api/v1/local/register';
const SNAPSHOT_PATH = '/api/v1/snapshot';
const APP_EVENTS_PATH = '/api/v1/app/events';
const APP_LOCAL_REGISTER_PATH = '/api/v1/app/local/register';
const APP_GOOGLE_AUTH_COMPLETE_PATH = '/api/v1/app/auth/google/complete';
const APP_GOOGLE_AUTH_RESULT_PATH = '/api/v1/app/auth/google/result';

const createBrowserBackendClient = ({
  appIngestToken = '',
  baseUrl,
  fetchImpl = globalThis.fetch,
  WebSocketImpl = WebSocket,
} = {}) => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  if (typeof fetchImpl !== 'function') {
    throw new TypeError('Browser backend client requires fetch().');
  }

  return {
    async completePrivilegedGoogleOAuth({ nick, ticket }) {
      return requestJson(fetchImpl, normalizedBaseUrl, APP_GOOGLE_AUTH_COMPLETE_PATH, {
        body: { nick, ticket },
        headers: createBearerHeaders(appIngestToken),
        method: 'POST',
      });
    },

    async completeGoogleOAuth({ nick, ticket }) {
      return requestJson(fetchImpl, normalizedBaseUrl, GOOGLE_AUTH_COMPLETE_PATH, {
        body: { nick, ticket },
        method: 'POST',
      });
    },

    connectEvents({ onClose, onError, onEvent, onOpen } = {}) {
      const socket = new WebSocketImpl(createEventsUrl(normalizedBaseUrl));

      socket.on('open', () => {
        onOpen?.();
      });
      socket.on('message', (payload) => {
        onEvent?.(JSON.parse(payload.toString()));
      });
      socket.on('close', () => {
        onClose?.();
      });
      socket.on('error', (error) => {
        onError?.(error);
      });

      return {
        close() {
          socket.close();
        },
      };
    },

    createGoogleOAuthStartUrl({ resultKey, returnTo = '/viewer' } = {}) {
      const url = new URL(GOOGLE_AUTH_START_PATH, normalizedBaseUrl);

      url.searchParams.set('returnTo', returnTo);
      if (resultKey) {
        url.searchParams.set('resultKey', resultKey);
      }
      return url.toString();
    },

    async getPrivilegedGoogleOAuthResult(resultKey) {
      const url = new URL(APP_GOOGLE_AUTH_RESULT_PATH, normalizedBaseUrl);

      url.searchParams.set('resultKey', resultKey);
      return requestJson(fetchImpl, normalizedBaseUrl, url, {
        headers: createBearerHeaders(appIngestToken),
      });
    },

    async getGoogleOAuthStatus() {
      return requestJson(fetchImpl, normalizedBaseUrl, GOOGLE_AUTH_STATUS_PATH);
    },

    async getLocalModerationCommands() {
      return requestJson(fetchImpl, normalizedBaseUrl, LOCAL_MODERATION_COMMANDS_PATH);
    },

    async getLocalSession(token) {
      return requestJson(fetchImpl, normalizedBaseUrl, LOCAL_ME_PATH, {
        headers: createBearerHeaders(token),
      });
    },

    async loadSnapshot() {
      return requestJson(fetchImpl, normalizedBaseUrl, SNAPSHOT_PATH);
    },

    async loadLocalMessages() {
      return requestJson(fetchImpl, normalizedBaseUrl, LOCAL_MESSAGES_PATH);
    },

    async loginLocalUser({ email }) {
      return requestJson(fetchImpl, normalizedBaseUrl, LOCAL_LOGIN_PATH, {
        body: { email },
        method: 'POST',
      });
    },

    async publishAppEvent(event) {
      return requestJson(fetchImpl, normalizedBaseUrl, APP_EVENTS_PATH, {
        body: event,
        headers: createBearerHeaders(appIngestToken),
        method: 'POST',
      });
    },

    async registerLocalUser({ email, nick }) {
      return requestJson(fetchImpl, normalizedBaseUrl, LOCAL_REGISTER_PATH, {
        body: { email, nick },
        method: 'POST',
      });
    },

    async registerPrivilegedLocalUser({ email, nick }) {
      return requestJson(fetchImpl, normalizedBaseUrl, APP_LOCAL_REGISTER_PATH, {
        body: { email, nick },
        headers: createBearerHeaders(appIngestToken),
        method: 'POST',
      });
    },

    async runLocalModerationCommand({ command, token }) {
      return requestJson(fetchImpl, normalizedBaseUrl, LOCAL_MODERATION_PATH, {
        body: { command },
        headers: createBearerHeaders(token),
        method: 'POST',
      });
    },

    async sendLocalMessage({ text, token }) {
      return requestJson(fetchImpl, normalizedBaseUrl, LOCAL_MESSAGES_PATH, {
        body: { text },
        headers: createBearerHeaders(token),
        method: 'POST',
      });
    },
  };
};

const requestJson = async (fetchImpl, baseUrl, path, { body, headers = {}, method = 'GET' } = {}) => {
  const response = await fetchImpl(new URL(path, baseUrl), {
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    headers: {
      ...headers,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    method,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Browser backend request failed with ${response.status}.`);
  }

  return payload;
};

const createBearerHeaders = (token) =>
  token ? { Authorization: `Bearer ${token}` } : {};

const createEventsUrl = (baseUrl) => {
  const url = new URL(EVENTS_PATH, baseUrl);

  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

const normalizeBaseUrl = (baseUrl) => {
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new TypeError('Browser backend client requires a base URL.');
  }

  return new URL(baseUrl.trim()).toString();
};

module.exports = {
  createBrowserBackendClient,
};
