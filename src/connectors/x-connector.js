const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ipcMain } = require('electron');
const { normalizeXMessage } = require('./x-message-parser');
const { extractXNetworkEvents } = require('./x-network-parser');

const X_CAPTURE_WINDOW_WIDTH = 1280;
const X_CAPTURE_WINDOW_HEIGHT = 900;
const X_CAPTURE_OFFSCREEN_POSITION = -10_000;
const X_CAPTURE_PARTITION = 'persist:x-capture';
const X_COMPOSER_UNAVAILABLE_CODE = 'x-composer-unavailable';
const X_COMPOSER_UNAVAILABLE_MESSAGE =
  'X chat composer is unavailable. X may require Premium or chat permission for this live; open the X capture window to confirm this account can write there.';
const CDP_PROTOCOL_VERSION = '1.3';

const createXConnector = ({
  liveUrl,
  BrowserWindow,
  ipcMainImpl = ipcMain,
  show = false,
  partition = X_CAPTURE_PARTITION,
  source,
} = {}) => {
  const events = new EventEmitter();
  const normalizedLiveUrl = normalizeXLiveUrl(liveUrl);
  const captureUrl = createXCaptureUrl(normalizedLiveUrl);
  const avatarUrlsByUser = new Map();
  let discoveredSource = source;
  let captureWindow;
  let detachNetworkCapture;
  let unsubscribeIpc;

  const emitMessagePayload = async (payload) => {
    try {
      const payloadWithCachedAvatar = applyCachedXAvatar(payload, avatarUrlsByUser);
      const enrichedPayload = await enrichXPayloadFromCaptureWindow(
        payloadWithCachedAvatar,
        captureWindow,
      );
      const nextSource = mergeXSource(discoveredSource, enrichedPayload.source);

      if (nextSource?.sourceId) {
        discoveredSource = nextSource;
      }

      rememberXAvatar(enrichedPayload, avatarUrlsByUser);

      events.emit('message', normalizeXMessage({
        ...enrichedPayload,
        ...(discoveredSource?.sourceId ? { source: discoveredSource } : {}),
      }));
    } catch (error) {
      events.emit('connector-error', error);
    }
  };

  const connect = async () => {
    if (captureWindow && !captureWindow.isDestroyed()) {
      return;
    }

    captureWindow = new BrowserWindow({
      width: X_CAPTURE_WINDOW_WIDTH,
      height: X_CAPTURE_WINDOW_HEIGHT,
      x: show ? undefined : X_CAPTURE_OFFSCREEN_POSITION,
      y: show ? undefined : X_CAPTURE_OFFSCREEN_POSITION,
      show: false,
      skipTaskbar: !show,
      focusable: show,
      autoHideMenuBar: true,
      title: 'X Chat Capture',
      webPreferences: {
        preload: path.join(__dirname, '..', 'x-capture-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition,
        backgroundThrottling: false,
      },
    });

    if (show) {
      captureWindow.show();
    } else {
      captureWindow.showInactive?.();
    }

    detachNetworkCapture = attachXNetworkCapture(captureWindow.webContents, {
      onMessage: (payload) => {
        void emitMessagePayload(payload);
      },
      onStatus: (status) => events.emit('status', status),
    });

    const senderId = captureWindow.webContents.id;

    const onMessage = (event, payload) => {
      if (event.sender.id !== senderId) {
        return;
      }

      void emitMessagePayload(payload);
    };

    const onStatus = (event, status) => {
      if (event.sender.id === senderId) {
        events.emit('status', status);
      }
    };

    ipcMainImpl.on('x-capture:message', onMessage);
    ipcMainImpl.on('x-capture:status', onStatus);
    unsubscribeIpc = () => {
      ipcMainImpl.off('x-capture:message', onMessage);
      ipcMainImpl.off('x-capture:status', onStatus);
    };

    captureWindow.on('closed', () => {
      captureWindow = undefined;
      detachNetworkCapture?.();
      detachNetworkCapture = undefined;
      unsubscribeIpc?.();
      unsubscribeIpc = undefined;
    });

    try {
      await captureWindow.loadURL(captureUrl);
    } catch (error) {
      events.emit('connector-error', error);
    }
  };

  const disconnect = async () => {
    unsubscribeIpc?.();
    unsubscribeIpc = undefined;
    detachNetworkCapture?.();
    detachNetworkCapture = undefined;

    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.close();
    }

    captureWindow = undefined;
  };

  return {
    platform: 'x',
    liveUrl: normalizedLiveUrl,
    captureUrl,
    onMessage: (listener) => {
      events.on('message', listener);
      return () => events.off('message', listener);
    },
    onError: (listener) => {
      events.on('connector-error', listener);
      return () => events.off('connector-error', listener);
    },
    onStatus: (listener) => {
      events.on('status', listener);
      return () => events.off('status', listener);
    },
    connect,
    disconnect,
    debugCaptureContext,
    send,
  };

  async function debugCaptureContext() {
    if (!captureWindow || captureWindow.isDestroyed()) {
      return {
        captureUrl,
        connected: false,
        source: discoveredSource,
      };
    }

    const context = await captureWindow.webContents.executeJavaScript(
      createXDebugCaptureContextScript(),
      true,
    );

    return {
      captureUrl,
      connected: true,
      context,
      source: discoveredSource,
    };
  }

  async function send(text) {
    const normalizedText = normalizeXSendText(text);

    if (!captureWindow || captureWindow.isDestroyed()) {
      throw new Error('X capture window is not connected.');
    }

    const result = await captureWindow.webContents.executeJavaScript(
      createXSendMessageScript(normalizedText),
      true,
    );

    if (!result?.ok) {
      throw createXSendError(result);
    }

    return result;
  }
};

