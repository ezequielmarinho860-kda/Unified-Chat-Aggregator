const title = window.chatAggregator?.appName ?? 'Unified Chat Aggregator';
const emptyState = document.querySelector('#empty-state');
const messageFeed = document.querySelector('#message-feed');
const messageCount = document.querySelector('#message-count');
const visibleMessageCount = document.querySelector('#visible-message-count');
const platformFilter = document.querySelector('#platform-filter');
const toggleAutoscroll = document.querySelector('#toggle-autoscroll');
const clearFeed = document.querySelector('#clear-feed');
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
  mock: 'Mock',
  twitch: 'Twitch',
  kick: 'Kick',
  x: 'X',
  youtube: 'YouTube',
};

const stateLabels = {
  connected: 'Conectado',
  connecting: 'Conectando',
  disabled: 'Desativado',
  disconnected: 'Desconectado',
  error: 'Erro',
  idle: 'Aguardando',
  observing: 'Observando',
};

const formatTimestamp = (timestamp) =>
  new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));

const formatRelativeDetail = (timestamp) => {
  if (!timestamp) {
    return 'Sem mensagens';
  }

  return `Ultima: ${formatTimestamp(timestamp)}`;
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
      ? 'Aguardando mensagens...'
      : `Sem mensagens de ${platformLabels[activeFilter] ?? activeFilter}.`;

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
    status.details?.channel ? `Canal: ${status.details.channel}` : undefined,
    status.details?.liveUrl ? 'Live configurada' : undefined,
    formatRelativeDetail(status.lastMessageAt),
    `${messageCount} msg`,
  ].filter(Boolean);

  card.dataset.state = state;
  stateElement.textContent = stateLabels[state] ?? state;
  detailElement.textContent = detailParts.join(' | ');
};

const updateStatusForMessage = (message) => {
  platformCounts.set(message.platform, (platformCounts.get(message.platform) ?? 0) + 1);
};

window.chatAggregator?.onConnectorStatuses((statuses) => {
  for (const status of statuses) {
    renderConnectorStatus(status);
  }
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
  toggleAutoscroll.textContent = autoscrollEnabled ? 'Pausar' : 'Retomar';

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

renderFeed();
