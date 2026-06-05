const title = window.chatAggregator?.appName ?? 'Unified Chat Aggregator';
const emptyState = document.querySelector('#empty-state');
const messageFeed = document.querySelector('#message-feed');
const messageCount = document.querySelector('#message-count');
const visibleMessageCount = document.querySelector('#visible-message-count');
const platformFilter = document.querySelector('#platform-filter');
const toggleAutoscroll = document.querySelector('#toggle-autoscroll');
const clearFeed = document.querySelector('#clear-feed');
const configForm = document.querySelector('#connector-config-form');
const configMeta = document.querySelector('#config-meta');
const restartConnectors = document.querySelector('#restart-connectors');
const resolveKickChatroom = document.querySelector('#resolve-kick-chatroom');
const connectTwitch = document.querySelector('#connect-twitch');
const disconnectTwitch = document.querySelector('#disconnect-twitch');
const twitchAuthStatus = document.querySelector('#twitch-auth-status');
const connectKick = document.querySelector('#connect-kick');
const disconnectKick = document.querySelector('#disconnect-kick');
const kickAuthStatus = document.querySelector('#kick-auth-status');
const messageComposer = document.querySelector('#message-composer');
const composerMeta = document.querySelector('#composer-meta');
const statusCards = new Map(
  [...document.querySelectorAll('[data-platform]')].map((card) => [
    card.dataset.platform,
    card,
  ]),
);
const messages = [];
const platformCounts = new Map();
const maxRenderedMessages = 250;
let activeFilter = 'all';
let autoscrollEnabled = true;
let totalMessages = 0;

document.title = title;

const platformLabels = {
  twitch: 'Twitch',
  kick: 'Kick',
  x: 'X',
  youtube: 'YouTube',
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

const renderMessage = (message) => {
  const item = document.createElement('li');
  item.className = 'message';
  item.dataset.platform = message.platform;

  const badge = document.createElement('span');
  badge.className = `message__badge message__badge--${message.platform}`;
  badge.textContent = platformLabels[message.platform] ?? message.platform;

  const author = document.createElement('strong');
  author.className = 'message__author';
  author.textContent = message.author.name;

  const time = document.createElement('time');
  time.className = 'message__time';
  time.dateTime = message.timestamp;
  time.textContent = formatTimestamp(message.timestamp);

  const text = document.createElement('p');
  text.className = 'message__text';
  text.textContent = message.text;

  const metadata = document.createElement('div');
  metadata.className = 'message__metadata';
  metadata.append(badge, author, time);

  item.append(metadata, text);
  return item;
};

const updateMessageMetrics = () => {
  messageCount.textContent = String(totalMessages);
  visibleMessageCount.textContent = String(
    activeFilter === 'all'
      ? messages.length
      : messages.filter((message) => message.platform === activeFilter).length,
  );
};

const renderFeed = () => {
  const filteredMessages =
    activeFilter === 'all'
      ? messages
      : messages.filter((message) => message.platform === activeFilter);
  const visibleMessages = filteredMessages.slice(-maxRenderedMessages);

  messageFeed.replaceChildren(
    ...(visibleMessages.length > 0
      ? visibleMessages.map(renderMessage)
      : [emptyState]),
  );
  emptyState.textContent =
    activeFilter === 'all'
      ? 'Waiting for messages...'
      : `No ${platformLabels[activeFilter] ?? activeFilter} messages.`;

  if (autoscrollEnabled) {
    messageFeed.scrollTop = messageFeed.scrollHeight;
  }

  updateMessageMetrics();
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
    formatRelativeDetail(status.lastMessageAt),
    `${messageCount} msg`,
  ].filter(Boolean);

  card.dataset.state = state;
  stateElement.textContent = stateLabels[state] ?? state;
  detailElement.textContent = detailParts.join(' | ');
};

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

  setFormValue('twitch.enabled', config.connectors.twitch.enabled);
  setFormValue('twitch.channel', config.connectors.twitch.channel);
  renderTwitchAuthStatus(config.connectors.twitch.auth);
  setFormValue('kick.enabled', config.connectors.kick.enabled);
  setFormValue('kick.channel', config.connectors.kick.channel);
  setFormValue('kick.chatroomId', config.connectors.kick.chatroomId);
  renderKickAuthStatus(config.connectors.kick.auth);
  setFormValue('x.enabled', config.connectors.x.enabled);
  setFormValue('x.liveUrl', config.connectors.x.liveUrl);
  setFormValue('x.showBrowser', config.connectors.x.showBrowser);
};

