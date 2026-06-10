(() => {
  const SNAPSHOT_PATH = '/api/v1/snapshot';
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

  const createDefaultViewerTransportClient = (options = {}) => {
    if (typeof window.__viewerTransportFactory === 'function') {
      return window.__viewerTransportFactory(options);
    }

    return createLocalViewerTransportClient(options);
  };

  const createLocalViewerTransportClient = ({
    fetchImpl = window.fetch.bind(window),
    locationImpl = window.location,
    WebSocketImpl = window.WebSocket,
    clientType = 'overlay',
  } = {}) => ({
    async loadSnapshot() {
      const response = await fetchImpl(SNAPSHOT_PATH, { cache: 'no-store' });

      if (!response.ok) {
        throw new Error(`Snapshot request failed with ${response.status}.`);
      }

      return response.json();
    },

    async getLocalSession(token) {
      return requestJson(fetchImpl, LOCAL_ME_PATH, {
        headers: createLocalHeaders(token),
      });
    },

    async getLocalModerationCommands() {
      return requestJson(fetchImpl, LOCAL_MODERATION_COMMANDS_PATH);
    },

    createGoogleOAuthStartUrl({ returnTo = '/viewer' } = {}) {
      const url = new URL(GOOGLE_AUTH_START_PATH, locationImpl.href);

      url.searchParams.set('returnTo', returnTo);
      return url.toString();
    },

    async getGoogleOAuthStatus() {
      return requestJson(fetchImpl, GOOGLE_AUTH_STATUS_PATH);
    },

    async completeGoogleOAuth({ nick, ticket }) {
      return requestJson(fetchImpl, GOOGLE_AUTH_COMPLETE_PATH, {
        body: { nick, ticket },
        method: 'POST',
      });
    },

    async loginLocalUser({ email }) {
      return requestJson(fetchImpl, LOCAL_LOGIN_PATH, {
        body: { email },
        method: 'POST',
      });
    },

    async registerLocalUser({ email, nick }) {
      return requestJson(fetchImpl, LOCAL_REGISTER_PATH, {
        body: { email, nick },
        method: 'POST',
      });
    },

    async runLocalModerationCommand({ command, token }) {
      return requestJson(fetchImpl, LOCAL_MODERATION_PATH, {
        body: { command },
        headers: createLocalHeaders(token),
        method: 'POST',
      });
    },

    async sendLocalMessage({ text, token }) {
      return requestJson(fetchImpl, LOCAL_MESSAGES_PATH, {
        body: { text },
        headers: createLocalHeaders(token),
        method: 'POST',
      });
    },

    connectEvents({ onClose, onError, onEvent, onOpen } = {}) {
      const socket = new WebSocketImpl(createEventsUrl(locationImpl, clientType));

      socket.addEventListener('open', () => {
        onOpen?.();
      });
      socket.addEventListener('message', (event) => {
        onEvent?.(JSON.parse(event.data));
      });
      socket.addEventListener('close', () => {
        onClose?.();
      });
      socket.addEventListener('error', () => {
        onError?.();
      });

      return {
        close() {
          socket.close();
        },
      };
    },
  });

  const requestJson = async (fetchImpl, path, { body, headers = {}, method = 'GET' } = {}) => {
    const response = await fetchImpl(path, {
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
      throw new Error(payload.error || `Local chat request failed with ${response.status}.`);
    }

    return payload;
  };

  const createLocalHeaders = (token) =>
    token ? { Authorization: `Bearer ${token}` } : {};

  const createMockViewerTransportClient = ({
    events = [],
    snapshot = {
      generatedAt: new Date().toISOString(),
      manifest: { sources: [], title: 'Mock Viewer Mode' },
      protocolVersion: '1',
      statuses: [],
      viewers: { sources: [], total: 0 },
    },
  } = {}) => ({
    async loadSnapshot() {
      return structuredClone(snapshot);
    },

    async getLocalSession() {
      return { user: { nick: 'MockUser', role: 'user' } };
    },

    async getLocalModerationCommands() {
      return {
        commands: [
          { name: '/ban', usage: '/ban nick reason', description: 'Ban a user by nick.' },
          { name: '/timeout', usage: '/timeout nick seconds reason', description: 'Timeout a user by nick.' },
        ],
      };
    },

    createGoogleOAuthStartUrl() {
      return '#mock-google-oauth';
    },

    async getGoogleOAuthStatus() {
      return { enabled: true };
    },

    async completeGoogleOAuth() {
      return { session: { token: 'mock-token' }, user: { nick: 'MockUser', role: 'user' } };
    },

    async loginLocalUser() {
      return { session: { token: 'mock-token' }, user: { nick: 'MockUser', role: 'user' } };
    },

    async registerLocalUser() {
      return { session: { token: 'mock-token' }, user: { nick: 'MockUser', role: 'user' } };
    },

    async runLocalModerationCommand() {
      return { moderation: { action: 'ban' } };
    },

    async sendLocalMessage() {
      return { message: { text: 'mock local message' } };
    },

    connectEvents({ onClose, onEvent, onOpen } = {}) {
      let closed = false;

      window.queueMicrotask(() => {
        if (closed) {
          return;
        }

        onOpen?.();

        for (const event of events) {
          if (closed) {
            return;
          }

          onEvent?.(structuredClone(event));
        }
      });

      return {
        close() {
          closed = true;
          onClose?.();
        },
      };
    },
  });

  const createEventsUrl = (locationImpl, clientType) => {
    const url = new URL(EVENTS_PATH, locationImpl.href);

    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    if (clientType) {
      url.searchParams.set('client', clientType);
    }
    return url;
  };

  window.ViewerTransports = {
    createDefaultViewerTransportClient,
    createLocalViewerTransportClient,
    createMockViewerTransportClient,
  };
})();
