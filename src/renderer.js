const title = window.chatAggregator?.appName ?? 'Unified Chat Aggregator';
const messageFeed = document.querySelector('#message-feed');
const messageCount = document.querySelector('#message-count');
let totalMessages = 0;

document.title = title;

const platformLabels = {
  mock: 'Mock',
  twitch: 'Twitch',
  kick: 'Kick',
  x: 'X',
  youtube: 'YouTube',
};

const formatTimestamp = (timestamp) =>
  new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));

const renderMessage = (message) => {
  const item = document.createElement('li');
  item.className = 'message';

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

window.chatAggregator?.onChatMessage((message) => {
  totalMessages += 1;
  messageCount.textContent = String(totalMessages);
  messageFeed.append(renderMessage(message));
  messageFeed.scrollTop = messageFeed.scrollHeight;
});
