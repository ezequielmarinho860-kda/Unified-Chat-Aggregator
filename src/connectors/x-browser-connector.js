const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { chromium } = require('playwright-core');
const {
  createXCaptureUrl,
  createXSendMessageScript,
  normalizeXLiveUrl,
  normalizeXSendText,
} = require('./x-connector');
const { normalizeXMessage } = require('./x-message-parser');

const X_BROWSER_PROFILE_DIR_NAME = 'x-browser-profile';
const DEFAULT_X_BROWSER_HEADLESS = false;

const createXBrowserConnector = ({
  browserExecutablePath,
  browserFactory = chromium,
  headless = DEFAULT_X_BROWSER_HEADLESS,
  liveUrl,
  launchPersistentContext = browserFactory.launchPersistentContext.bind(browserFactory),
  onBrowserEvent = () => {},
  resolveBrowserExecutablePath: resolveBrowserExecutablePathImpl = resolveBrowserExecutablePath,
  userDataDir,
} = {}) => {
  const events = new EventEmitter();
  const normalizedLiveUrl = normalizeXLiveUrl(liveUrl);
  const captureUrl = createXCaptureUrl(normalizedLiveUrl);
  const resolvedUserDataDir = resolveXBrowserUserDataDir(userDataDir);
  const resolvedExecutablePath = resolveBrowserExecutablePathImpl(browserExecutablePath);
  let context;
  let page;

  const connect = async () => {
    if (context) {
      return;
    }

    if (!resolvedExecutablePath) {
      throw new Error(
        'X browser capture requires Chrome or Edge. Set BROWSER_BACKEND_X_BROWSER_PATH to the browser executable.',
      );
    }

    events.emit('status', { state: 'connecting', capture: 'launching-browser' });
    context = await launchPersistentContext(resolvedUserDataDir, {
      executablePath: resolvedExecutablePath,
      headless,
      viewport: { height: 760, width: 900 },
    });
    page = context.pages()[0] ?? (await context.newPage());

    await page.exposeFunction('xCaptureMessage', handleBrowserMessage);
    await page.exposeFunction('xCaptureStatus', handleBrowserStatus);
    await page.addInitScript({ content: buildXBrowserCaptureScript() });
    page.on('crash', handlePageError);
    page.on('pageerror', handlePageError);
    page.on('close', handlePageClose);

    try {
      await page.goto(captureUrl, { waitUntil: 'domcontentloaded' });
      events.emit('status', { state: 'connected', capture: 'page-loaded' });
    } catch (error) {
      handlePageError(error);
    }
  };

  const disconnect = async () => {
    const activeContext = context;

    context = undefined;
    page = undefined;
    await activeContext?.close();
  };

  const send = async (text) => {
    const normalizedText = normalizeXSendText(text);

    if (!page) {
      throw new Error('X browser capture is not connected.');
    }

    const result = await page.evaluate(createXSendMessageScript(normalizedText));

    if (!result?.ok) {
      throw createXSendError(result);
    }

    return result;
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
    send,
  };

  function handleBrowserMessage(payload) {
    try {
      const message = normalizeXMessage(payload);

      events.emit('message', message);
      onBrowserEvent?.({ data: message, type: 'chat.message' });
      return message;
    } catch (error) {
      handlePageError(error);
      return undefined;
    }
  }

  function handleBrowserStatus(status = {}) {
    events.emit('status', status);
  }

  function handlePageError(error) {
    events.emit('connector-error', error);
    onBrowserEvent?.({ data: { error: error.message }, type: 'connector.error' });
  }

  function handlePageClose() {
    page = undefined;
    context = undefined;
    events.emit('status', { state: 'disconnected', capture: 'page-closed' });
  }
};

const buildXBrowserCaptureScript = () => `(${createXBrowserCaptureBootstrap.toString()})();`;

