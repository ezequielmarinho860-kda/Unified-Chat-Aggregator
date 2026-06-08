const title = window.chatAggregator?.appName ?? 'Unified Chat Aggregator';
const messageHighlightUtils = window.messageHighlights;
const emptyState = document.querySelector('#empty-state');
const messageFeed = document.querySelector('#message-feed');
const messageCount = document.querySelector('#message-count');
const visibleMessageCount = document.querySelector('#visible-message-count');
const platformFilter = document.querySelector('#platform-filter');
const resumeChat = document.querySelector('#resume-chat');
const clearFeed = document.querySelector('#clear-feed');
const configForm = document.querySelector('#connector-config-form');
const configMeta = document.querySelector('#config-meta');
const restartConnectors = document.querySelector('#restart-connectors');
const connectTwitch = document.querySelector('#connect-twitch');
const disconnectTwitch = document.querySelector('#disconnect-twitch');
const clearTwitchSession = document.querySelector('#clear-twitch-session');
const twitchAuthStatus = document.querySelector('#twitch-auth-status');
const connectKick = document.querySelector('#connect-kick');
const disconnectKick = document.querySelector('#disconnect-kick');
const clearKickSession = document.querySelector('#clear-kick-session');
const kickAuthStatus = document.querySelector('#kick-auth-status');
const connectX = document.querySelector('#connect-x');
const disconnectX = document.querySelector('#disconnect-x');
const xAuthStatus = document.querySelector('#x-auth-status');
const messageComposer = document.querySelector('#message-composer');
const composerMeta = document.querySelector('#composer-meta');
const totalViewerCount = document.querySelector('#total-viewer-count');
const statusCards = new Map(
  [...document.querySelectorAll('[data-platform]')].map((card) => [
    card.dataset.platform,
    card,
  ]),
);
const viewerCards = new Map(
  [...document.querySelectorAll('[data-viewer-count]')].map((element) => [
    element.closest('[data-platform]')?.dataset.platform,
    element.closest('[data-platform]'),
  ]),
);
const messages = [];
const platformCounts = new Map();
const viewerUpdateTimes = new Map();
const loggedIdentities = new Map();
const pendingOutgoingMessages = new Map();
const maxRenderedMessages = 250;
const outgoingMessageMatchWindowMs = 30_000;
const filterPlatforms = ['twitch', 'kick', 'x'];
const activeFilterPlatforms = new Set(filterPlatforms);
let feedPinnedToBottom = true;
let unseenMessageCount = 0;
let totalMessages = 0;
let xAuthState = { connected: false };
let xAuthPollingTimer;
const view = document.body.classList.contains('dashboard-view') ? 'dashboard' : 'setup';

document.title = view === 'setup' ? 'Connector Setup' : title;

const CHAT_SCROLL_DEBUG_LIMIT = 80;
const CHAT_BOTTOM_TOLERANCE_PX = 120;

const getFeedScrollMetrics = () => {
  if (!messageFeed) {
    return {};
  }

  const remaining = messageFeed.scrollHeight - messageFeed.clientHeight - messageFeed.scrollTop;

  return {
    clientHeight: Math.round(messageFeed.clientHeight),
    remaining: Math.round(remaining),
    scrollHeight: Math.round(messageFeed.scrollHeight),
    scrollTop: Math.round(messageFeed.scrollTop),
  };
};

const chatScrollDebug = (() => {
  let enabled = new URLSearchParams(window.location.search).has('debugChat');
  const entries = [];

  try {
    enabled = enabled || window.localStorage.getItem('chatScrollDebug') === '1';
  } catch {
    enabled = Boolean(enabled);
  }

  const api = {
    clear() {
      entries.length = 0;
    },
    disable() {
      enabled = false;
      try {
        window.localStorage.removeItem('chatScrollDebug');
      } catch {
        // localStorage can be unavailable in restricted browser contexts.
      }
    },
    dump() {
      const snapshot = api.getLog();

      console.table(snapshot);
      return snapshot;
    },
    enable() {
      enabled = true;
      try {
        window.localStorage.setItem('chatScrollDebug', '1');
      } catch {
        // localStorage can be unavailable in restricted browser contexts.
      }

      api.log('debug_enabled');
    },
    getLog() {
      return entries.map((entry) => formatChatScrollDebugEntry(entry));
    },
    log(event, details = {}) {
      if (!enabled) {
        return;
      }

      const entry = {
        at: new Date().toISOString(),
        event,
        feedPinnedToBottom,
        metrics: getFeedScrollMetrics(),
        unseenMessageCount,
        view,
        ...details,
      };

      entries.push(entry);

      while (entries.length > CHAT_SCROLL_DEBUG_LIMIT) {
        entries.shift();
      }

      console.debug('[chat-scroll]', entry);
    },
  };

  window.__chatScrollDebug = api;
  window.chatScrollDebug = api;
  return api;
})();