const normalizeXLiveUrl = (liveUrl) => {
  if (typeof liveUrl !== 'string' || liveUrl.trim().length === 0) {
    throw new TypeError('X live URL or handle must be a non-empty string.');
  }

  const trimmedValue = liveUrl.trim();
  const handleUrl = createXLiveChatUrlFromHandle(trimmedValue);

  if (handleUrl) {
    return handleUrl;
  }

  const parsedUrl = new URL(trimmedValue);

  if (!['x.com', 'twitter.com'].includes(parsedUrl.hostname.toLowerCase())) {
    throw new TypeError('X live URL must point to x.com or twitter.com.');
  }

  return parsedUrl.toString();
};

const createXCaptureUrl = (liveUrl) => {
  const parsedUrl = new URL(normalizeXLiveUrl(liveUrl));
  const normalizedPathname = parsedUrl.pathname.replace(/\/+$/, '');

  if (/^\/i\/broadcasts\/[^/]+\/chat$/i.test(normalizedPathname)) {
    parsedUrl.pathname = normalizedPathname.replace(/\/chat$/i, '');
    parsedUrl.search = '';
    parsedUrl.hash = '';
  }

  return parsedUrl.toString();
};

const attachXNetworkCapture = (webContents, { onMessage, onStatus } = {}) => {
  const debuggerApi = webContents?.debugger;

  if (!debuggerApi || typeof debuggerApi.attach !== 'function') {
    return undefined;
  }

  const pendingResponses = new Map();
  const websocketUrls = new Map();
  let attached = false;

  try {
    if (!debuggerApi.isAttached?.()) {
      debuggerApi.attach(CDP_PROTOCOL_VERSION);
    }

    attached = true;
    void sendDebuggerCommand(debuggerApi, 'Network.enable').catch((error) =>
      onStatus?.({ capture: 'network-unavailable', error: error.message, state: 'connected' }),
    );
    onStatus?.({ capture: 'network-attached', state: 'connected' });
  } catch (error) {
    onStatus?.({ capture: 'network-unavailable', error: error.message, state: 'connected' });
    return undefined;
  }

  const handlePayload = (payload, url) => {
    const { messages, viewerCount } = extractXNetworkEvents(payload, { url });

    for (const message of messages) {
      onMessage?.(message);
    }

    if (viewerCount !== undefined) {
      onStatus?.({ capture: 'network-observing', state: 'observing', viewerCount });
    } else if (messages.length > 0) {
      onStatus?.({ capture: 'network-observing', state: 'observing' });
    }
  };

  const onDebuggerMessage = async (_event, method, params = {}) => {
    if (method === 'Network.webSocketCreated') {
      websocketUrls.set(params.requestId, params.url);
      return;
    }

    if (method === 'Network.webSocketClosed') {
      websocketUrls.delete(params.requestId);
      return;
    }

    if (method === 'Network.webSocketFrameReceived') {
      handlePayload(params.response?.payloadData, params.response?.url ?? websocketUrls.get(params.requestId));
      return;
    }

    if (method === 'Network.responseReceived' && isXInspectableResponse(params.response)) {
      pendingResponses.set(params.requestId, params.response.url);
      return;
    }

    if (method !== 'Network.loadingFinished' || !pendingResponses.has(params.requestId)) {
      return;
    }

    const url = pendingResponses.get(params.requestId);

    pendingResponses.delete(params.requestId);

    try {
      const body = await sendDebuggerCommand(debuggerApi, 'Network.getResponseBody', {
        requestId: params.requestId,
      });

      if (body?.base64Encoded) {
        return;
      }

      handlePayload(body?.body, url);
    } catch {
      // Some X responses are streaming or unavailable to CDP after completion.
    }
  };

  debuggerApi.on('message', onDebuggerMessage);

  return () => {
    debuggerApi.off?.('message', onDebuggerMessage);
    pendingResponses.clear();
    websocketUrls.clear();

    if (attached && debuggerApi.isAttached?.()) {
      try {
        debuggerApi.detach();
      } catch {
        // The webContents may already be gone.
      }
    }
  };
};

