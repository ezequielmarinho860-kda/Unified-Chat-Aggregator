const { EventEmitter } = require('node:events');
const { refreshKickAccessToken, sendKickChatMessage } = require('./kick-api');
const { parseKickPusherEnvelope } = require('./kick-pusher-parser');
const { normalizeKickChannelName, resolveKickChannel } = require('./kick-resolver');

const KICK_PUSHER_APP_KEY = '32cbd69e4b950bf97679';
const KICK_PUSHER_URL = `wss://ws-us2.pusher.com/app/${KICK_PUSHER_APP_KEY}?protocol=7&client=js&version=8.4.0&flash=false`;
const DEFAULT_RECONNECT_MS = 10_000;
const DEFAULT_SEEN_MESSAGE_LIMIT = 500;

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
  seenMessageLimit = DEFAULT_SEEN_MESSAGE_LIMIT,
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
  const seenMessageIds = new Set();

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
    const nextSocket = webSocketFactory(KICK_PUSHER_URL);
    let isClosingAfterError = false;

    socket = nextSocket;

    nextSocket.addEventListener('open', () => {
      if (nextSocket !== socket) {
        return;
      }

      nextSocket.send(
        JSON.stringify({
          event: 'pusher:subscribe',
          data: {
            auth: '',
            channel: `chatrooms.${resolvedChatroomId}.v2`,
          },
        }),
      );
    });

    nextSocket.addEventListener('message', (event) => {
      if (nextSocket !== socket) {
        return;
      }

      handlePusherMessage(event.data);
    });

    nextSocket.addEventListener('close', () => {
      if (nextSocket === socket) {
        socket = undefined;
      }

      scheduleReconnect();
    });

    nextSocket.addEventListener('error', () => {
      if (nextSocket !== socket || isClosingAfterError || !canCloseSocket(nextSocket)) {
        return;
      }

      isClosingAfterError = true;
      nextSocket.close();
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

    if (parsed.message && rememberMessageId(parsed.message.id)) {
      events.emit('message', parsed.message);
    }
  };

  const rememberMessageId = (messageId) => {
    if (!messageId) {
      return true;
    }

    if (seenMessageIds.has(messageId)) {
      return false;
    }

    seenMessageIds.add(messageId);

    if (seenMessageIds.size > seenMessageLimit) {
      const oldestMessageId = seenMessageIds.values().next().value;

      seenMessageIds.delete(oldestMessageId);
    }

    return true;
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

const canCloseSocket = (socket) =>
  socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN;

module.exports = {
  DEFAULT_SEEN_MESSAGE_LIMIT,
  KICK_PUSHER_APP_KEY,
  KICK_PUSHER_URL,
  createKickConnector,
};
