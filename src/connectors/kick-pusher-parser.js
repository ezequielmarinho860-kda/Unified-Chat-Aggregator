const { normalizeChatMessage } = require('../chat-message');

const KICK_CHAT_MESSAGE_EVENT = 'App\\Events\\ChatMessageEvent';

const parseKickPusherEnvelope = (rawMessage) => {
  const envelope =
    typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage;

  if (envelope.event === 'pusher:ping') {
    return { type: 'ping' };
  }

  if (envelope.event !== KICK_CHAT_MESSAGE_EVENT) {
    return undefined;
  }

  const data =
    typeof envelope.data === 'string' ? JSON.parse(envelope.data) : envelope.data;

  return {
    type: 'message',
    message: normalizeKickChatMessage(data, envelope),
  };
};

const normalizeKickChatMessage = (data, envelope) => {
  const sender = data.sender ?? data.user ?? {};
  const username = sender.username ?? sender.slug ?? sender.name ?? 'unknown';
  const text = String(data.content ?? data.message ?? '').trim();

  if (!text) {
    return undefined;
  }

  return normalizeChatMessage({
    id: String(data.id ?? `${data.chatroom_id ?? 'kick'}-${Date.now()}`),
    platform: 'kick',
    author: {
      id: String(sender.id ?? username),
      name: String(username),
      avatarUrl: sender.profile_pic ?? sender.profilePic,
    },
    text,
    timestamp: normalizeKickTimestamp(data.created_at ?? data.createdAt),
    raw: {
      envelope,
      data,
    },
  });
};

const normalizeKickTimestamp = (value) => {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
};

module.exports = {
  KICK_CHAT_MESSAGE_EVENT,
  parseKickPusherEnvelope,
};