const isXInspectableResponse = (response = {}) =>
  /^(Fetch|XHR)$/i.test(response.type || '') &&
  /(^|\/\/)([^/]+\.)?(x|twitter)\.com\/|(^|\/\/)([^/]+\.)?(pscp|periscope)\.(tv|com)\/|\/(graphql|i\/api|live|broadcast|chat|timeline|chatapi)\b/i.test(
    response.url || '',
  );

const enrichXPayloadFromCaptureWindow = async (payload, captureWindow) => {
  if (!payload || typeof payload !== 'object' || !captureWindow || captureWindow.isDestroyed()) {
    return payload;
  }

  const username = normalizeOptionalPayloadString(payload.username);
  const authorName = normalizeOptionalPayloadString(payload.authorName);
  const needsAvatar = !payload.avatarUrl && (username || authorName);
  const needsSourceName = !payload.source?.broadcasterName;

  if (!needsAvatar && !needsSourceName) {
    return payload;
  }

  try {
    const result = await captureWindow.webContents.executeJavaScript(
      createXResolveMessageContextScript({ authorName, needsAvatar, username }),
      true,
    );
    const avatarUrl = normalizeOptionalPayloadString(result?.avatarUrl);
    const broadcasterName = normalizeOptionalPayloadString(result?.broadcasterName);
    const channelLabel = normalizeOptionalPayloadString(result?.channelLabel);
    const source = broadcasterName || channelLabel
      ? mergeXSource(payload.source, { broadcasterName, channelLabel, platform: 'x' })
      : payload.source;

    return {
      ...payload,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(source ? { source } : {}),
    };
  } catch {
    return payload;
  }
};

const normalizeOptionalPayloadString = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const applyCachedXAvatar = (payload, avatarUrlsByUser) => {
  if (!payload || typeof payload !== 'object' || payload.avatarUrl) {
    return payload;
  }

  const avatarUrl = avatarUrlsByUser.get(createXAvatarCacheKey(payload));

  return avatarUrl ? { ...payload, avatarUrl } : payload;
};

