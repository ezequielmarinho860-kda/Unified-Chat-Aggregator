const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WebSocket } = require('ws');
const { createHttpGateway, GATEWAY_HOST } = require('../src/gateway/http-gateway');
const { createBrowserBackendConfigStore } = require('../src/browser-backend/config-store');
const { createLocalChatStore } = require('../src/local-chat-store');

const createTestLocalChatStore = () => {
  let id = 0;

  return createLocalChatStore({
    filePath: path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'uca-local-chat-')),
      'local-chat.json',
    ),
    idFactory: () => `id-${++id}`,
    now: () => new Date('2026-06-08T12:00:00.000Z'),
  });
};

const createTestBrowserConfigStore = () =>
  createBrowserBackendConfigStore(
    path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'uca-browser-config-')),
      'browser-config.json',
    ),
  );

const localUrl = (address, path) => `http://${address.host}:${address.port}${path}`;

const postJson = (url, body, token, headers = {}) =>
  fetch(url, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    method: 'POST',
  });

const putJson = (url, body, headers = {}) =>
  fetch(url, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    method: 'PUT',
  });

const createFakeGoogleOAuthService = ({
  authorizationUrl = 'https://accounts.google.com/mock',
  callbackResult,
  onCreateAuthorizationUrl = () => {},
  profile = {
    email: 'google@example.com',
    name: 'Google User',
  },
} = {}) => ({
  consumeTicket(ticket) {
    assert.equal(ticket, 'ticket-1');
    return profile;
  },
  createAuthorizationUrl(options) {
    onCreateAuthorizationUrl(options);
    return new URL(authorizationUrl);
  },
  async handleCallback() {
    return callbackResult ?? {
      profile,
      returnTo: '/viewer',
      ticket: 'ticket-1',
    };
  },
  isConfigured() {
    return true;
  },
});

test('serves the public snapshot on the versioned read-only endpoint', async () => {
  const snapshot = { protocolVersion: '1', statuses: [], viewers: { sources: [], total: 0 } };
  const gateway = createHttpGateway({ getSnapshot: () => snapshot, port: 0 });

  try {
    const address = await gateway.start();
    const response = await fetch(address.snapshotUrl);

    assert.equal(address.host, GATEWAY_HOST);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(await response.json(), snapshot);
  } finally {
    await gateway.stop();
  }
});

