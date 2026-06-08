const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const { WebSocket } = require('ws');
const { createHttpGateway, GATEWAY_HOST } = require('../src/gateway/http-gateway');

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
    assert.match(html, /data-resume-chat/);
    assert.doesNotMatch(html, /window\.chatAggregator/);
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
    assert.match(style, /\.viewer-status-grid/);
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

test('rejects write methods and unknown routes', async () => {
  const gateway = createHttpGateway({ getSnapshot: () => ({}), port: 0 });

  try {
    const address = await gateway.start();
    const writeResponse = await fetch(address.snapshotUrl, { method: 'POST' });
    const viewerWriteResponse = await fetch(address.viewerUrl, { method: 'POST' });
    const overlayWriteResponse = await fetch(address.overlayUrl, { method: 'POST' });
    const missingResponse = await fetch(`http://${address.host}:${address.port}/api/v1/missing`);

    assert.equal(writeResponse.status, 405);
    assert.equal(writeResponse.headers.get('allow'), 'GET');
    assert.equal(viewerWriteResponse.status, 405);
    assert.equal(viewerWriteResponse.headers.get('allow'), 'GET');
    assert.equal(overlayWriteResponse.status, 405);
    assert.equal(overlayWriteResponse.headers.get('allow'), 'GET');
    assert.equal(missingResponse.status, 404);
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