const rememberXAvatar = (payload, avatarUrlsByUser) => {
  const avatarUrl = normalizeOptionalPayloadString(payload?.avatarUrl);
  const cacheKey = createXAvatarCacheKey(payload);

  if (avatarUrl && cacheKey) {
    avatarUrlsByUser.set(cacheKey, avatarUrl);
  }
};

const createXAvatarCacheKey = (payload) =>
  normalizeOptionalPayloadString(payload?.username)?.replace(/^@+/, '').toLowerCase() ||
  normalizeOptionalPayloadString(payload?.authorName)?.toLowerCase();

const mergeXSource = (currentSource, patchSource) => {
  if (!patchSource || typeof patchSource !== 'object') {
    return currentSource;
  }

  const nextSource = { ...currentSource };

  for (const [key, value] of Object.entries(patchSource)) {
    if (value !== undefined && value !== null && value !== '') {
      nextSource[key] = value;
    }
  }

  return {
    ...nextSource,
    sourceId: nextSource.sourceId ?? currentSource?.sourceId,
    platform: nextSource.platform ?? currentSource?.platform ?? 'x',
  };
};

const sendDebuggerCommand = (debuggerApi, method, params) =>
  new Promise((resolve, reject) => {
    const maybePromise = debuggerApi.sendCommand(method, params, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });

    if (maybePromise?.then) {
      maybePromise.then(resolve, reject);
    }
  });

const createXLiveChatUrlFromHandle = (value) => {
  const handle = value.replace(/^@/, '');

  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return undefined;
  }

  return `https://x.com/${handle}/livechat`;
};

const isPreferredXHandleCandidate = (candidate = {}) =>
  Boolean(candidate.userCell || candidate.userName || candidate.inArticle || candidate.inListItem);

const scoreXHandleCandidate = (candidate = {}) => {
  if (!candidate.handle || candidate.inChatPanel || candidate.isVisible === false) {
    return Number.NEGATIVE_INFINITY;
  }

  const rect = candidate.rect ?? {};
  const viewport = candidate.viewport ?? {};
  let score = 0;

  if (candidate.userCell) {
    score += 120;
  }

  if (candidate.userName) {
    score += 100;
  }

  if (candidate.inArticle) {
    score += 30;
  }

  if (candidate.inListItem) {
    score += 20;
  }

  if (typeof candidate.href === 'string' && candidate.href.length > 0) {
    score += 10;
  }

  if (candidate.tag === 'a') {
    score += 10;
  }

  if (typeof candidate.text === 'string' && candidate.text.startsWith('@')) {
    score += 15;
  }

  if (
    typeof rect.left === 'number' &&
    typeof viewport.width === 'number' &&
    rect.left < viewport.width * 0.1
  ) {
    score -= 80;
  }

  if (
    typeof rect.top === 'number' &&
    typeof viewport.height === 'number' &&
    rect.top < viewport.height * 0.15
  ) {
    score -= 40;
  }

  return score;
};

const rankXHandleCandidates = (candidates = []) => {
  const preferredCandidates = candidates.filter(isPreferredXHandleCandidate);
  const rankedCandidates = (preferredCandidates.length > 0 ? preferredCandidates : candidates)
    .slice()
    .sort((left, right) => scoreXHandleCandidate(right) - scoreXHandleCandidate(left));

  return rankedCandidates[0]?.handle || '';
};

const normalizeXSendText = (text) => {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new TypeError('X message text is required.');
  }

  return text.trim();
};

const createXSendError = (result = {}) => {
  const error = new Error(result.error || 'X send failed.');

  if (result.code) {
    error.code = result.code;
  }

  return error;
};

const isXComposerUnavailableError = (error) => error?.code === X_COMPOSER_UNAVAILABLE_CODE;

