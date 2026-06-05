const { EventEmitter } = require('node:events');
const { refreshKickAccessToken, sendKickChatMessage } = require('./kick-api');
const { parseKickPusherEnvelope } = require('./kick-pusher-parser');
const { normalizeKickChannelName, resolveKickChannel } = require('./kick-resolver');

const KICK_PUSHER_APP_KEY = '32cbd69e4b950bf97679';
const KICK_PUSHER_URL = `wss://ws-us2.pusher.com/app/${KICK_PUSHER_APP_KEY}?protocol=7&client=js&version=8.4.0&flash=false`;
const DEFAULT_RECONNECT_MS = 10_000;

const createKickConnector = ({
  channel,
  chatroomId,
  accessToken,
  refreshToken,
  clientId,
  clientSecret,
  oauthBrokerUrl,
  onAuthUpdate = async () => {},
  reconnectMs = DEFAULT_RECONNECT_MS,
  fetchImpl = fetch,
  resolveChannel = resolveKickChannel,
  webSocketFactory = (url) => new WebSocket(url),
} = {}) => {
  const normalizedChannel = normalizeKickChannelName(channel);
  const events = new EventEmitter();
  let resolvedChatroomId = chatroomId ? String(chatroomId) : undefined;
  let currentAccessToken = accessToken;
  let currentRefreshToken = refreshToken;
  let socket;
  let reconnectTimer;
  let shouldReconnect = false;

  const connect = async () => {
    if (socket && socket.readyState <= WebSocket.OPEN) {
      return;
    }

    shouldReconnect = true;

    try {
      if (!resolvedChatroomId) {
        const resolvedChannel = await resolveChannel({
          channel: normalizedChannel,
          fetchImpl,
        });
        resolvedChatroomId = resolvedChannel.chatroomId;
      }

      openSocket();
    } catch (error) {
      events.emit('connector-error', error);
      scheduleReconnect();
    }
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

  const openSocket = () => {
    socket = webSocketFactory(KICK_PUSHER_URL);

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          event: 'pusher:subscribe',
          data: {
            auth: '',
            channel: `chatrooms.${resolvedChatroomId}.v2`,
          },
        }),
      );
    });

    socket.addEventListener('message', (event) => {
      handlePusherMessage(event.data);
    });

    socket.addEventListener('close', () => {
      socket = undefined;
      scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      socket?.close();
    });
  };

  const handlePusherMessage = (rawMessage) => {
    const parsed = parseKickPusherEnvelope(String(rawMessage));

    if (!parsed) {
      return;
    }

    if (parsed.type === 'ping') {
      socket?.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      return;
    }

    if (parsed.message) {
      events.emit('message', parsed.message);
    }
  };

  const scheduleReconnect = () => {
    if (!shouldReconnect || reconnectTimer) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connect();
    }, reconnectMs);
  };

  const send = async (text) => {
    try {
      return await sendWithCurrentToken(text);
    } catch (error) {
      if (!isUnauthorizedKickError(error) || !currentRefreshToken) {
        throw error;
      }

      const token = await refreshKickAccessToken({
        refreshToken: currentRefreshToken,
        clientId,
        clientSecret,
        oauthBrokerUrl,
        fetchImpl,
      });

      currentAccessToken = token.accessToken;
      currentRefreshToken = token.refreshToken || currentRefreshToken;
      await onAuthUpdate({
        accessToken: currentAccessToken,
        refreshToken: currentRefreshToken,
        expiresAt: token.expiresAt,
      });

      return sendWithCurrentToken(text);
    }
  };

  const sendWithCurrentToken = (text) =>
    sendKickChatMessage({
      channel: normalizedChannel,
      accessToken: currentAccessToken,
      message: text,
      fetchImpl,
    });

  return {
    platform: 'kick',
    channel: normalizedChannel,
    onMessage: (listener) => {
      events.on('message', listener);
      return () => events.off('message', listener);
    },
    onError: (listener) => {
      events.on('connector-error', listener);
      return () => events.off('connector-error', listener);
    },
    connect,
    disconnect,
    send,
  };
};

const isUnauthorizedKickError = (error) =>
  error instanceof Error && /status 401|unauthorized/i.test(error.message);

module.exports = {
  KICK_PUSHER_APP_KEY,
  KICK_PUSHER_URL,
  createKickConnector,
};
