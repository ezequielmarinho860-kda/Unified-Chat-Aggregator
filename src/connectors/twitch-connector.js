const { EventEmitter } = require('node:events');
const { fetchTwitchChatBadgeCatalog, sendTwitchChatMessage } = require('./twitch-api');
const { parseTwitchPrivmsg } = require('./twitch-irc-parser');

const TWITCH_IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const DEFAULT_RECONNECT_MS = 5_000;

const createTwitchConnector = ({
  channel,
  accessToken,
  fetchImpl = fetch,
  reconnectMs = DEFAULT_RECONNECT_MS,
  webSocketFactory = (url) => new WebSocket(url),
} = {}) => {
  const normalizedChannel = normalizeChannelName(channel);
  const events = new EventEmitter();
  let socket;
  let reconnectTimer;
  let shouldReconnect = false;
  let badgeCatalog = {};

  const connect = async () => {
    if (socket && socket.readyState <= WebSocket.OPEN) {
      return;
    }

    shouldReconnect = true;
    await loadBadgeCatalog();
    socket = webSocketFactory(TWITCH_IRC_URL);

    socket.addEventListener('open', () => {
      const nickname = `justinfan${Math.floor(Math.random() * 100000)}`;

      socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      socket.send('PASS SCHMOOPIIE');
      socket.send(`NICK ${nickname}`);
      socket.send(`JOIN #${normalizedChannel}`);
    });

    socket.addEventListener('message', (event) => {
      for (const line of String(event.data).split('\r\n').filter(Boolean)) {
        handleIrcLine(line);
      }
    });

    socket.addEventListener('close', scheduleReconnect);
    socket.addEventListener('error', () => {
      socket?.close();
    });
  };

  const disconnect = async () => {
    shouldReconnect = false;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;

    if (socket && socket.readyState <= WebSocket.OPEN) {
      socket.close();
    }

    socket = undefined;
  };

  const handleIrcLine = (line) => {
    if (line.startsWith('PING')) {
      socket?.send(line.replace('PING', 'PONG'));
      return;
    }

    const message = parseTwitchPrivmsg(line, { badgeCatalog });

    if (message) {
      events.emit('message', message);
    }
  };

  const loadBadgeCatalog = async () => {
    if (!accessToken) {
      badgeCatalog = {};
      return;
    }

    try {
      badgeCatalog = await fetchTwitchChatBadgeCatalog({
        channel: normalizedChannel,
        accessToken,
        fetchImpl,
      });
    } catch {
      badgeCatalog = {};
    }
  };

  const scheduleReconnect = () => {
    if (!shouldReconnect || reconnectTimer) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      socket = undefined;
      connect();
    }, reconnectMs);
  };

  return {
    platform: 'twitch',
    channel: normalizedChannel,
    onMessage: (listener) => {
      events.on('message', listener);
      return () => events.off('message', listener);
    },
    connect,
    disconnect,
    send: (text) =>
      sendTwitchChatMessage({
        channel: normalizedChannel,
        accessToken,
        message: text,
        fetchImpl,
      }),
  };
};

const normalizeChannelName = (channel) => {
  if (typeof channel !== 'string' || channel.trim().length === 0) {
    throw new TypeError('Twitch channel must be a non-empty string.');
  }

  return channel.trim().replace(/^#/, '').toLowerCase();
};

module.exports = {
  TWITCH_IRC_URL,
  createTwitchConnector,
  normalizeChannelName,
};