const createXResolveMessageContextScript = ({ authorName, needsAvatar = false, username } = {}) => `
(async () => {
  const isPreferredXHandleCandidate = ${isPreferredXHandleCandidate.toString()};
  const targetUsername = ${JSON.stringify(username ?? '')}.replace(/^@+/, '').toLowerCase();
  const targetAuthorName = ${JSON.stringify(authorName ?? '')}.toLowerCase();
  const shouldWaitForAvatar = ${JSON.stringify(Boolean(needsAvatar))};
  const scoreXHandleCandidate = ${scoreXHandleCandidate.toString()};
  const rankXHandleCandidates = ${rankXHandleCandidates.toString()};
  const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const rowSelectors = [
    'article',
    '[data-testid="cellInnerDiv"]',
    '[role="article"]',
    '[role="listitem"]',
  ];
  const imageSelectors = [
    "[data-testid^='UserAvatar-Container-'] img[src]",
    "a[href] img[alt][src]",
    "img[src*='profile_images']",
    "img[src*='pbs.twimg.com']",
    "img[src*='twimg.com']",
    "img[alt][src]",
  ].join(', ');

  const findRow = (element) => {
    let current = element;

    while (current && current !== document.body) {
      if (rowSelectors.some((selector) => current.matches?.(selector))) {
        return current;
      }

      current = current.parentElement;
    }

    return element;
  };

  const rowMatchesTarget = (row, image) => {
    const text = normalizeText(row?.innerText || row?.textContent);
    const linkHref = normalizeText(image.closest('a[href]')?.getAttribute('href'));
    const avatarTestId = normalizeText(
      image.closest("[data-testid^='UserAvatar-Container-']")?.getAttribute('data-testid'),
    );

    return Boolean(
      (targetUsername && (
        text.includes('@' + targetUsername) ||
        linkHref.includes('/' + targetUsername) ||
        avatarTestId.includes(targetUsername)
      )) ||
        (targetAuthorName && text.includes(targetAuthorName)),
    );
  };

  const resolveAvatar = () => {
    for (const image of document.querySelectorAll(imageSelectors)) {
      const row = findRow(image);
      const avatarUrl = image.currentSrc || image.src || '';

      if (avatarUrl && rowMatchesTarget(row, image)) {
        return avatarUrl;
      }
    }

    return '';
  };

  const normalizeBroadcasterName = (value) => {
    const text = String(value || '')
      .replace(/\\s+/g, ' ')
      .replace(/\\s*[|/]\\s*X\\s*$/i, '')
      .replace(/\\s+on\\s+X\\s*:.*$/i, '')
      .replace(/\\s+is\\s+live.*$/i, '')
      .replace(/^Live\\s+Broadcast\\s+by\\s+/i, '')
      .replace(/\\s*[@(][A-Za-z0-9_]{1,15}[)]?\\s*$/i, '')
      .trim();

    if (!text || /^(x|twitter|broadcast|live)$/i.test(text) || text.length > 48) {
      return '';
    }

    return text;
  };

  const normalizeHandle = (value) => {
    const match = String(value || '').match(/@([A-Za-z0-9_]{1,15})\\b/);

    return match ? '@' + match[1] : '';
  };

  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return Boolean(
      rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none',
    );
  };

  const isInsideChatPanel = (element) => {
    if (element.closest('[data-testid="chatContainer"]')) {
      return true;
    }

    const rect = element.getBoundingClientRect();

    return rect.left > window.innerWidth * 0.72;
  };

  const resolveBroadcasterHandle = () => {
    const candidates = [];

    for (const element of document.querySelectorAll('a[href^="/"], [data-testid="UserName"], span, div')) {
      if (!isVisible(element) || isInsideChatPanel(element)) {
        continue;
      }

      const href = element.getAttribute?.('href') || element.closest('a[href^="/"]')?.getAttribute('href') || '';
      const hrefHandle = href.match(/^\\/([A-Za-z0-9_]{1,15})(?:\\b|[/?#])/);
      const textHandle = normalizeHandle(element.innerText || element.textContent);
      const handle = hrefHandle ? '@' + hrefHandle[1] : textHandle;
      const inArticle = Boolean(element.closest('article, [role="article"]'));
      const inListItem = Boolean(element.closest('[role="listitem"]'));

      if (!handle) {
        continue;
      }

      const candidate = {
        handle,
        href,
        inArticle,
        inChatPanel: false,
        inListItem,
        isVisible: true,
        rect: {
          height: Math.round(element.getBoundingClientRect().height),
          left: Math.round(element.getBoundingClientRect().left),
          top: Math.round(element.getBoundingClientRect().top),
          width: Math.round(element.getBoundingClientRect().width),
        },
        tag: element.tagName.toLowerCase(),
        testId: element.getAttribute?.('data-testid') || '',
        text: normalizeText(element.innerText || element.textContent).slice(0, 160),
        userCell: Boolean(element.closest('[data-testid="UserCell"]')),
        userName: Boolean(element.closest('[data-testid="UserName"]')),
        viewport,
      };

      candidates.push({
        ...candidate,
        score: scoreXHandleCandidate(candidate),
      });
    }

    return rankXHandleCandidates(candidates);
  };

  const resolveBroadcasterName = () => {
    const metaCandidates = [
      document.querySelector('meta[property="og:title"]')?.content,
      document.querySelector('meta[name="twitter:title"]')?.content,
      document.title,
    ];

    for (const candidate of metaCandidates) {
      const normalized = normalizeBroadcasterName(candidate);

      if (normalized) {
        return normalized;
      }
    }

    for (const userName of document.querySelectorAll('[data-testid="UserName"]')) {
      if (
        userName.closest('[data-testid="chatContainer"]') ||
        userName.closest('article, [role="article"], [role="listitem"]')
      ) {
        continue;
      }

      const normalized = normalizeBroadcasterName(userName.innerText || userName.textContent);

      if (normalized) {
        return normalized;
      }
    }

    return '';
  };

  const initialChannelLabel = resolveBroadcasterHandle();
  const initialBroadcasterName = resolveBroadcasterName();

  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const avatarUrl = resolveAvatar();
    const channelLabel = initialChannelLabel || resolveBroadcasterHandle();
    const broadcasterName = initialBroadcasterName || resolveBroadcasterName();
    const hasSourceContext = Boolean(channelLabel || broadcasterName);
    const isLastAttempt = attempt === maxAttempts - 1;

    if (avatarUrl || (!shouldWaitForAvatar && hasSourceContext) || (isLastAttempt && hasSourceContext)) {
      return { avatarUrl, broadcasterName, channelLabel };
    }

    await delay(150);
  }

  return {};
})();
`;