function createXBrowserCaptureBootstrap() {
  const MESSAGE_KEY_TTL = 5 * 60 * 1000;
  const MAX_MESSAGE_KEYS = 500;
  const MESSAGE_RETRY_LIMIT = 4;
  const OBSERVE_INTERVAL_MS = 2_000;
  const VIEWER_OBSERVE_INTERVAL_MS = 10_000;
  const INITIAL_BACKLOG_SUPPRESSION_MS = 8_000;
  const BACKLOG_REFRESH_SUPPRESSION_MS = 6_000;
  const BACKLOG_REFRESH_ROW_THRESHOLD = 6;
  const seenMessageKeys = new Map();
  const pendingMessageRows = new WeakSet();
  const messageRetryCounts = new WeakMap();
  let observer;
  let observedContainer;
  let initialBacklogSuppressUntil = 0;
  let lastStatusKey = '';
  let currentStatus = { state: 'connected' };
  let lastViewerCount;
  let lastViewerCountCheckedAt = 0;

  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const sendBridge = (channel, payload) => {
    const bridge = window[channel];

    if (typeof bridge === 'function') {
      void bridge(payload);
    }
  };
  const sendStatus = (status = {}) => {
    currentStatus = { ...currentStatus, ...status };
    const payload = { ...currentStatus, viewerCount: getXViewerCount() };
    const key = JSON.stringify(payload);

    if (key === lastStatusKey) {
      return;
    }

    lastStatusKey = key;
    sendBridge('xCaptureStatus', payload);
  };
  const getXViewerCount = () => {
    if (Date.now() - lastViewerCountCheckedAt < VIEWER_OBSERVE_INTERVAL_MS) {
      return lastViewerCount;
    }

    lastViewerCountCheckedAt = Date.now();
    const labeledCandidates = document.querySelectorAll(
      "[aria-label*='viewer' i], [aria-label*='watching' i], [data-testid*='viewer' i]",
    );

    for (const candidate of labeledCandidates) {
      const count = parseViewerCountText(
        [candidate.getAttribute('aria-label'), candidate.textContent].filter(Boolean).join(' '),
      );

      if (count !== undefined) {
        lastViewerCount = count;
        return lastViewerCount;
      }
    }

    lastViewerCount = parseViewerCountText(document.body?.innerText);
    return lastViewerCount;
  };
  const pruneSeenMessageKeys = () => {
    const cutoff = Date.now() - MESSAGE_KEY_TTL;

    for (const [key, timestamp] of seenMessageKeys) {
      if (timestamp < cutoff) {
        seenMessageKeys.delete(key);
      }
    }

    while (seenMessageKeys.size > MAX_MESSAGE_KEYS) {
      seenMessageKeys.delete(seenMessageKeys.keys().next().value);
    }
  };
  const rememberMessageKey = (key) => {
    if (!key) {
      return false;
    }

    pruneSeenMessageKeys();

    if (seenMessageKeys.has(key)) {
      seenMessageKeys.set(key, Date.now());
      return false;
    }

    seenMessageKeys.set(key, Date.now());
    return true;
  };
  const parseViewerCountText = (value) => {
    const text = String(value || '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    const match = text.match(
      /(\d[\d.,]*)\s*(k|m|b|mil|mi|milh(?:ao|oes))?\s+(?:viewers?|watching|assistindo|espectadores?)/i,
    );

    if (!match) {
      return undefined;
    }

    const suffixes = { mil: 'k', mi: 'm', milhao: 'm', milhoes: 'm' };

    return parseAbbreviatedCount(`${match[1]}${suffixes[match[2]?.toLowerCase()] ?? match[2] ?? ''}`);
  };
  const parseAbbreviatedCount = (value) => {
    const normalized = String(value || '').replace(/\s+/g, '').toLowerCase();
    const match = normalized.match(/^([\d.,]+)([kmb]?)$/);

    if (!match) {
      return undefined;
    }

    const suffixMultiplier = { '': 1, k: 1_000, m: 1_000_000, b: 1_000_000_000 };
    const numericPart = normalizeNumericPart(match[1], Boolean(match[2]));
    const count = Number(numericPart) * suffixMultiplier[match[2]];

    return normalizeViewerCount(Math.round(count));
  };
  const normalizeNumericPart = (value, hasSuffix) => {
    if (hasSuffix) {
      return value.replace(',', '.');
    }

    return value.replace(/[.,]/g, '');
  };
  const normalizeViewerCount = (value) => {
    const count = Number(value);

    if (!Number.isSafeInteger(count) || count < 0) {
      return undefined;
    }

    return count;
  };
  const isElement = (node) => Boolean(node && node.nodeType === Node.ELEMENT_NODE);
  const getAvatarContainer = (element) => {
    if (!isElement(element)) {
      return undefined;
    }

    if (element.matches("[data-testid^='UserAvatar-Container-']")) {
      return element;
    }

    return element.querySelector("[data-testid^='UserAvatar-Container-']") || undefined;
  };
  const getAvatarContainers = (root) =>
    root?.querySelectorAll ? [...root.querySelectorAll("[data-testid^='UserAvatar-Container-']")] : [];
  const getChatComposer = (root = document) => {
    if (!root?.querySelector) {
      return undefined;
    }

    return (
      root.querySelector("textarea[aria-label='Send a message']") ||
      root.querySelector("textarea[placeholder='Send a message']") ||
      root.querySelector("textarea[inputmode='text']")
    );
  };
  const getLegacyDisplayNameElement = (row) => row?.querySelector?.("span[style*='color']");
  const getDisplayNameElement = (row) => {
    if (!row?.querySelectorAll) {
      return getLegacyDisplayNameElement(row);
    }

    const candidates = row.querySelectorAll("a[href^='/'] span");

    for (const candidate of candidates) {
      const text = normalizeText(candidate.textContent);

      if (!text || text.startsWith('@')) {
        continue;
      }

      if (candidate.closest("[data-testid^='UserAvatar-Container-']")) {
        continue;
      }

      return candidate;
    }

    return getLegacyDisplayNameElement(row);
  };
  const getNodeText = (node) => {
    if (!node) {
      return '';
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return normalizeText(node.textContent);
    }

    const imageAlt = isElement(node) ? node.getAttribute('alt') : '';
    const childrenText = [...(node.childNodes || [])].map(getNodeText).filter(Boolean);

    return normalizeText([...childrenText, imageAlt].filter(Boolean).join(' '));
  };
  const getLegacyMessageContentNode = (row) => {
    if (!row) {
      return undefined;
    }

    if (row.childNodes?.length > 1 && row.childNodes[1]) {
      return row.childNodes[1];
    }

    return row.querySelector?.('button') || row.querySelector?.('span');
  };
  const getMessageContentNode = (row) => {
    if (!row?.querySelectorAll) {
      return getLegacyMessageContentNode(row);
    }

    const spans = row.querySelectorAll('span');
    let bestCandidate;
    let bestScore = 0;

    for (const span of spans) {
      if (span.closest("a[href^='/']")) {
        continue;
      }

      if (span.closest("[data-testid^='UserAvatar-Container-']")) {
        continue;
      }

      if (span.closest('button')) {
        continue;
      }

      if (span.querySelector("[data-testid='icon-verified']")) {
        continue;
      }

      const hasImage = Boolean(span.querySelector('img[src]'));
      const text = getNodeText(span);
      const score = text.length + (hasImage ? 25 : 0);

      if ((!text && !hasImage) || score < bestScore) {
        continue;
      }

      bestCandidate = span;
      bestScore = score;
    }

    return bestCandidate || getLegacyMessageContentNode(row);
  };
  const isLikelyMessageRow = (row) =>
    Boolean(
      row?.querySelectorAll &&
        getAvatarContainers(row).length === 1 &&
        getDisplayNameElement(row) &&
        getMessageContentNode(row),
    );
  const isLikelyLegacyMessageRow = (row) =>
    Boolean(getLegacyDisplayNameElement(row) && getNodeText(getLegacyMessageContentNode(row)));
  const findLegacyMessageRow = (element) => {
    let current = element;

    while (isElement(current) && current !== document.body) {
      if (isLikelyLegacyMessageRow(current)) {
        return current;
      }

      if (getChatComposer(current.parentElement)) {
        break;
      }

      current = current.parentElement;
    }

    return undefined;
  };
  const findMessageRow = (element) => {
    const avatar = getAvatarContainer(element);

    if (!avatar) {
      return findLegacyMessageRow(element);
    }

    let current = avatar;
    let lastCandidate;

    while (isElement(current) && current !== document.body) {
      if (isLikelyMessageRow(current)) {
        lastCandidate = current;
      }

      const parent = current.parentElement;

      if (!parent) {
        break;
      }

      if (getAvatarContainers(parent).length > 1) {
        break;
      }

      if (parent.matches('[data-testid="chatContainer"]') || getChatComposer(parent)) {
        break;
      }

      current = parent;
    }

    return lastCandidate;
  };
  const getAuthorName = (row) => {
    const nameElement = getDisplayNameElement(row);
    return normalizeText(nameElement?.textContent).split(':')[0] || '';
  };
  const getUsername = (row) => {
    const candidates = row.querySelectorAll("a[href^='/'] span");

    for (const candidate of candidates) {
      const text = normalizeText(candidate.textContent);

      if (text.startsWith('@')) {
        return text.replace(/^@+/, '');
      }
    }

    const avatar = getAvatarContainer(row);
    const testId = avatar?.getAttribute('data-testid') || '';

    if (testId.startsWith('UserAvatar-Container-')) {
      return testId.replace('UserAvatar-Container-', '');
    }

    return '';
  };
  const isTimeLabel = (value) => /^\d{1,2}:\d{2}\s?(am|pm)?$/i.test(normalizeText(value));
  const getMessageText = (row) => {
    const contentText = getNodeText(getMessageContentNode(row));

    if (!isTimeLabel(contentText)) {
      return contentText;
    }

    return '';
  };
  const getAvatarUrl = (row) => {
    const image = row.querySelector(
      "[data-testid^='UserAvatar-Container-'] img[src], a[href] img[alt][src]",
    );

    return image?.src || '';
  };
  const queueCandidateRetry = (row) => {
    const attempts = (messageRetryCounts.get(row) || 0) + 1;

    if (attempts > MESSAGE_RETRY_LIMIT) {
      row.dataset.unifiedChatCaptureSkipped = 'true';
      return;
    }

    messageRetryCounts.set(row, attempts);
    scheduleCandidateProcessing(row, 250 * attempts);
  };
  const shouldSuppressBacklog = () => Date.now() < initialBacklogSuppressUntil;
  const processCandidate = (element) => {
    const row = findMessageRow(element);

    if (!row || row.dataset.unifiedChatCaptureSkipped === 'true') {
      return;
    }

    const suppressBacklog = shouldSuppressBacklog();
    const authorName = getAuthorName(row);
    const username = getUsername(row);
    const text = getMessageText(row);

    if (!authorName || !text || authorName.startsWith('This broadcast has ended')) {
      queueCandidateRetry(row);
      return;
    }

    const avatarKey = getAvatarContainer(row)?.getAttribute('data-testid') || '';
    const key = [avatarKey, username, authorName, text].join('|').toLowerCase();

    if (row.dataset.unifiedChatCapturedKey === key) {
      return;
    }

    if (!rememberMessageKey(key)) {
      row.dataset.unifiedChatCapturedKey = key;
      return;
    }

    row.dataset.unifiedChatCapturedKey = key;
    messageRetryCounts.delete(row);

    if (suppressBacklog) {
      return;
    }

    sendBridge('xCaptureMessage', {
      authorName,
      username,
      text,
      avatarUrl: getAvatarUrl(row),
      timestamp: new Date().toISOString(),
    });
  };
  const processKnownMessages = (container) => {
    for (const avatar of getAvatarContainers(container)) {
      processCandidate(avatar);
    }

    for (const displayName of container.querySelectorAll("span[style*='color']")) {
      processCandidate(displayName);
    }
  };
  const collectMessageRows = (node, rows) => {
    if (!isElement(node)) {
      return;
    }

    const ownRow = findMessageRow(node);

    if (ownRow) {
      rows.add(ownRow);
    }

    for (const avatar of getAvatarContainers(node)) {
      const row = findMessageRow(avatar);

      if (row) {
        rows.add(row);
      }
    }

    for (const displayName of node.querySelectorAll?.("span[style*='color']") || []) {
      const row = findMessageRow(displayName);

      if (row) {
        rows.add(row);
      }
    }
  };
  const shouldTreatMutationsAsBacklogRefresh = (mutations) => {
    const rows = new Set();

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        collectMessageRows(node, rows);

        if (rows.size >= BACKLOG_REFRESH_ROW_THRESHOLD) {
          return true;
        }
      }
    }

    return false;
  };
  function scheduleCandidateProcessing(element, delay = 350) {
    if (!isElement(element)) {
      return;
    }

    const row = findMessageRow(element);

    if (row) {
      if (pendingMessageRows.has(row)) {
        return;
      }

      pendingMessageRows.add(row);
    }

    setTimeout(() => {
      if (row) {
        pendingMessageRows.delete(row);
      }

      processCandidate(element);

      for (const avatar of getAvatarContainers(element)) {
        processCandidate(avatar);
      }
    }, delay);
  }
  const findComposerBackedContainer = () => {
    const composer = getChatComposer();

    if (!composer) {
      return undefined;
    }

    const semanticContainer = composer.closest('[data-testid="chatContainer"]');

    if (semanticContainer) {
      return semanticContainer;
    }

    let current = composer.parentElement;
    let bestCandidate;

    while (current && current !== document.body) {
      if (getAvatarContainers(current).length > 0 || current.querySelector("span[style*='color']")) {
        bestCandidate = current;
      }

      current = current.parentElement;
    }

    return bestCandidate;
  };
  const resolveChatContainer = () => {
    const semanticContainer = document.querySelector('[data-testid="chatContainer"]');

    if (semanticContainer) {
      return semanticContainer;
    }

    const composerContainer = findComposerBackedContainer();

    if (composerContainer) {
      return composerContainer;
    }

    const avatar = document.querySelector("[data-testid^='UserAvatar-Container-']");
    const row = avatar ? findMessageRow(avatar) : undefined;

    if (row) {
      return row.closest('[data-testid="chatContainer"]') || row.parentElement;
    }

    return document.querySelector("[tabIndex='0'] textarea[inputmode='text']")?.closest("[tabIndex='0']");
  };
  const observeContainer = (container) => {
    if (!container) {
      sendStatus({ state: 'connected', capture: 'searching' });
      return;
    }

    if (container === observedContainer) {
      return;
    }

    observer?.disconnect();
    observedContainer = container;
    suppressBacklogUntil(Date.now() + INITIAL_BACKLOG_SUPPRESSION_MS);
    processKnownMessages(container);
    observer = new MutationObserver((mutations) => {
      if (shouldTreatMutationsAsBacklogRefresh(mutations)) {
        suppressBacklogUntil(Date.now() + BACKLOG_REFRESH_SUPPRESSION_MS);
        sendStatus({ state: 'observing', capture: 'syncing-chat-refresh' });
        setTimeout(() => {
          if (Date.now() >= initialBacklogSuppressUntil) {
            sendStatus({ state: 'observing', capture: 'observing' });
          }
        }, BACKLOG_REFRESH_SUPPRESSION_MS);
      }

      for (const mutation of mutations) {
        if (isElement(mutation.target)) {
          scheduleCandidateProcessing(mutation.target);
        }

        if (mutation.target?.nodeType === Node.TEXT_NODE) {
          scheduleCandidateProcessing(mutation.target.parentElement);
        }

        for (const node of mutation.addedNodes) {
          scheduleCandidateProcessing(node);
        }
      }
    });
    observer.observe(container, { childList: true, characterData: true, subtree: true });
    sendStatus({ state: 'observing', capture: 'syncing-initial-chat' });
    setTimeout(() => {
      if (container === observedContainer) {
        sendStatus({ state: 'observing', capture: 'observing' });
      }
    }, INITIAL_BACKLOG_SUPPRESSION_MS);
  };
  const keepPageVisible = () => {
    try {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    } catch {
      // Best-effort only; X capture can still work if this fails.
    }
  };
  const startCaptureLoop = () => {
    keepPageVisible();

    setInterval(() => {
      keepPageVisible();
      observeContainer(resolveChatContainer());
      sendStatus();
    }, OBSERVE_INTERVAL_MS);
  };

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    startCaptureLoop();
  }
}

const createXSendError = (result = {}) => {
  const error = new Error(result.error || 'X send failed.');

  if (result.code) {
    error.code = result.code;
  }

  return error;
};

const resolveXBrowserUserDataDir = (userDataDir) => {
  if (typeof userDataDir === 'string' && userDataDir.trim().length > 0) {
    return userDataDir.trim();
  }

  return path.join(os.tmpdir(), X_BROWSER_PROFILE_DIR_NAME);
};

const resolveBrowserExecutablePath = (browserExecutablePath) => {
  const explicitPath = resolveExistingPath(browserExecutablePath);

  if (explicitPath) {
    return explicitPath;
  }

  const candidates = [
    process.env.BROWSER_BACKEND_X_BROWSER_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\EdgeCore\\msedge.exe',
  ];

  for (const candidate of candidates) {
    const resolved = resolveExistingPath(candidate);

    if (resolved) {
      return resolved;
    }
  }

  return undefined;
};

const resolveExistingPath = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const candidate = value.trim();

  return fs.existsSync(candidate) ? candidate : undefined;
};

module.exports = {
  createXBrowserConnector,
  resolveBrowserExecutablePath,
};