const formatChatScrollDebugEntry = (entry) => ({
  at: entry.at,
  event: entry.event,
  from: entry.from,
  to: entry.to,
  reason: entry.reason,
  remaining: entry.metrics?.remaining,
  scrollTop: entry.metrics?.scrollTop,
  scrollHeight: entry.metrics?.scrollHeight,
  clientHeight: entry.metrics?.clientHeight,
  pinned: entry.feedPinnedToBottom,
  unseen: entry.unseenMessageCount,
  trusted: entry.isTrusted,
  messageId: entry.messageId,
  platform: entry.platform,
  stick: entry.shouldStickToBottom ?? entry.stickToBottom,
});

const setFeedPinnedToBottom = (nextPinnedToBottom, reason, details = {}) => {
  const normalizedPinnedToBottom = Boolean(nextPinnedToBottom);

  if (feedPinnedToBottom !== normalizedPinnedToBottom) {
    chatScrollDebug.log('pinned_change', {
      from: feedPinnedToBottom,
      reason,
      to: normalizedPinnedToBottom,
      ...details,
    });
  }

  feedPinnedToBottom = normalizedPinnedToBottom;
};

const platformLabels = {
  twitch: 'Twitch',
  kick: 'Kick',
  x: 'X',
  youtube: 'YouTube',
};

const platformSymbols = {
  kick: 'K',
  x: 'X',
};

const platformIconUrls = {
  twitch: 'https://upload.wikimedia.org/wikipedia/commons/4/41/Twitch_Glitch_Logo_White.svg',
};

const stateLabels = {
  connected: 'Connected',
  connecting: 'Connecting',
  disabled: 'Disabled',
  disconnected: 'Disconnected',
  error: 'Error',
  idle: 'Idle',
  observing: 'Observing',
};

const viewerStateLabels = {
  available: 'current viewers',
  disabled: 'connector disabled',
  unavailable: 'viewers unavailable',
};

const formatTimestamp = (timestamp) =>
  new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));

const formatRelativeDetail = (timestamp) => {
  if (!timestamp) {
    return 'No messages yet';
  }

  return `Last: ${formatTimestamp(timestamp)}`;
};

const isFeedScrolledToBottom = () => {
  const remainingScroll =
    messageFeed.scrollHeight - messageFeed.clientHeight - messageFeed.scrollTop;

  return remainingScroll <= CHAT_BOTTOM_TOLERANCE_PX;
};

const isAutoscrollEnabled = () => feedPinnedToBottom;

const updateResumeChatControl = () => {
  if (!resumeChat) {
    return;
  }

  resumeChat.hidden = unseenMessageCount === 0 || feedPinnedToBottom;
  resumeChat.textContent = formatUnseenMessageCount(unseenMessageCount);
};

const scrollFeedToBottom = () => {
  setFeedPinnedToBottom(true, 'scroll_to_bottom');
  unseenMessageCount = 0;
  messageFeed.scrollTop = messageFeed.scrollHeight;
  updateResumeChatControl();
};

const maintainFeedBottomAfterMediaLoad = () => {
  if (!feedPinnedToBottom) {
    return;
  }

  window.requestAnimationFrame(() => {
    if (!feedPinnedToBottom) {
      return;
    }

    scrollFeedToBottom();
  });
};

const formatUnseenMessageCount = (count) => {
  if (count > 20) {
    return '20+ novas mensagens';
  }

  return count === 1 ? '1 nova mensagem' : `${count} novas mensagens`;
};

const areAllFilterPlatformsActive = () => activeFilterPlatforms.size === filterPlatforms.length;

const isMessageVisibleInActiveFilter = (message) => activeFilterPlatforms.has(message.platform);

const getFilteredMessages = () =>
  messages.filter(isMessageVisibleInActiveFilter);

const formatActiveFilterLabel = () => {
  if (areAllFilterPlatformsActive()) {
    return 'messages';
  }

  return [...activeFilterPlatforms]
    .map((platform) => platformLabels[platform] ?? platform)
    .join(' + ');
};

