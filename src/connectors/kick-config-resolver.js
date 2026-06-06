const resolveKickChatroomForConfig = async ({
  config,
  previousConfig,
  resolveChannel,
} = {}) => {
  const kick = config?.connectors?.kick;
  const previousKick = previousConfig?.connectors?.kick;

  if (!kick?.enabled || !kick.channel) {
    return config;
  }

  const channelChanged = kick.channel !== previousKick?.channel;

  if (!channelChanged && kick.chatroomId) {
    return config;
  }

  if (typeof resolveChannel !== 'function') {
    throw new TypeError('Kick channel resolver is required.');
  }

  const resolved = await resolveChannel({ channel: kick.channel });

  return {
    ...config,
    connectors: {
      ...config.connectors,
      kick: {
        ...kick,
        channel: resolved.channel,
        chatroomId: resolved.chatroomId,
      },
    },
  };
};

module.exports = {
  resolveKickChatroomForConfig,
};
