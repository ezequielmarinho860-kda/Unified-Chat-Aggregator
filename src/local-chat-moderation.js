const LOCAL_MODERATION_COMMANDS = Object.freeze([
  { name: '/ban', usage: '/ban nick reason', description: 'Ban a user by nick.' },
  { name: '/timeout', usage: '/timeout nick seconds reason', description: 'Timeout a user by nick.' },
  { name: '/unban', usage: '/unban nick', description: 'Remove a nick ban.' },
  { name: '/untimeout', usage: '/untimeout nick', description: 'Remove a nick timeout.' },
  { name: '/mod', usage: '/mod nick', description: 'Grant moderator by nick.' },
  { name: '/unmod', usage: '/unmod nick', description: 'Remove moderator by nick.' },
  { name: '/ban-email', usage: '/ban-email email reason', description: 'Ban a user by email.' },
  { name: '/unban-email', usage: '/unban-email email', description: 'Remove an email ban.' },
]);

const requireModerator = (user) => {
  if (!['host', 'moderator'].includes(user?.role)) {
    const error = new Error('Local chat moderator permission is required.');

    error.statusCode = 403;
    throw error;
  }
};

const applyModerationCommand = (localChatStore, command, moderator) => {
  const parsed = parseModerationCommand(command);
  const moderatorId = moderator.id;

  if (parsed.action === 'ban') {
    localChatStore.banUser({ ...parsed.target, reason: parsed.reason, moderatorId });
  } else if (parsed.action === 'timeout') {
    localChatStore.timeoutUser({
      ...parsed.target,
      durationSeconds: parsed.durationSeconds,
      reason: parsed.reason,
      moderatorId,
    });
  } else if (parsed.action === 'unban') {
    parsed.removed = localChatStore.unbanUser(parsed.target);
  } else if (parsed.action === 'untimeout') {
    parsed.removed = localChatStore.clearTimeout(parsed.target);
  } else if (parsed.action === 'mod') {
    localChatStore.addModerator(parsed.target);
  } else if (parsed.action === 'unmod') {
    parsed.removed = removeModeratorTarget(localChatStore, parsed.target);
  }

  return parsed;
};

const removeModeratorTarget = (localChatStore, target) => {
  let removed = localChatStore.removeModerator(target);
  const user = target.nick && typeof localChatStore.getUserByNick === 'function'
    ? localChatStore.getUserByNick(target.nick)
    : undefined;

  if (user?.email) {
    removed += localChatStore.removeModerator({ email: user.email });
  }

  return removed;
};

const parseModerationCommand = (command) => {
  const parts = typeof command === 'string' ? command.trim().split(/\s+/) : [];
  const name = parts.shift();

  if (!name?.startsWith('/')) {
    throwBadCommand();
  }

  if (['/ban', '/unban', '/untimeout', '/mod', '/unmod'].includes(name)) {
    const nick = parts.shift();

    if (!nick) {
      throwBadCommand();
    }

    return {
      action: name.slice(1),
      reason: parts.join(' '),
      target: { nick },
    };
  }

  if (name === '/ban-email' || name === '/unban-email') {
    const email = parts.shift();

    if (!email) {
      throwBadCommand();
    }

    return {
      action: name === '/ban-email' ? 'ban' : 'unban',
      reason: parts.join(' '),
      target: { email },
    };
  }

  if (name === '/timeout') {
    const nick = parts.shift();
    const durationSeconds = parts.shift();

    if (!nick || !durationSeconds) {
      throwBadCommand();
    }

    return {
      action: 'timeout',
      durationSeconds,
      reason: parts.join(' '),
      target: { nick },
    };
  }

  throwBadCommand();
};

const throwBadCommand = () => {
  const error = new Error('Local chat moderation command is invalid.');

  error.statusCode = 400;
  throw error;
};

module.exports = {
  LOCAL_MODERATION_COMMANDS,
  applyModerationCommand,
  requireModerator,
};