const updatePlatformFilterButtons = () => {
  if (!platformFilter) {
    return;
  }

  for (const button of platformFilter.querySelectorAll('[data-filter-platform]')) {
    const platform = button.dataset.filterPlatform;
    const isActive =
      platform === 'all'
        ? areAllFilterPlatformsActive()
        : activeFilterPlatforms.has(platform);

    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
};

const renderMessage = (message) => {
  const item = document.createElement('li');
  const isOwnMessage = classifyOwnMessage(message);

  item.className = 'message';
  item.dataset.platform = message.platform;
  item.classList.toggle('message--own', isOwnMessage);

  const avatar = shouldRenderAuthorAvatar(message) ? renderAuthorAvatar(message) : undefined;

  const badge = renderPlatformBadge(message.platform);
  const source = renderMessageSource(message.source);

  const author = document.createElement('strong');
  author.className = 'message__author';
  author.textContent = message.author.name;

  const badges = renderAuthorBadges(message.author.badges);

  const time = document.createElement('time');
  time.className = 'message__time';
  time.dateTime = message.timestamp;
  time.textContent = formatTimestamp(message.timestamp);

  const text = document.createElement('p');
  text.className = 'message__text';
  text.append(...renderMessageTextFragments(message));

  const metadata = document.createElement('div');
  metadata.className = 'message__metadata';
  metadata.append(...[badge, source, author, ...badges, time].filter(Boolean));

  const content = document.createElement('div');
  content.className = 'message__content';
  content.append(metadata, text);

  item.append(...[avatar, content].filter(Boolean));
  return item;
};

const classifyOwnMessage = (message) => {
  const identity = loggedIdentities.get(message.platform);

  return (
    Boolean(message.isOwnFromOutgoing) ||
    messageHighlightUtils.isMessageFromIdentity(message, identity)
  );
};

const updateLoggedIdentities = (config = {}) => {
  for (const platform of ['twitch', 'kick']) {
    const identity = messageHighlightUtils.createLoggedIdentity(
      config.connectors?.[platform]?.auth,
    );

    if (identity) {
      loggedIdentities.set(platform, identity);
    } else {
      loggedIdentities.delete(platform);
    }
  }
};

const rememberPendingOutgoingMessage = (platform, text) => {
  const pendingId = `${platform}:${Date.now()}:${Math.random()}`;
  const pending = pendingOutgoingMessages.get(platform) ?? [];

  pending.push({ id: pendingId, text, createdAt: Date.now() });
  pendingOutgoingMessages.set(platform, pending);
  return pendingId;
};

const forgetPendingOutgoingMessage = (platform, pendingId) => {
  const pending = pendingOutgoingMessages.get(platform) ?? [];
  const remaining = pending.filter((message) => message.id !== pendingId);

  pendingOutgoingMessages.set(platform, remaining);
};

const matchPendingOutgoingMessage = (message) => {
  const cutoff = Date.now() - outgoingMessageMatchWindowMs;
  const pending = (pendingOutgoingMessages.get(message.platform) ?? []).filter(
    (candidate) => candidate.createdAt >= cutoff,
  );
  const matchIndex = pending.findIndex((candidate) => candidate.text === message.text);

  if (matchIndex === -1) {
    pendingOutgoingMessages.set(message.platform, pending);
    return false;
  }

  pending.splice(matchIndex, 1);
  pendingOutgoingMessages.set(message.platform, pending);
  return true;
};

const identifyOwnIncomingMessage = (message) => {
  if (!matchPendingOutgoingMessage(message)) {
    return;
  }

  message.isOwnFromOutgoing = true;

  if (message.platform === 'x') {
    const identity = messageHighlightUtils.createIdentityFromMessageAuthor(message);

    if (identity) {
      loggedIdentities.set('x', identity);
    }
  }
};

const shouldRenderAuthorAvatar = (message) => !['kick', 'twitch'].includes(message.platform);

const renderMessageSource = (source) => {
  const label = source?.broadcasterName || source?.channelLabel;

  if (!label) {
    return undefined;
  }

  const element = document.createElement('span');

  element.className = 'message__source';
  element.textContent = label;
  element.title = `Stream source: ${label}`;
  return element;
};

const renderPlatformBadge = (platform) => {
  const badge = document.createElement('span');
  const label = document.createElement('span');

  badge.className = `message__badge message__badge--${platform}`;
  label.textContent = platformLabels[platform] ?? platform;

  if (platformIconUrls[platform]) {
    const icon = document.createElement('img');

    icon.className = 'message__badge-symbol message__badge-symbol--image';
    icon.src = platformIconUrls[platform];
    icon.alt = '';
    icon.referrerPolicy = 'no-referrer';
    icon.addEventListener('error', () => {
      icon.replaceWith(renderPlatformSymbol(platform));
    });
    badge.append(icon);
  } else if (platformSymbols[platform]) {
    badge.append(renderPlatformSymbol(platform));
  }

  badge.append(label);
  return badge;
};

const renderPlatformSymbol = (platform) => {
  const symbol = document.createElement('span');

  symbol.className = 'message__badge-symbol';
  symbol.textContent = platformSymbols[platform] ?? platform.charAt(0).toUpperCase();
  return symbol;
};

const renderMessageTextFragments = (message) => {
  const fragments =
    Array.isArray(message.fragments) && message.fragments.length > 0
      ? message.fragments
      : [{ type: 'text', text: message.text }];

  return fragments.map((fragment) => {
    if (fragment.type !== 'emote' || !fragment.imageUrl) {
      return renderMentionedText(fragment.text);
    }

    return [renderChatEmote(fragment)];
  }).flat();
};

const renderMentionedText = (text) =>
  messageHighlightUtils
    .splitTextByMention(text, [...loggedIdentities.values()])
    .map((part) => {
      if (part.type !== 'mention') {
        return document.createTextNode(part.text);
      }

      const mention = document.createElement('span');

      mention.className = 'message__mention';
      mention.textContent = part.text;
      return mention;
    });

const renderChatEmote = (fragment) => {
  const image = document.createElement('img');

  image.className = 'chat-emote';
  image.addEventListener('load', maintainFeedBottomAfterMediaLoad, { once: true });
  if (isExtensionEmote(fragment)) {
    image.classList.add('chat-emote--extension');
    image.addEventListener('load', () => markLargeExtensionEmote(image), { once: true });
  }
  image.src = fragment.imageUrl;
  image.alt = fragment.text;
  image.title = fragment.text;
  image.loading = 'lazy';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => {
    image.replaceWith(document.createTextNode(fragment.text));
  });

  return image;
};