const createXDebugCaptureContextScript = () => `
(() => {
  const isPreferredXHandleCandidate = ${isPreferredXHandleCandidate.toString()};
  const scoreXHandleCandidate = ${scoreXHandleCandidate.toString()};
  const rankXHandleCandidates = ${rankXHandleCandidates.toString()};
  const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const normalizeHandle = (value) => {
    const match = String(value || '').match(/@([A-Za-z0-9_]{1,15})\\b/);

    return match ? '@' + match[1] : '';
  };
  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return Boolean(
      rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none',
    );
  };
  const isInsideChatPanel = (element) => {
    if (element.closest('[data-testid="chatContainer"]')) {
      return true;
    }

    const rect = element.getBoundingClientRect();

    return rect.left > window.innerWidth * 0.72;
  };
  const toRect = (element) => {
    const rect = element.getBoundingClientRect();

    return {
      bottom: Math.round(rect.bottom),
      height: Math.round(rect.height),
      left: Math.round(rect.left),
      top: Math.round(rect.top),
    width: Math.round(rect.width),
    };
  };
  const candidates = [];
  const viewport = {
    height: window.innerHeight,
    width: window.innerWidth,
  };

  for (const element of document.querySelectorAll('a[href^="/"], [data-testid="UserName"], span, div')) {
    const href = element.getAttribute?.('href') || element.closest('a[href^="/"]')?.getAttribute('href') || '';
    const hrefHandle = href.match(/^\\/([A-Za-z0-9_]{1,15})(?:\\b|[/?#])/);
    const text = normalizeText(element.innerText || element.textContent);
    const textHandle = normalizeHandle(text);
    const handle = hrefHandle ? '@' + hrefHandle[1] : textHandle;
    const inArticle = Boolean(element.closest('article, [role="article"]'));
    const inListItem = Boolean(element.closest('[role="listitem"]'));

    if (!handle) {
      continue;
    }

    const candidate = {
      handle,
      href,
      inArticle,
      inChatPanel: isInsideChatPanel(element),
      inListItem,
      isVisible: isVisible(element),
      rect: toRect(element),
      tag: element.tagName.toLowerCase(),
      testId: element.getAttribute?.('data-testid') || '',
      text: text.slice(0, 160),
      userCell: Boolean(element.closest('[data-testid="UserCell"]')),
      userName: Boolean(element.closest('[data-testid="UserName"]')),
      viewport,
    };

    candidates.push({
      ...candidate,
      score: scoreXHandleCandidate(candidate),
    });
  }

  return {
    candidates: candidates
      .slice()
      .sort((left, right) => right.score - left.score)
      .slice(0, 80),
    location: window.location.href,
    selectedHandle: rankXHandleCandidates(candidates),
    title: document.title,
    viewport: {
      height: window.innerHeight,
      width: window.innerWidth,
    },
  };
})();
`;