test('serves the browser-native viewer mode shell and assets', async () => {
  const gateway = createHttpGateway({ getSnapshot: () => ({}), port: 0 });

  try {
    const address = await gateway.start();
    const viewerResponse = await fetch(address.viewerUrl);
    const popoutResponse = await fetch(address.popoutUrl);
    const overlayResponse = await fetch(address.overlayUrl);
    const transportResponse = await fetch(`http://${address.host}:${address.port}/viewer/viewer-transport.js`);
    const scriptResponse = await fetch(`http://${address.host}:${address.port}/viewer/viewer-mode.js`);
    const styleResponse = await fetch(`http://${address.host}:${address.port}/viewer/viewer-mode.css`);
    const overlayScriptResponse = await fetch(`http://${address.host}:${address.port}/overlay/overlay.js`);
    const overlayStyleResponse = await fetch(`http://${address.host}:${address.port}/overlay/overlay.css`);
    const twitchIconResponse = await fetch(
      `http://${address.host}:${address.port}/viewer/assets/twitch-glitch.svg`,
    );
    const html = await viewerResponse.text();
    const popoutHtml = await popoutResponse.text();
    const overlayHtml = await overlayResponse.text();
    const transportScript = await transportResponse.text();
    const script = await scriptResponse.text();
    const style = await styleResponse.text();
    const overlayScript = await overlayScriptResponse.text();
    const overlayStyle = await overlayStyleResponse.text();
    const twitchIcon = await twitchIconResponse.text();

    assert.equal(viewerResponse.status, 200);
    assert.match(viewerResponse.headers.get('content-type'), /^text\/html/);
    assert.match(html, /Viewer Mode/);
    assert.match(html, /player\.twitch\.tv/);
    assert.match(html, /viewer-transport\.js/);
    assert.match(html, /data-player-panel/);
    assert.match(html, /data-viewer-card="twitch"/);
    assert.match(html, /data-viewer-platform-count="total"/);
    assert.match(html, /data-chat-list/);
    assert.match(html, /data-chat-platform-filter="all"/);
    assert.match(html, /data-chat-platform-filter="twitch"/);
    assert.match(html, /data-chat-platform-filter="kick"/);
    assert.match(html, /data-chat-platform-filter="x"/);
    assert.match(html, /data-chat-platform-filter="local"/);
    assert.match(html, /data-clear-chat/);
    assert.match(html, /data-local-auth-form/);
    assert.match(html, /data-local-google-login/);
    assert.match(html, /data-local-message-form/);
    assert.match(html, /data-local-chat-suggestions/);
    assert.match(html, /data-resume-chat/);
    assert.doesNotMatch(html, /window\.chatAggregator/);
    assert.equal(popoutResponse.status, 200);
    assert.match(popoutResponse.headers.get('content-type'), /^text\/html/);
    assert.match(popoutHtml, /Viewer Mode/);
    assert.match(popoutHtml, /data-chat-list/);
    assert.match(popoutHtml, /data-clear-chat/);
    assert.doesNotMatch(popoutHtml, /window\.chatAggregator/);
    assert.equal(overlayResponse.status, 200);
    assert.match(overlayResponse.headers.get('content-type'), /^text\/html/);
    assert.match(overlayHtml, /Chat Overlay/);
    assert.match(overlayHtml, /viewer-transport\.js/);
    assert.match(overlayHtml, /overlay\.js/);
    assert.match(overlayHtml, /data-overlay-chat/);
    assert.doesNotMatch(overlayHtml, /window\.chatAggregator/);
    assert.equal(transportResponse.status, 200);
    assert.match(transportResponse.headers.get('content-type'), /^text\/javascript/);
    assert.match(transportScript, /createLocalViewerTransportClient/);
    assert.match(transportScript, /createMockViewerTransportClient/);
    assert.match(transportScript, /__viewerTransportFactory/);
    assert.match(transportScript, /new WebSocketImpl/);
    assert.match(transportScript, /\/api\/v1\/snapshot/);
    assert.match(transportScript, /\/api\/v1\/events/);
    assert.match(transportScript, /\/api\/v1\/local\/register/);
    assert.match(transportScript, /\/api\/v1\/local\/moderation-commands/);
    assert.match(transportScript, /\/api\/v1\/auth\/google\/start/);
    assert.match(transportScript, /completeGoogleOAuth/);
    assert.match(transportScript, /getGoogleOAuthStatus/);
    assert.match(transportScript, /sendLocalMessage/);
    assert.match(transportScript, /runLocalModerationCommand/);
    assert.equal(scriptResponse.status, 200);
    assert.match(scriptResponse.headers.get('content-type'), /^text\/javascript/);
    assert.match(script, /createDefaultViewerTransportClient/);
    assert.doesNotMatch(script, /new WebSocket/);
    assert.doesNotMatch(script, /fetch\('/);
    assert.match(script, /chat\.message/);
    assert.match(script, /createTwitchPlayerUrl/);
    assert.match(script, /renderedPlayerKey/);
    assert.match(script, /PLAYER_ADAPTERS/);
    assert.match(script, /player-source-button/);
    assert.match(script, /viewers\.update/);
    assert.match(script, /renderViewerCards/);
    assert.match(script, /shouldAutoscrollChat/);
    assert.match(script, /scheduleRender/);
    assert.match(script, /pendingRenderFrame/);
    assert.match(script, /forceChatRender/);
    assert.match(script, /chatDomDirty/);
    assert.match(script, /chat-emote--extension/);
    assert.match(script, /markLargeExtensionEmote/);
    assert.match(script, /maintainChatBottomAfterMediaLoad/);
    assert.match(script, /__chatScrollDebug/);
    assert.match(script, /chatScrollDebug/);
    assert.match(script, /pinned_change/);
    assert.match(script, /CHAT_BOTTOM_TOLERANCE_PX/);
    assert.match(script, /MAX_MESSAGES/);
    assert.match(script, /message__badge/);
    assert.match(script, /shouldRenderAuthorAvatar/);
    assert.match(script, /\/viewer\/assets\/twitch-glitch\.svg/);
    assert.match(script, /unseenMessageCount/);
    assert.match(script, /updateResumeChatControl/);
    assert.match(script, /activeChatPlatforms/);
    assert.match(script, /getVisibleChatMessages/);
    assert.match(script, /LOCAL_SESSION_STORAGE_KEY/);
    assert.match(script, /localModerationCommands/);
    assert.match(script, /localChatSuggestions/);
    assert.match(script, /consumeGoogleOAuthRedirect/);
    assert.match(script, /completeGoogleOAuth/);
    assert.match(script, /createGoogleOAuthStartUrl/);
    assert.match(script, /detectViewerMode/);
    assert.match(script, /dataset\.viewerMode/);
    assert.match(script, /\/popout/);
    assert.match(script, /createViewerCardTooltip/);
    assert.match(script, /clearChatFeed/);
    assert.match(script, /sendLocalMessage/);
    assert.match(script, /runLocalModerationCommand/);
    assert.match(script, /requestSubmit/);
    assert.doesNotMatch(script, /window\.chatAggregator/);
    assert.equal(styleResponse.status, 200);
    assert.match(styleResponse.headers.get('content-type'), /^text\/css/);
    assert.match(style, /\.message__metadata/);
    assert.match(style, /\.message__badge--kick/);
    assert.match(style, /\.chat-emote--extension/);
    assert.match(style, /\.chat-emote--large/);
    assert.match(style, /\.chat-resume-button/);
    assert.match(style, /\.chat-filter-control/);
    assert.match(style, /\.chat-filter-button/);
    assert.match(style, /align-content: start/);
    assert.match(style, /grid-auto-rows: max-content/);
    assert.match(style, /\.local-chat-controls/);
    assert.match(style, /\.local-chat-suggestions/);
    assert.match(style, /\.message__badge--local/);
    assert.match(style, /\.viewer-status-grid/);
    assert.match(style, /\.chat-action-button/);
    assert.match(style, /body\[data-viewer-mode='popout'\]/);
    assert.match(style, /\.chat-filter-control/);
    assert.equal(overlayScriptResponse.status, 200);
    assert.match(overlayScriptResponse.headers.get('content-type'), /^text\/javascript/);
    assert.match(overlayScript, /createDefaultViewerTransportClient/);
    assert.match(overlayScript, /chat\.message/);
    assert.match(overlayScript, /maxMessages/);
    assert.doesNotMatch(overlayScript, /window\.chatAggregator/);
    assert.equal(overlayStyleResponse.status, 200);
    assert.match(overlayStyleResponse.headers.get('content-type'), /^text\/css/);
    assert.match(overlayStyle, /background: transparent/);
    assert.match(overlayStyle, /\.overlay-message/);
    assert.equal(twitchIconResponse.status, 200);
    assert.match(twitchIconResponse.headers.get('content-type'), /^image\/svg\+xml/);
    assert.match(twitchIcon, /aria-label="Twitch"/);
  } finally {
    await gateway.stop();
  }
});

test('hides admin routes when ADMIN_TOKEN is not configured', async () => {
  const gateway = createHttpGateway({ getSnapshot: () => ({}), port: 0 });

  try {
    const address = await gateway.start();
    const adminResponse = await fetch(localUrl(address, '/admin'));
    const adminScriptResponse = await fetch(localUrl(address, '/admin/admin-mode.js'));
    const sessionResponse = await fetch(localUrl(address, '/api/admin/session'));

    assert.equal(adminResponse.status, 404);
    assert.equal(adminScriptResponse.status, 404);
    assert.equal(sessionResponse.status, 404);
  } finally {
    await gateway.stop();
  }
});

test('serves the admin shell and protects session APIs with a configured admin cookie', async () => {
  const gateway = createHttpGateway({
    adminSessionIdFactory: () => 'admin-session-1',
    adminToken: 'demo-admin-token',
    getSnapshot: () => ({}),
    port: 0,
  });

  try {
    const address = await gateway.start();
    const adminShellResponse = await fetch(localUrl(address, '/admin'));
    const adminStyleResponse = await fetch(localUrl(address, '/admin/admin-mode.css'));
    const adminScriptResponse = await fetch(localUrl(address, '/admin/admin-mode.js'));
    const adminShell = await adminShellResponse.text();
    const adminStyle = await adminStyleResponse.text();
    const adminScript = await adminScriptResponse.text();
    const anonymousSessionResponse = await fetch(localUrl(address, '/api/admin/session'));
    const queryTokenResponse = await postJson(
      localUrl(address, '/api/admin/login?token=demo-admin-token'),
      {},
    );
    const loginResponse = await postJson(localUrl(address, '/api/admin/login'), {
      token: 'demo-admin-token',
    });
    const loginBody = await loginResponse.json();
    const setCookie = loginResponse.headers.get('set-cookie');
    const sessionCookie = setCookie.split(';')[0];
    const sessionResponse = await fetch(localUrl(address, '/api/admin/session'), {
      headers: { Cookie: sessionCookie },
    });
    const logoutResponse = await postJson(
      localUrl(address, '/api/admin/logout'),
      {},
      undefined,
      { Cookie: sessionCookie },
    );
    const expiredCookie = logoutResponse.headers.get('set-cookie');
    const loggedOutSessionResponse = await fetch(localUrl(address, '/api/admin/session'), {
      headers: { Cookie: sessionCookie },
    });

    assert.equal(adminShellResponse.status, 200);
    assert.match(adminShellResponse.headers.get('content-type'), /^text\/html/);
    assert.match(adminShell, /data-login-form/);
    assert.match(adminShell, /data-config-form/);
    assert.match(adminShell, /data-moderator-form/);
    assert.match(adminShell, /data-moderator-list/);
    assert.match(adminShell, /data-x-login/);
    assert.match(adminShell, /admin-mode\.js/);
    assert.match(adminShell, /admin-mode\.css/);
    assert.equal(adminStyleResponse.status, 200);
    assert.match(adminStyleResponse.headers.get('content-type'), /^text\/css/);
    assert.match(adminStyle, /\.admin-shell/);
    assert.match(adminStyle, /\.moderator-row/);
    assert.equal(adminScriptResponse.status, 200);
    assert.match(adminScriptResponse.headers.get('content-type'), /^text\/javascript/);
    assert.match(adminScript, /\/api\/admin\/session/);
    assert.match(adminScript, /\/api\/admin\/login/);
    assert.match(adminScript, /\/api\/admin\/logout/);
    assert.match(adminScript, /\/api\/admin\/config/);
    assert.match(adminScript, /\/api\/admin\/moderators/);
    assert.match(adminScript, /\/api\/admin\/x\/login/);
    assert.doesNotMatch(adminShell, /demo-admin-token/);
    assert.doesNotMatch(adminScript, /demo-admin-token/);
    assert.deepEqual(await anonymousSessionResponse.json(), { authenticated: false });
    assert.equal(queryTokenResponse.status, 401);
    assert.equal(loginResponse.status, 200);
    assert.deepEqual(loginBody, { authenticated: true, role: 'admin' });
    assert.match(setCookie, /uca_admin_session=admin-session-1/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.deepEqual(await sessionResponse.json(), { authenticated: true, role: 'admin' });
    assert.equal(logoutResponse.status, 200);
    assert.match(expiredCookie, /Max-Age=0/);
    assert.deepEqual(await loggedOutSessionResponse.json(), { authenticated: false });
  } finally {
    await gateway.stop();
  }
});

test('protects and opens X browser login sessions from admin APIs', async () => {
  const openedLogins = [];
  const gateway = createHttpGateway({
    adminSessionIdFactory: () => 'admin-session-x-login',
    adminToken: 'demo-admin-token',
    getSnapshot: () => ({}),
    openXLoginSession: ({ liveUrl }) => {
      openedLogins.push(liveUrl);
      return {
        opened: true,
        profileDir: 'C:\\data\\x-browser-profile\\x-chooserich',
        url: 'https://x.com',
      };
    },
    port: 0,
  });

  try {
    const address = await gateway.start();
    const blockedResponse = await postJson(
      localUrl(address, '/api/admin/x/login'),
      { liveUrl: '@chooserich' },
    );
    const loginResponse = await postJson(localUrl(address, '/api/admin/login'), {
      token: 'demo-admin-token',
    });
    const sessionCookie = loginResponse.headers.get('set-cookie').split(';')[0];
    const openResponse = await postJson(
      localUrl(address, '/api/admin/x/login'),
      { liveUrl: '@chooserich' },
      undefined,
      { Cookie: sessionCookie },
    );

    assert.equal(blockedResponse.status, 401);
    assert.equal(openResponse.status, 202);
    assert.deepEqual(await openResponse.json(), {
      opened: true,
      url: 'https://x.com',
    });
    assert.deepEqual(openedLogins, ['@chooserich']);
  } finally {
    await gateway.stop();
  }
});

test('protects and persists browser backend admin config', async () => {
  const browserConfigStore = createTestBrowserConfigStore();
  let updatedConfig;
  const gateway = createHttpGateway({
    adminSessionIdFactory: () => 'admin-session-config',
    adminToken: 'demo-admin-token',
    browserConfigStore,
    getSnapshot: () => ({
      manifest: { title: 'Public Snapshot', sources: [] },
      protocolVersion: '1',
      statuses: [],
      viewers: { sources: [], total: 0 },
    }),
    onBrowserConfigUpdate: (config) => {
      updatedConfig = config;
    },
    port: 0,
  });

  try {
    const address = await gateway.start();
    const blockedResponse = await fetch(localUrl(address, '/api/admin/config'));
    const snapshotResponse = await fetch(address.snapshotUrl);
    const loginResponse = await postJson(localUrl(address, '/api/admin/login'), {
      token: 'demo-admin-token',
    });
    const sessionCookie = loginResponse.headers.get('set-cookie').split(';')[0];
    const defaultConfigResponse = await fetch(localUrl(address, '/api/admin/config'), {
      headers: { Cookie: sessionCookie },
    });
    const saveResponse = await putJson(
      localUrl(address, '/api/admin/config'),
      {
        sources: {
          kick: [{ channel: 'xqc', enabled: true, token: 'secret' }],
          twitch: [{ channel: 'Monstercat', enabled: true }],
          x: [{ enabled: true, liveUrl: '@chooserich' }],
        },
        viewer: {
          showExternalChats: false,
          theme: 'light',
          title: 'Admin Demo',
        },
      },
      { Cookie: sessionCookie },
    );
    const savedConfig = await saveResponse.json();
    const reloadedConfigResponse = await fetch(localUrl(address, '/api/admin/config'), {
      headers: { Cookie: sessionCookie },
    });

    assert.equal(blockedResponse.status, 401);
    assert.equal(defaultConfigResponse.status, 200);
    assert.equal((await defaultConfigResponse.json()).viewer.title, 'Unified Chat Aggregator');
    assert.equal(saveResponse.status, 200);
    assert.equal(savedConfig.viewer.title, 'Admin Demo');
    assert.equal(savedConfig.viewer.showExternalChats, false);
    assert.equal(savedConfig.sources.twitch[0].channel, 'Monstercat');
    assert.equal(savedConfig.sources.kick[0].channel, 'xqc');
    assert.equal(savedConfig.sources.x[0].liveUrl, '@chooserich');
    assert.doesNotMatch(JSON.stringify(savedConfig), /secret|token/);
    assert.deepEqual(await reloadedConfigResponse.json(), savedConfig);
    assert.deepEqual(browserConfigStore.load(), savedConfig);
    assert.deepEqual(updatedConfig, savedConfig);
    assert.equal((await snapshotResponse.json()).manifest.title, 'Public Snapshot');
  } finally {
    await gateway.stop();
  }
});

test('protects and manages local chat moderators from admin APIs', async () => {
  const localChatStore = createTestLocalChatStore();
  const gateway = createHttpGateway({
    adminSessionIdFactory: () => 'admin-session-moderators',
    adminToken: 'demo-admin-token',
    getSnapshot: () => ({}),
    localChatStore,
    port: 0,
  });

  try {
    const address = await gateway.start();
    const blockedResponse = await fetch(localUrl(address, '/api/admin/moderators'));
    const loginResponse = await postJson(localUrl(address, '/api/admin/login'), {
      token: 'demo-admin-token',
    });
    const sessionCookie = loginResponse.headers.get('set-cookie').split(';')[0];
    const emptyResponse = await fetch(localUrl(address, '/api/admin/moderators'), {
      headers: { Cookie: sessionCookie },
    });
    const addResponse = await postJson(
      localUrl(address, '/api/admin/moderators'),
      { email: 'MOD@example.com', nick: 'ModUser' },
      undefined,
      { Cookie: sessionCookie },
    );
    const addBody = await addResponse.json();
    const listResponse = await fetch(localUrl(address, '/api/admin/moderators'), {
      headers: { Cookie: sessionCookie },
    });
    const deleteResponse = await fetch(
      localUrl(address, `/api/admin/moderators/${encodeURIComponent(addBody.moderator.id)}`),
      {
        headers: { Cookie: sessionCookie },
        method: 'DELETE',
      },
    );

    assert.equal(blockedResponse.status, 401);
    assert.deepEqual(await emptyResponse.json(), { moderators: [] });
    assert.equal(addResponse.status, 201);
    assert.equal(addBody.moderator.email, 'MOD@example.com');
    assert.equal(addBody.moderator.nick, 'ModUser');
    assert.equal(addBody.moderator.id, 'email=mod%40example.com&nick=moduser');
    assert.equal((await listResponse.json()).moderators.length, 1);
    assert.deepEqual(await deleteResponse.json(), { moderators: [], removed: 1 });
  } finally {
    await gateway.stop();
  }
});

test('rejects write methods and unknown routes', async () => {
  const gateway = createHttpGateway({ getSnapshot: () => ({}), port: 0 });

  try {
    const address = await gateway.start();
    const writeResponse = await fetch(address.snapshotUrl, { method: 'POST' });
    const viewerWriteResponse = await fetch(address.viewerUrl, { method: 'POST' });
    const popoutWriteResponse = await fetch(address.popoutUrl, { method: 'POST' });
    const overlayWriteResponse = await fetch(address.overlayUrl, { method: 'POST' });
    const missingResponse = await fetch(`http://${address.host}:${address.port}/api/v1/missing`);

    assert.equal(writeResponse.status, 405);
    assert.equal(writeResponse.headers.get('allow'), 'GET');
    assert.equal(viewerWriteResponse.status, 405);
    assert.equal(viewerWriteResponse.headers.get('allow'), 'GET');
    assert.equal(popoutWriteResponse.status, 405);
    assert.equal(popoutWriteResponse.headers.get('allow'), 'GET');
    assert.equal(overlayWriteResponse.status, 405);
    assert.equal(overlayWriteResponse.headers.get('allow'), 'GET');
    assert.equal(missingResponse.status, 404);
  } finally {
    await gateway.stop();
  }
});

test('keeps local chat endpoints disabled unless a local store is configured', async () => {
  const gateway = createHttpGateway({ getSnapshot: () => ({}), port: 0 });

  try {
    const address = await gateway.start();
    const response = await postJson(localUrl(address, '/api/v1/local/register'), {
      email: 'ana@example.com',
      nick: 'ana',
    });

    assert.equal(response.status, 404);
  } finally {
    await gateway.stop();
  }
});

test('reports Google OAuth status and redirects authorization starts', async () => {
  let authorizationOptions;
  const googleOAuthService = createFakeGoogleOAuthService({
    onCreateAuthorizationUrl: (options) => {
      authorizationOptions = options;
    },
  });
  const gateway = createHttpGateway({
    getSnapshot: () => ({}),
    googleOAuthService,
    localChatStore: createTestLocalChatStore(),
    port: 0,
  });

  try {
    const address = await gateway.start();
    const statusResponse = await fetch(localUrl(address, '/api/v1/auth/google/status'));
    const startResponse = await fetch(
      localUrl(address, '/api/v1/auth/google/start?returnTo=/viewer?debugChat=1&resultKey=result-1'),
      { redirect: 'manual' },
    );

    assert.equal(statusResponse.status, 200);
    assert.deepEqual(await statusResponse.json(), { enabled: true });
    assert.equal(startResponse.status, 302);
    assert.equal(startResponse.headers.get('location'), 'https://accounts.google.com/mock');
    assert.deepEqual(authorizationOptions, {
      resultKey: 'result-1',
      returnTo: '/viewer?debugChat=1',
    });

    const popoutStartResponse = await fetch(
      localUrl(address, '/api/v1/auth/google/start?returnTo=/popout&resultKey=result-2'),
      { redirect: 'manual' },
    );

    assert.equal(popoutStartResponse.status, 302);
    assert.deepEqual(authorizationOptions, {
      resultKey: 'result-2',
      returnTo: '/popout',
    });
  } finally {
    await gateway.stop();
  }
});

test('serves local moderation command suggestions', async () => {
  const gateway = createHttpGateway({
    getSnapshot: () => ({}),
    localChatStore: createTestLocalChatStore(),
    port: 0,
  });

  try {
    const address = await gateway.start();
    const response = await fetch(localUrl(address, '/api/v1/local/moderation-commands'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(
      body.commands.map((command) => command.name),
      ['/ban', '/timeout', '/unban', '/untimeout', '/mod', '/unmod', '/ban-email', '/unban-email'],
    );
  } finally {
    await gateway.stop();
  }
});

test('keeps app ingestion disabled unless a token is configured', async () => {
  const gateway = createHttpGateway({ getSnapshot: () => ({}), port: 0 });

  try {
    const address = await gateway.start();
    const response = await postJson(localUrl(address, '/api/v1/app/events'), {
      data: { sources: [], total: 1 },
      type: 'viewers.update',
    });

    assert.equal(response.status, 404);
  } finally {
    await gateway.stop();
  }
});

test('requires a valid token for app ingestion', async () => {
  const gateway = createHttpGateway({
    appIngestToken: 'secret-token',
    getSnapshot: () => ({}),
    port: 0,
  });

  try {
    const address = await gateway.start();
    const response = await postJson(localUrl(address, '/api/v1/app/events'), {
      data: { sources: [], total: 1 },
      type: 'viewers.update',
    }, 'wrong-token');

    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /token is invalid/);
  } finally {
    await gateway.stop();
  }
});

test('accepts app ingestion events and publishes them over realtime', async () => {
  let snapshot = {
    generatedAt: '2026-06-08T12:00:00.000Z',
    manifest: { sources: [], title: 'Test' },
    protocolVersion: '1',
    statuses: [],
    viewers: { sources: [], total: 0 },
  };
  const gateway = createHttpGateway({
    appIngestToken: 'secret-token',
    getSnapshot: () => snapshot,
    onAppEvent: (event) => {
      snapshot = { ...snapshot, viewers: event.data };
    },
    port: 0,
  });
  let client;

  try {
    const address = await gateway.start();

    client = new WebSocket(address.eventsUrl);
    await once(client, 'message');
    const nextMessage = once(client, 'message');
    const response = await postJson(localUrl(address, '/api/v1/app/events'), {
      data: { sources: [], total: 5 },
      type: 'viewers.update',
    }, 'secret-token');
    const body = await response.json();
    const [eventPayload] = await nextMessage;
    const event = JSON.parse(eventPayload.toString());
    const snapshotResponse = await fetch(address.snapshotUrl);

    assert.equal(response.status, 202);
    assert.deepEqual(body, { accepted: true, published: 1 });
    assert.equal(event.type, 'viewers.update');
    assert.deepEqual(event.data, { sources: [], total: 5 });
    assert.deepEqual((await snapshotResponse.json()).viewers, { sources: [], total: 5 });
  } finally {
    client?.close();
    await gateway.stop();
  }
});

test('rejects invalid app ingestion event types', async () => {
  const gateway = createHttpGateway({
    appIngestToken: 'secret-token',
    getSnapshot: () => ({}),
    port: 0,
  });

  try {
    const address = await gateway.start();
    const response = await postJson(localUrl(address, '/api/v1/app/events'), {
      data: {},
      type: 'bad.event',
    }, 'secret-token');

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /event type is invalid/);
  } finally {
    await gateway.stop();
  }
});

test('keeps Google OAuth disabled when it is not configured', async () => {
  const gateway = createHttpGateway({
    getSnapshot: () => ({}),
    localChatStore: createTestLocalChatStore(),
    port: 0,
  });

  try {
    const address = await gateway.start();
    const statusResponse = await fetch(localUrl(address, '/api/v1/auth/google/status'));
    const startResponse = await fetch(
      localUrl(address, '/api/v1/auth/google/start'),
      { redirect: 'manual' },
    );

    assert.equal(statusResponse.status, 200);
    assert.deepEqual(await statusResponse.json(), { enabled: false });
    assert.equal(startResponse.status, 404);
  } finally {
    await gateway.stop();
  }
});

test('keeps Google OAuth disabled without a local chat store', async () => {
  const gateway = createHttpGateway({
    getSnapshot: () => ({}),
    googleOAuthService: createFakeGoogleOAuthService(),
    port: 0,
  });

  try {
    const address = await gateway.start();
    const response = await fetch(localUrl(address, '/api/v1/auth/google/status'));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { enabled: false });
  } finally {
    await gateway.stop();
  }
});

test('redirects Google OAuth callbacks to existing local sessions', async () => {
  const localChatStore = createTestLocalChatStore();
  const googleOAuthService = createFakeGoogleOAuthService({
    callbackResult: {
      profile: { email: 'ana@example.com', name: 'Ana' },
      returnTo: '/viewer?debugChat=1',
      ticket: 'ticket-1',
    },
  });
  const user = localChatStore.registerUser({ email: 'ana@example.com', nick: 'ana' });
  const gateway = createHttpGateway({
    getSnapshot: () => ({}),
    googleOAuthService,
    localChatStore,
    port: 0,
  });

  try {
    const address = await gateway.start();
    const response = await fetch(
      localUrl(address, '/api/v1/auth/google/callback?code=code-1&state=state-1'),
      { redirect: 'manual' },
    );
    const redirectUrl = new URL(response.headers.get('location'), `http://${address.host}:${address.port}`);
    const hash = new URLSearchParams(redirectUrl.hash.slice(1));
    const redirectedUser = JSON.parse(hash.get('localUser'));

    assert.equal(response.status, 302);
    assert.equal(redirectUrl.pathname, '/viewer');
    assert.equal(redirectUrl.search, '?debugChat=1');
    assert.match(hash.get('localToken'), /id-/);
    assert.equal(redirectedUser.id, user.id);
    assert.equal(redirectedUser.nick, 'ana');
  } finally {
    await gateway.stop();
  }
});

test('completes Google OAuth tickets for new local chat users', async () => {
  const gateway = createHttpGateway({
    getSnapshot: () => ({}),
    googleOAuthService: createFakeGoogleOAuthService(),
    localChatStore: createTestLocalChatStore(),
    port: 0,
  });

  try {
    const address = await gateway.start();
    const response = await postJson(localUrl(address, '/api/v1/auth/google/complete'), {
      nick: 'GoogleUser',
      ticket: 'ticket-1',
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.match(body.session.token, /id-/);
    assert.equal(body.user.email, 'google@example.com');
    assert.equal(body.user.nick, 'GoogleUser');
  } finally {
    await gateway.stop();
  }
});

test('registers, logs in, and resolves local chat users', async () => {
  const gateway = createHttpGateway({
    getSnapshot: () => ({}),
    localChatStore: createTestLocalChatStore(),
    port: 0,
  });

  try {
    const address = await gateway.start();
    const registerResponse = await postJson(localUrl(address, '/api/v1/local/register'), {
      email: 'ana@example.com',
      nick: 'ana',
    });
    const registerBody = await registerResponse.json();

    assert.equal(registerResponse.status, 201);
    assert.equal(registerBody.user.nick, 'ana');
    assert.match(registerBody.session.token, /id-/);

    const loginResponse = await postJson(localUrl(address, '/api/v1/local/login'), {
      email: 'ANA@example.com',
    });
    const loginBody = await loginResponse.json();

    assert.equal(loginResponse.status, 200);
    assert.equal(loginBody.user.email, 'ana@example.com');

    const meResponse = await fetch(localUrl(address, '/api/v1/local/me'), {
      headers: { Authorization: `Bearer ${loginBody.session.token}` },
    });

    assert.equal(meResponse.status, 200);
    assert.equal((await meResponse.json()).user.nick, 'ana');
  } finally {
    await gateway.stop();
  }
});

test('publishes local chat messages over realtime', async () => {
  const localChatStore = createTestLocalChatStore();
  const appMessages = [];
  const gateway = createHttpGateway({
    getSnapshot: () => ({}),
    localChatStore,
    onLocalChatMessage: (message) => appMessages.push(message),
    port: 0,
  });
  let client;

  try {
    const address = await gateway.start();
    const registerResponse = await postJson(localUrl(address, '/api/v1/local/register'), {
      email: 'ana@example.com',
      nick: 'ana',
    });
    const { session } = await registerResponse.json();

    client = new WebSocket(address.eventsUrl);
    await once(client, 'message');
    const nextMessage = once(client, 'message');
    const messageResponse = await postJson(
      localUrl(address, '/api/v1/local/messages'),
      { text: ' hello local ' },
      session.token,
    );
    const messageBody = await messageResponse.json();
    const [eventPayload] = await nextMessage;
    const event = JSON.parse(eventPayload.toString());

    assert.equal(messageResponse.status, 201);
    assert.equal(messageBody.message.text, 'hello local');
    assert.equal(event.type, 'chat.message');
    assert.equal(event.data.source.platform, 'local');
    assert.equal(event.data.text, 'hello local');
    assert.equal(appMessages.length, 1);
    assert.equal(appMessages[0].platform, 'local');
    assert.equal(appMessages[0].text, 'hello local');
  } finally {
    client?.close();
    await gateway.stop();
  }
});

test('runs local chat moderation commands for moderators', async () => {
  const localChatStore = createTestLocalChatStore();
  const gateway = createHttpGateway({ getSnapshot: () => ({}), localChatStore, port: 0 });

  try {
    const address = await gateway.start();
    const modRegisterResponse = await postJson(localUrl(address, '/api/v1/local/register'), {
      email: 'mod@example.com',
      nick: 'mod_user',
    });
    const { session: modSession } = await modRegisterResponse.json();

    localChatStore.addModerator({ email: 'mod@example.com' });

    const userRegisterResponse = await postJson(localUrl(address, '/api/v1/local/register'), {
      email: 'ana@example.com',
      nick: 'ana',
    });
    const { session: userSession } = await userRegisterResponse.json();
    const moderationResponse = await postJson(
      localUrl(address, '/api/v1/local/moderation'),
      { command: '/ban ana spam' },
      modSession.token,
    );

    assert.equal(moderationResponse.status, 200);
    assert.equal((await moderationResponse.json()).moderation.action, 'ban');

    const blockedResponse = await postJson(
      localUrl(address, '/api/v1/local/messages'),
      { text: 'blocked' },
      userSession.token,
    );

    assert.equal(blockedResponse.status, 400);
    assert.match((await blockedResponse.json()).error, /banned/);
  } finally {
    await gateway.stop();
  }
});

test('rejects local chat moderation commands from normal users', async () => {
  const gateway = createHttpGateway({
    getSnapshot: () => ({}),
    localChatStore: createTestLocalChatStore(),
    port: 0,
  });

  try {
    const address = await gateway.start();
    const registerResponse = await postJson(localUrl(address, '/api/v1/local/register'), {
      email: 'ana@example.com',
      nick: 'ana',
    });
    const { session } = await registerResponse.json();
    const moderationResponse = await postJson(
      localUrl(address, '/api/v1/local/moderation'),
      { command: '/ban other spam' },
      session.token,
    );

    assert.equal(moderationResponse.status, 403);
  } finally {
    await gateway.stop();
  }
});

test('does not expose snapshot errors', async () => {
  const gateway = createHttpGateway({
    getSnapshot: () => {
      throw new Error('secret token failed');
    },
    port: 0,
  });

  try {
    const address = await gateway.start();
    const response = await fetch(address.snapshotUrl);
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, { error: 'Snapshot unavailable.' });
    assert.doesNotMatch(JSON.stringify(body), /secret|token/);
  } finally {
    await gateway.stop();
  }
});

test('starts once and stops idempotently', async () => {
  const gateway = createHttpGateway({ getSnapshot: () => ({}), port: 0 });
  const firstAddress = await gateway.start();
  const secondAddress = await gateway.start();

  assert.deepEqual(secondAddress, firstAddress);

  await gateway.stop();
  await gateway.stop();
  assert.equal(gateway.getAddress(), undefined);
});

test('rejects invalid configured ports', () => {
  assert.throws(
    () => createHttpGateway({ getSnapshot: () => ({}), port: 'invalid' }),
    /port must be an integer/,
  );
});

test('sends an initial snapshot and publishes realtime events', async () => {
  const snapshot = { protocolVersion: '1', statuses: [], viewers: { sources: [], total: 0 } };
  const gateway = createHttpGateway({ getSnapshot: () => snapshot, port: 0 });
  let client;

  try {
    const address = await gateway.start();
    client = new WebSocket(address.eventsUrl);
    const [initialPayload] = await once(client, 'message');
    const initialEvent = JSON.parse(initialPayload.toString());

    assert.equal(initialEvent.type, 'snapshot.replace');
    assert.deepEqual(initialEvent.data, snapshot);

    const nextMessage = once(client, 'message');
    assert.equal(gateway.publish('viewers.update', { total: 42 }), 1);

    const [updatePayload] = await nextMessage;
    const updateEvent = JSON.parse(updatePayload.toString());

    assert.equal(updateEvent.type, 'viewers.update');
    assert.deepEqual(updateEvent.data, { total: 42 });
    assert.match(updateEvent.eventId, /.+/);
    assert.match(updateEvent.emittedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    client?.close();
    await gateway.stop();
  }
});

test('returns zero when publishing without connected clients', async () => {
  const gateway = createHttpGateway({ getSnapshot: () => ({}), port: 0 });

  try {
    await gateway.start();
    assert.equal(gateway.publish('viewers.update', { total: 0 }), 0);
  } finally {
    await gateway.stop();
  }
});

test('rejects browser websocket connections from external origins', async () => {
  const gateway = createHttpGateway({ getSnapshot: () => ({}), port: 0 });

  try {
    const address = await gateway.start();
    const client = new WebSocket(address.eventsUrl, {
      origin: 'https://external.example',
    });
    const [error] = await once(client, 'error');

    assert.match(error.message, /Unexpected server response: 403/);
  } finally {
    await gateway.stop();
  }
});