const markLargeExtensionEmote = (image) => {
  const { naturalHeight, naturalWidth } = image;

  if (naturalHeight > 72 || naturalWidth > 144 || naturalHeight > naturalWidth * 1.25) {
    image.classList.add('chat-emote--large');
  }
};

const isExtensionEmote = (fragment) => {
  const id = String(fragment.id ?? '');
  const imageUrl = String(fragment.imageUrl ?? '');

  return (
    id.startsWith('bttv:') ||
    id.startsWith('7tv:') ||
    imageUrl.includes('cdn.betterttv.net') ||
    imageUrl.includes('cdn.7tv.app')
  );
};

const renderAuthorAvatar = (message) => {
  const avatarUrl = message.author.avatarUrl || message.avatarUrl;
  const fallback = document.createElement('span');

  fallback.className = 'message__avatar message__avatar--fallback';
  fallback.textContent = (message.author.name || message.platform || '?').trim().charAt(0) || '?';

  if (!avatarUrl) {
    return fallback;
  }

  const image = document.createElement('img');

  image.className = 'message__avatar';
  image.src = avatarUrl;
  image.alt = '';
  image.loading = 'lazy';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => image.replaceWith(fallback));

  return image;
};

const renderAuthorBadges = (badges = []) =>
  badges.map((badge) => {
    const element = document.createElement('span');

    element.className = `author-badge author-badge--${badge.id}`;
    element.title = badge.label;

    if (badge.imageUrl) {
      const image = document.createElement('img');

      element.classList.add('author-badge--image');
      image.className = 'author-badge__image';
      image.src = badge.imageUrl;
      image.alt = badge.label;
      image.loading = 'lazy';
      element.append(image);
    } else {
      element.textContent = badge.label;
    }

    return element;
  });

const updateMessageMetrics = () => {
  if (!messageCount || !visibleMessageCount) {
    return;
  }

  messageCount.textContent = String(totalMessages);
  visibleMessageCount.textContent = String(getFilteredMessages().length);
};

const renderFeed = ({ stickToBottom = isAutoscrollEnabled() } = {}) => {
  if (!messageFeed || !emptyState) {
    return;
  }

  const previousScrollTop = messageFeed.scrollTop;
  const visibleMessages = getFilteredMessages().slice(-maxRenderedMessages);

  messageFeed.replaceChildren(
    ...(visibleMessages.length > 0
      ? visibleMessages.map(renderMessage)
      : [emptyState]),
  );
  emptyState.textContent =
    areAllFilterPlatformsActive()
      ? 'Waiting for messages...'
      : `No ${formatActiveFilterLabel()} messages.`;

  if (stickToBottom) {
    scrollFeedToBottom();
  } else {
    messageFeed.scrollTop = previousScrollTop;
  }

  updateMessageMetrics();
  updateResumeChatControl();
};

const renderConnectorStatus = (status) => {
  const card = statusCards.get(status.platform);

  if (!card) {
    return;
  }

  const state = status.state ?? 'idle';
  const stateElement = card.querySelector('[data-status-state]');
  const detailElement = card.querySelector('[data-status-detail]');
  const messageCount = status.messageCount ?? platformCounts.get(status.platform) ?? 0;
  const detailParts = [
    status.error,
    status.details?.channel ? `Channel: ${status.details.channel}` : undefined,
    status.details?.liveUrl ? 'Live configured' : undefined,
    status.details?.authenticatedUser
      ? `Authenticated: ${status.details.authenticatedUser}`
      : undefined,
    formatStatusSourcesDetail(status.details?.sources),
    formatRelativeDetail(status.lastMessageAt),
    `${messageCount} msg`,
  ].filter(Boolean);

  card.dataset.state = state;
  stateElement.textContent = stateLabels[state] ?? state;
  detailElement.textContent = detailParts.join(' | ');
  card.dataset.statusTitle = formatStatusSourcesTitle(status);
};

