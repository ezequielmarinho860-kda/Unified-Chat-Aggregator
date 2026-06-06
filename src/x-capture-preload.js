const { ipcRenderer } = require('electron');

const MESSAGE_KEY_TTL = 5 * 60 * 1000;
const MAX_MESSAGE_KEYS = 500;
const MESSAGE_RETRY_LIMIT = 4;
const OBSERVE_INTERVAL_MS = 2_000;
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

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const sendIpc = (channel, payload) => {
  ipcRenderer?.send?.(channel, payload);
};

const sendStatus = (status) => {
  const payload = { state: 'connected', ...status };
  const key = JSON.stringify(payload);

  if (key === lastStatusKey) {
    return;
  }

  lastStatusKey = key;
  sendIpc('x-capture:status', payload);
};

const suppressBacklogUntil = (timestamp) => {
  initialBacklogSuppressUntil = Math.max(initialBacklogSuppressUntil, timestamp);
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

  sendIpc('x-capture:message', {
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
  }, OBSERVE_INTERVAL_MS);
};

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  startCaptureLoop();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    __testing: {
      findMessageRow,
      getAuthorName,
      getMessageText,
      getUsername,
      processCandidate,
      resolveChatContainer,
    },
  };
}