const createXSendMessageScript = (text) => `
(() => {
  const message = ${JSON.stringify(text)};
  const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const composer =
    document.querySelector("textarea[aria-label='Send a message']") ||
    document.querySelector("textarea[placeholder='Send a message']") ||
    document.querySelector("textarea[inputmode='text']") ||
    document.querySelector("[role='textbox'][contenteditable='true']");

  if (!composer) {
    return {
      ok: false,
      code: '${X_COMPOSER_UNAVAILABLE_CODE}',
      error: '${X_COMPOSER_UNAVAILABLE_MESSAGE}',
    };
  }

  composer.focus();

  if (composer.isContentEditable) {
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, message);
  } else {
    const valuePrototype =
      composer instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(valuePrototype, 'value');

    descriptor?.set?.call(composer, message);
  }

  composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
  composer.dispatchEvent(new Event('change', { bubbles: true }));

  const buttons = [...document.querySelectorAll("button, [role='button']")];
  const sendButton = buttons.find((button) => {
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    const label = normalizeText(
      [
        button.getAttribute('aria-label'),
        button.getAttribute('data-testid'),
        button.textContent,
      ].filter(Boolean).join(' '),
    );

    return /(^| )(send|post|reply|tweet)( |$)/i.test(label);
  });

  if (!sendButton) {
    return { ok: false, error: 'X send button was not found or is disabled.' };
  }

  sendButton.click();
  return { ok: true };
})();
`;

module.exports = {
  createXCaptureUrl,
  createXConnector,
  createXDebugCaptureContextScript,
  createXLiveChatUrlFromHandle,
  createXResolveMessageContextScript,
  createXSendMessageScript,
  attachXNetworkCapture,
  isXComposerUnavailableError,
  normalizeXLiveUrl,
  normalizeXSendText,
  rankXHandleCandidates,
  scoreXHandleCandidate,
  X_CAPTURE_WINDOW_HEIGHT,
  X_CAPTURE_WINDOW_WIDTH,
  X_CAPTURE_OFFSCREEN_POSITION,
  X_CAPTURE_PARTITION,
  X_COMPOSER_UNAVAILABLE_CODE,
  X_COMPOSER_UNAVAILABLE_MESSAGE,
};