const renderViewerSnapshot = (snapshot) => {
  if (!snapshot?.platforms) {
    return;
  }

  for (const viewer of snapshot.platforms) {
    const card = viewerCards.get(viewer.platform);

    if (!card) {
      continue;
    }

    card.dataset.viewerState = viewer.state;
    const countElement = card.querySelector('[data-viewer-count]');

    countElement.textContent = viewer.count === undefined ? '--' : formatViewerCount(viewer.count);
    countElement.removeAttribute('title');
    card.removeAttribute('title');
    const viewerTooltip = formatViewerSourcesTooltip(viewer);

    if (viewerTooltip) {
      card.dataset.viewerTooltip = viewerTooltip;
      card.setAttribute('aria-label', viewerTooltip);
    } else {
      delete card.dataset.viewerTooltip;
      card.removeAttribute('aria-label');
    }

    if (viewer.state === 'available' && viewerUpdateTimes.get(viewer.platform) !== viewer.updatedAt) {
      viewerUpdateTimes.set(viewer.platform, viewer.updatedAt);
      countElement.classList.remove('status-card__viewer-count--updated');
      void countElement.offsetWidth;
      countElement.classList.add('status-card__viewer-count--updated');
    }
    card.querySelector('[data-viewer-detail]').textContent =
      viewer.error || viewerStateLabels[viewer.state] || 'viewers unavailable';
  }

  if (totalViewerCount) {
    totalViewerCount.textContent = formatViewerCount(snapshot.total ?? 0);
  }
};

const formatStatusSourcesDetail = (sources = []) => {
  const activeSources = sources.filter((source) => source.source);

  if (activeSources.length === 0) {
    return undefined;
  }

  return activeSources.map(formatStatusSourceLabel).join(', ');
};

const formatStatusSourcesTitle = (status) => {
  const sources = status.details?.sources ?? [];

  if (sources.length === 0) {
    return status.error || `${platformLabels[status.platform] ?? status.platform}: no sources`;
  }

  return sources.map((source) => {
    const label = formatStatusSourceLabel(source);
    const state = stateLabels[source.state] ?? source.state ?? 'Idle';
    const count = source.messageCount ?? 0;
    const error = source.error ? ` - ${source.error}` : '';

    return `${label}: ${state}, ${count} msg${error}`;
  }).join('\n');
};

const formatStatusSourceLabel = (sourceStatus = {}) =>
  sourceStatus.source?.channelLabel ||
  sourceStatus.details?.channel ||
  sourceStatus.details?.liveUrl ||
  sourceStatus.source?.sourceId ||
  'source';

const formatViewerSourcesTooltip = (viewer = {}) => {
  const sources = viewer.sources ?? [];

  if (sources.length < 2) {
    return undefined;
  }

  const platform = platformLabels[viewer.platform] ?? viewer.platform ?? 'Platform';

  return [
    platform,
    ...sources.map((source) => {
      const label = source.source?.channelLabel ?? source.source?.sourceId ?? 'source';
      const count = source.count === undefined ? '--' : formatViewerCount(source.count);
      const state = source.error || viewerStateLabels[source.state] || source.state;

      return `${label}: ${count} (${state})`;
    }),
  ].join('\n');
};

const formatViewerCount = (count) => new Intl.NumberFormat('en-US').format(count);

const setFormValue = (name, value) => {
  const field = configForm?.elements.namedItem(name);

  if (!field) {
    return;
  }

  if (field.type === 'checkbox') {
    field.checked = Boolean(value);
    return;
  }

  field.value = value ?? '';
};

const getFormValue = (name) => {
  const field = configForm.elements.namedItem(name);

  if (field.type === 'checkbox') {
    return field.checked;
  }

  return field.value.trim();
};

const getNamedFormValue = (form, name) => {
  const field = form.elements.namedItem(name);

  if (!field) {
    return '';
  }

  return field.value.trim();
};

const populateConfigForm = (config) => {
  if (!configForm || !config?.connectors) {
    return;
  }

  setFormValue('ui.theme', config.ui?.theme);
  setFormValue('twitch.enabled', config.connectors.twitch.enabled);
  setFormValue('twitch.channel', config.connectors.twitch.channel);
  setFormValue('twitch.channel2', config.connectors.twitch.sources?.[1]?.channel);
  renderTwitchAuthStatus(config.connectors.twitch.auth);
  setFormValue('kick.enabled', config.connectors.kick.enabled);
  setFormValue('kick.channel', config.connectors.kick.channel);
  setFormValue('kick.channel2', config.connectors.kick.sources?.[1]?.channel);
  renderKickAuthStatus(config.connectors.kick.auth);
  setFormValue('x.enabled', config.connectors.x.enabled);
  setFormValue('x.liveUrl', config.connectors.x.liveUrl);
  setFormValue('x.liveUrl2', config.connectors.x.sources?.[1]?.liveUrl);
  setFormValue('x.showBrowser', config.connectors.x.showBrowser);
  renderXAuthStatus(xAuthState);
};

