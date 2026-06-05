const { ipcRenderer } = require('electron');

const MESSAGE_KEY_TTL = 5 * 60 * 1000;
const MAX_MESSAGE_KEYS = 500;
const seenMessageKeys = new Map();
let observer;
let observedContainer;

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

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

const getAvatarContainer = (element) => {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return undefined;
  }

  if (element.matches("[data-testid^='UserAvatar-Container-']")) {
    return element;
  }

  const descendantAvatar = element.querySelector("[data-testid^='UserAvatar-Container-']");

  if (descendantAvatar) {
    return descendantAvatar;
  }

  let current = element.parentElement;

  while (current && current !== document.body) {
    if (current.matches('[data-testid="chatContainer"]')) {
      break;
    }

    const nearbyAvatar = current.querySelector("[data-testid^='UserAvatar-Container-']");

    if (nearbyAvatar) {
      return nearbyAvatar;
    }

    current = current.parentElement;
  }

  return undefined;
};

const findMessageRow = (element) => {
  const avatar = getAvatarContainer(element);

  if (!avatar) {
    return undefined;
  }

  let current = avatar;
  let lastCandidate;

  while (current && current !== document.body) {
    if (current.querySelectorAll("[data-testid^='UserAvatar-Container-']").length === 1) {
      lastCandidate = current;
    }

    const parent = current.parentElement;

    if (!parent || parent.matches('[data-testid="chatContainer"]')) {
      break;
    }

    current = parent;
  }

  return lastCandidate;
};

const getAuthorName = (row) => {
  const candidates = row.querySelectorAll("a[href^='/'] span");

  for (const candidate of candidates) {
    const text = normalizeText(candidate.textContent);

    if (text && !text.startsWith('@')) {
      return text;
    }
  }

  return '';
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

const getMessageText = (row, authorName, username) => {
  const ignoredText = new Set(
    [authorName, username, username ? `@${username}` : ''].filter(Boolean),
  );
  const spans = [...row.querySelectorAll('span')];
  const candidates = spans
    .map((span) => normalizeText(span.textContent))
    .filter((text) => text && !ignoredText.has(text) && !isTimeLabel(text));

  return candidates.at(-1) || '';
};

const getAvatarUrl = (row) => {
  const image = row.querySelector("[data-testid^='UserAvatar-Container-'] img[src]");
  return image?.src || '';
};

const isTimeLabel = (value) => /^\d{1,2}:\d{2}\s?(am|pm)?$/i.test(value);

const processCandidate = (element) => {
  const row = findMessageRow(element);

  if (!row) {
    return;
  }

  const authorName = getAuthorName(row);
  const username = getUsername(row);
  const text = getMessageText(row, authorName, username);

  if (!authorName || !text || authorName.startsWith('This broadcast has ended')) {
    return;
  }

  const key = [username, authorName, text].join('|').toLowerCase();

  if (row.dataset.unifiedChatCapturedKey === key) {
    return;
  }

  if (!rememberMessageKey(key)) {
    row.dataset.unifiedChatCapturedKey = key;
    return;
  }

  row.dataset.unifiedChatCapturedKey = key;
  ipcRenderer.send('x-capture:message', {
    authorName,
    username,
    text,
    avatarUrl: getAvatarUrl(row),
    timestamp: new Date().toISOString(),
  });
};

const processKnownMessages = (container) => {
  for (const avatar of container.querySelectorAll("[data-testid^='UserAvatar-Container-']")) {
    processCandidate(avatar);
  }
};

const scheduleCandidateProcessing = (element) => {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  setTimeout(() => {
    processCandidate(element);

    for (const avatar of element.querySelectorAll("[data-testid^='UserAvatar-Container-']")) {
      processCandidate(avatar);
    }
  }, 350);
};

const resolveChatContainer = () => {
  const semanticContainer = document.querySelector('[data-testid="chatContainer"]');

  if (semanticContainer) {
    return semanticContainer;
  }

  const avatar = document.querySelector("[data-testid^='UserAvatar-Container-']");
  const row = avatar ? findMessageRow(avatar) : undefined;
  return row?.parentElement;
};

const observeContainer = (container) => {
  if (!container || container === observedContainer) {
    return;
  }

  observer?.disconnect();
  observedContainer = container;
  processKnownMessages(container);
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.target?.nodeType === Node.ELEMENT_NODE) {
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
  ipcRenderer.send('x-capture:status', { state: 'observing' });
};

const keepPageVisible = () => {
  try {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
  } catch {
    // Best-effort only; X capture can still work if this fails.
  }
};

keepPageVisible();

setInterval(() => {
  keepPageVisible();
  observeContainer(resolveChatContainer());
}, 2_000);