const readConfigForm = () => ({
  connectors: {
    twitch: {
      enabled: getFormValue('twitch.enabled'),
      channel: getFormValue('twitch.channel'),
    },
    kick: {
      enabled: getFormValue('kick.enabled'),
      channel: getFormValue('kick.channel'),
      chatroomId: getFormValue('kick.chatroomId'),
    },
    x: {
      enabled: getFormValue('x.enabled'),
      liveUrl: getFormValue('x.liveUrl'),
      showBrowser: getFormValue('x.showBrowser'),
    },
  },
});

const renderConfigSnapshot = (snapshot) => {
  populateConfigForm(snapshot.config);

  if (Array.isArray(snapshot.statuses)) {
    for (const status of snapshot.statuses) {
      renderConnectorStatus(status);
    }
  }

  const overrideText =
    snapshot.envOverrides?.length > 0
      ? `Environment overrides active: ${snapshot.envOverrides.join(', ')}. Saved changes apply after clearing those variables.`
      : 'Using saved configuration.';
  const pathText = snapshot.configPath ? ` Saved at ${snapshot.configPath}.` : '';

  configMeta.textContent = `${overrideText}${pathText}`;
};

const setConfigBusy = (isBusy) => {
  for (const field of [...configForm.elements]) {
    field.disabled = isBusy;
  }

  restartConnectors.disabled = isBusy;
  connectTwitch.disabled = isBusy;
  disconnectTwitch.disabled = isBusy;
  connectKick.disabled = isBusy;
  disconnectKick.disabled = isBusy;
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

window.chatAggregator?.onConnectorStatus((status) => {
  renderConnectorStatus(status);
});

window.chatAggregator?.onChatMessage((message) => {
  totalMessages += 1;
  messages.push(message);
  updateStatusForMessage(message);

  if (messages.length > 1_000) {
    messages.splice(0, messages.length - 1_000);
  }

  renderFeed();
});

platformFilter?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter-platform]');

  if (!button) {
    return;
  }

  activeFilter = button.dataset.filterPlatform;

  for (const filterButton of platformFilter.querySelectorAll('.filter-button')) {
    filterButton.classList.toggle('is-active', filterButton === button);
  }

  renderFeed();
});

toggleAutoscroll?.addEventListener('click', () => {
  autoscrollEnabled = !autoscrollEnabled;
  toggleAutoscroll.textContent = autoscrollEnabled ? 'Pause' : 'Resume';

  if (autoscrollEnabled) {
    messageFeed.scrollTop = messageFeed.scrollHeight;
  }
});

clearFeed?.addEventListener('click', () => {
  messages.length = 0;
  totalMessages = 0;
  platformCounts.clear();
  renderFeed();
});

configForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setConfigBusy(true);

  try {
    const snapshot = await window.chatAggregator.saveConfig(readConfigForm());
    renderConfigSnapshot(snapshot);
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

resolveKickChatroom?.addEventListener('click', async () => {
  const channel = getFormValue('kick.channel');

  if (!channel) {
    configMeta.textContent = 'Kick channel is required.';
    return;
  }

  setConfigBusy(true);
  configMeta.textContent = 'Resolving Kick chatroom...';

  try {
    const resolved = await window.chatAggregator.resolveKickChatroom(channel);

    setFormValue('kick.channel', resolved.channel);
    setFormValue('kick.chatroomId', resolved.chatroomId);
    configMeta.textContent = `Kick chatroom resolved for ${resolved.channel}. Save to apply.`;
  } catch (error) {
    configMeta.textContent = `Kick resolver failed: ${error.message}`;
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

  try {
    const result = await window.chatAggregator.sendMessage({ platform, text });

    messageComposer.elements.namedItem('text').value = '';
    composerMeta.textContent = `Sent to ${platformLabels[result.platform] ?? result.platform}.`;
  } catch (error) {
    composerMeta.textContent = `Send failed: ${error.message}`;
  } finally {
    setComposerBusy(false);
  }
});

window.chatAggregator?.getConfig().then(renderConfigSnapshot);

renderFeed();