const readConfigForm = () => ({
  ui: {
    theme: getFormValue('ui.theme'),
  },
  connectors: {
    twitch: {
      enabled: getFormValue('twitch.enabled'),
      channel: getFormValue('twitch.channel'),
      sources: [
        {
          enabled: Boolean(getFormValue('twitch.channel')),
          channel: getFormValue('twitch.channel'),
        },
        {
          enabled: Boolean(getFormValue('twitch.channel2')),
          channel: getFormValue('twitch.channel2'),
        },
      ],
    },
    kick: {
      enabled: getFormValue('kick.enabled'),
      channel: getFormValue('kick.channel'),
      sources: [
        {
          enabled: Boolean(getFormValue('kick.channel')),
          channel: getFormValue('kick.channel'),
        },
        {
          enabled: Boolean(getFormValue('kick.channel2')),
          channel: getFormValue('kick.channel2'),
        },
      ],
    },
    x: {
      enabled: getFormValue('x.enabled'),
      liveUrl: getFormValue('x.liveUrl'),
      sources: [
        {
          enabled: Boolean(getFormValue('x.liveUrl')),
          liveUrl: getFormValue('x.liveUrl'),
        },
        {
          enabled: Boolean(getFormValue('x.liveUrl2')),
          liveUrl: getFormValue('x.liveUrl2'),
        },
      ],
      showBrowser: getFormValue('x.showBrowser'),
    },
  },
});

const renderConfigSnapshot = (snapshot) => {
  document.documentElement.dataset.theme = snapshot.config.ui?.theme ?? 'light';
  updateLoggedIdentities(snapshot.config);
  renderFeed();

  if (configForm) {
    populateConfigForm(snapshot.config);
  }

  if (Array.isArray(snapshot.statuses)) {
    for (const status of snapshot.statuses) {
      renderConnectorStatus(status);
    }
  }

  renderViewerSnapshot(snapshot.viewers);

  const overrideText =
    snapshot.envOverrides?.length > 0
      ? `Environment overrides active: ${snapshot.envOverrides.join(', ')}. Saved changes apply after clearing those variables.`
      : 'Using saved configuration.';
  const pathText = snapshot.configPath ? ` Saved at ${snapshot.configPath}.` : '';

  if (configMeta) {
    configMeta.textContent = `${overrideText}${pathText}`;
    void refreshXAuthStatus();
  }
};

const setConfigBusy = (isBusy) => {
  for (const field of [...configForm.elements]) {
    field.disabled = isBusy;
  }

  restartConnectors.disabled = isBusy;
  connectTwitch.disabled = isBusy;
  disconnectTwitch.disabled = isBusy;
  clearTwitchSession.disabled = isBusy;
  connectKick.disabled = isBusy;
  disconnectKick.disabled = isBusy;
  clearKickSession.disabled = isBusy;
  connectX.disabled = isBusy;
  disconnectX.disabled = isBusy;
};

const renderTwitchAuthStatus = (auth = {}) => {
  const label = auth.displayName || auth.login;

  twitchAuthStatus.textContent =
    auth.connected && label ? `Connected as ${label}` : 'Not connected';
  connectTwitch.hidden = Boolean(auth.connected);
  disconnectTwitch.hidden = !auth.connected;
};

const renderKickAuthStatus = (auth = {}) => {
  const label = auth.displayName || auth.login;

  kickAuthStatus.textContent = auth.connected && label ? `Connected as ${label}` : 'Not connected';
  connectKick.hidden = Boolean(auth.connected);
  disconnectKick.hidden = !auth.connected;
};

const renderXAuthStatus = (auth = {}) => {
  xAuthState = { connected: Boolean(auth.connected) };

  if (!xAuthState.connected) {
    loggedIdentities.delete('x');
  }

  xAuthStatus.textContent = xAuthState.connected
    ? 'Connected browser session'
    : 'Not connected';
  connectX.hidden = xAuthState.connected;
  disconnectX.hidden = !xAuthState.connected;
};

const refreshXAuthStatus = async () => {
  if (typeof window.chatAggregator?.getXAuthStatus !== 'function') {
    renderXAuthStatus({ connected: false });
    return xAuthState;
  }

  let auth;

  try {
    auth = await window.chatAggregator.getXAuthStatus();
  } catch (error) {
    xAuthStatus.textContent = `Session check failed: ${error.message}`;
    return xAuthState;
  }

  renderXAuthStatus(auth);
  return auth;
};

const startXAuthPolling = () => {
  clearInterval(xAuthPollingTimer);
  const expiresAt = Date.now() + 60_000;

  xAuthPollingTimer = setInterval(async () => {
    const auth = await refreshXAuthStatus();

    if (auth.connected || Date.now() >= expiresAt) {
      clearInterval(xAuthPollingTimer);
      xAuthPollingTimer = undefined;
    }
  }, 2_000);
};

const setComposerBusy = (isBusy) => {
  for (const field of [...messageComposer.elements]) {
    field.disabled = isBusy;
  }
};

const updateStatusForMessage = (message) => {
  platformCounts.set(message.platform, (platformCounts.get(message.platform) ?? 0) + 1);
};

window.chatAggregator?.onConnectorStatuses((statuses) => {
  for (const status of statuses) {
    renderConnectorStatus(status);
  }
});

window.chatAggregator?.onConfigChanged((snapshot) => {
  renderConfigSnapshot(snapshot);
});

window.chatAggregator?.onViewerCounts(renderViewerSnapshot);

window.chatAggregator?.onConnectorStatus((status) => {
  renderConnectorStatus(status);
});

window.chatAggregator?.onChatMessage((message) => {
  const shouldStickToBottom = isAutoscrollEnabled();

  totalMessages += 1;
  identifyOwnIncomingMessage(message);
  messages.push(message);
  updateStatusForMessage(message);

  if (messages.length > 1_000) {
    messages.splice(0, messages.length - 1_000);
  }

  if (!shouldStickToBottom && isMessageVisibleInActiveFilter(message)) {
    unseenMessageCount += 1;
    chatScrollDebug.log('message_buffered', {
      messageId: message.id,
      platform: message.platform,
      shouldStickToBottom,
      unseenMessageCount,
    });
  }

  renderFeed({ stickToBottom: shouldStickToBottom });
});

updatePlatformFilterButtons();

platformFilter?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter-platform]');

  if (!button) {
    return;
  }

  const platform = button.dataset.filterPlatform;

  if (platform === 'all') {
    activeFilterPlatforms.clear();
    for (const filterPlatform of filterPlatforms) {
      activeFilterPlatforms.add(filterPlatform);
    }
  } else if (activeFilterPlatforms.has(platform) && activeFilterPlatforms.size > 1) {
    activeFilterPlatforms.delete(platform);
  } else if (!activeFilterPlatforms.has(platform) && filterPlatforms.includes(platform)) {
    activeFilterPlatforms.add(platform);
  }

  setFeedPinnedToBottom(true, 'filter_click', {
    activeFilterPlatforms: [...activeFilterPlatforms],
  });
  unseenMessageCount = 0;
  updatePlatformFilterButtons();
  renderFeed({ stickToBottom: true });
});

resumeChat?.addEventListener('click', () => {
  chatScrollDebug.log('resume_click');
  scrollFeedToBottom();
});

messageFeed?.addEventListener('scroll', (event) => {
  setFeedPinnedToBottom(isFeedScrolledToBottom(), 'scroll', {
    isTrusted: event.isTrusted,
  });

  if (feedPinnedToBottom) {
    unseenMessageCount = 0;
  }

  updateResumeChatControl();
});

messageFeed?.addEventListener('wheel', (event) => {
  if (event.deltaY >= 0) {
    return;
  }

  setFeedPinnedToBottom(false, 'wheel_up', { deltaY: event.deltaY });
  updateResumeChatControl();
});

clearFeed?.addEventListener('click', () => {
  messages.length = 0;
  totalMessages = 0;
  unseenMessageCount = 0;
  setFeedPinnedToBottom(true, 'clear_feed');
  platformCounts.clear();
  renderFeed({ stickToBottom: true });
});

configForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setConfigBusy(true);
  configMeta.textContent = 'Saving configuration...';

  try {
    const snapshot = await window.chatAggregator.saveConfig(readConfigForm());
    renderConfigSnapshot(snapshot);
    configMeta.textContent = 'Configuration saved.';

    try {
      await window.chatAggregator.openDashboard();
    } catch (error) {
      configMeta.textContent = `Configuration saved, but dashboard failed to open: ${error.message}`;
    }
  } catch (error) {
    configMeta.textContent = `Save failed: ${error.message}`;
  } finally {
    setConfigBusy(false);
  }
});

restartConnectors?.addEventListener('click', async () => {
  setConfigBusy(true);

  try {
    const snapshot = await window.chatAggregator.restartConnectors();
    renderConfigSnapshot(snapshot);
  } finally {
    setConfigBusy(false);
  }
});

connectTwitch?.addEventListener('click', async () => {
  setConfigBusy(true);
  configMeta.textContent = 'Opening Twitch authorization...';

  try {
    await window.chatAggregator.saveConfig(readConfigForm());
    const snapshot = await window.chatAggregator.connectTwitch();

    renderConfigSnapshot(snapshot);
    configMeta.textContent = 'Twitch account connected.';
  } catch (error) {
    configMeta.textContent = `Twitch connection failed: ${error.message}`;
  } finally {
    setConfigBusy(false);
  }
});

disconnectTwitch?.addEventListener('click', async () => {
  setConfigBusy(true);
  configMeta.textContent = 'Disconnecting Twitch...';

  try {
    const snapshot = await window.chatAggregator.disconnectTwitch();

    renderConfigSnapshot(snapshot);
    configMeta.textContent = 'Twitch account disconnected.';
  } catch (error) {
    configMeta.textContent = `Twitch disconnect failed: ${error.message}`;
  } finally {
    setConfigBusy(false);
  }
});

clearTwitchSession?.addEventListener('click', async () => {
  setConfigBusy(true);
  configMeta.textContent = 'Clearing Twitch login session...';

  try {
    await window.chatAggregator.clearTwitchSession();
    configMeta.textContent = 'Twitch login session cleared. Connect again to choose an account.';
  } catch (error) {
    configMeta.textContent = `Twitch session clear failed: ${error.message}`;
  } finally {
    setConfigBusy(false);
  }
});

connectKick?.addEventListener('click', async () => {
  setConfigBusy(true);
  configMeta.textContent = 'Opening Kick authorization...';

  try {
    await window.chatAggregator.saveConfig(readConfigForm());
    const snapshot = await window.chatAggregator.connectKick();

    renderConfigSnapshot(snapshot);
    configMeta.textContent = 'Kick account connected.';
  } catch (error) {
    configMeta.textContent = `Kick connection failed: ${error.message}`;
  } finally {
    setConfigBusy(false);
  }
});

connectX?.addEventListener('click', async () => {
  setConfigBusy(true);
  configMeta.textContent = 'Opening X login window...';

  try {
    await window.chatAggregator.saveConfig(readConfigForm());
    await window.chatAggregator.connectX();
    const auth = await refreshXAuthStatus();

    configMeta.textContent =
      auth.connected
        ? 'X browser session is connected.'
        : 'X login window opened. Log into X there, then close it when the session is ready.';
    startXAuthPolling();
  } catch (error) {
    configMeta.textContent = `X connection failed: ${error.message}`;
  } finally {
    setConfigBusy(false);
  }
});

disconnectX?.addEventListener('click', async () => {
  setConfigBusy(true);
  configMeta.textContent = 'Disconnecting X browser session...';

  try {
    const snapshot = await window.chatAggregator.disconnectX();

    renderConfigSnapshot(snapshot);
    await refreshXAuthStatus();
    configMeta.textContent = 'X browser session disconnected.';
  } catch (error) {
    configMeta.textContent = `X disconnect failed: ${error.message}`;
  } finally {
    setConfigBusy(false);
  }
});

disconnectKick?.addEventListener('click', async () => {
  setConfigBusy(true);
  configMeta.textContent = 'Disconnecting Kick...';

  try {
    const snapshot = await window.chatAggregator.disconnectKick();

    renderConfigSnapshot(snapshot);
    configMeta.textContent = 'Kick account disconnected.';
  } catch (error) {
    configMeta.textContent = `Kick disconnect failed: ${error.message}`;
  } finally {
    setConfigBusy(false);
  }
});

clearKickSession?.addEventListener('click', async () => {
  setConfigBusy(true);
  configMeta.textContent = 'Clearing Kick login session...';

  try {
    await window.chatAggregator.clearKickSession();
    configMeta.textContent = 'Kick login session cleared. Connect again to choose an account.';
  } catch (error) {
    configMeta.textContent = `Kick session clear failed: ${error.message}`;
  } finally {
    setConfigBusy(false);
  }
});

messageComposer?.elements.namedItem('text')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return;
  }

  event.preventDefault();
  messageComposer.requestSubmit();
});

messageComposer?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const platform = getNamedFormValue(messageComposer, 'platform');
  const text = getNamedFormValue(messageComposer, 'text');

  if (!text) {
    composerMeta.textContent = 'Message text is required.';
    return;
  }

  setComposerBusy(true);
  composerMeta.textContent = `Sending to ${platformLabels[platform] ?? platform}...`;
  const pendingId = rememberPendingOutgoingMessage(platform, text);

  try {
    const result = await window.chatAggregator.sendMessage({ platform, text });

    messageComposer.elements.namedItem('text').value = '';
    composerMeta.textContent = `Sent to ${platformLabels[result.platform] ?? result.platform}.`;
  } catch (error) {
    forgetPendingOutgoingMessage(platform, pendingId);
    composerMeta.textContent = `Send failed: ${error.message}`;
  } finally {
    setComposerBusy(false);
  }
});

window.chatAggregator?.getConfig().then(renderConfigSnapshot);

renderFeed();
