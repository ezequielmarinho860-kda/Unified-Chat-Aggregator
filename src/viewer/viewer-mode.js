(() => {
  const MAX_MESSAGES = 200;
  const reconnectBaseMs = 1_000;
  const reconnectMaxMs = 10_000;
  const state = {
    socket: undefined,
    snapshot: undefined,
    reconnectAttempt: 0,
    messageCount: 0,
    messages: [],
    messageKeys: new Set(),
  };
  const elements = {
    title: document.querySelector('[data-viewer-title]'),
    connectionCard: document.querySelector('.connection-card'),
    connectionLabel: document.querySelector('[data-connection-label]'),
    connectionDetail: document.querySelector('[data-connection-detail]'),
    playerPanel: document.querySelector('[data-player-panel]'),
    viewerTotal: document.querySelector('[data-viewer-total]'),
    viewerUpdated: document.querySelector('[data-viewer-updated]'),
    sourceList: document.querySelector('[data-source-list]'),
    messageCount: document.querySelector('[data-message-count]'),
    chatList: document.querySelector('[data-chat-list]'),
  };

  const setConnection = (connectionState, label, detail) => {
    elements.connectionCard.dataset.connectionState = connectionState;
    elements.connectionLabel.textContent = label;
    elements.connectionDetail.textContent = detail;
  };

  const start = async () => {
    try {
      await loadSnapshot();
      connectEvents();
    } catch (error) {
      setConnection('error', 'Viewer unavailable', error.message);
      scheduleReconnect();
    }
  };

  const loadSnapshot = async () => {
    setConnection('loading', 'Loading snapshot', 'Fetching public gateway state.');
    const response = await fetch('/api/v1/snapshot', { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`Snapshot request failed with ${response.status}.`);
    }

    applySnapshot(await response.json());
  };

  const connectEvents = () => {
    state.socket?.close();
    const socket = new WebSocket(createEventsUrl());

    state.socket = socket;
    setConnection('loading', 'Connecting realtime', 'Opening local WebSocket.');
    socket.addEventListener('open', () => {
      state.reconnectAttempt = 0;
      setConnection('connected', 'Live connection', 'Receiving public realtime events.');
    });
    socket.addEventListener('message', (event) => applyEvent(JSON.parse(event.data)));
    socket.addEventListener('close', () => {
      if (state.socket === socket) {
        setConnection('disconnected', 'Disconnected', 'Reconnecting with a fresh snapshot.');
        scheduleReconnect();
      }
    });
    socket.addEventListener('error', () => {
      setConnection('error', 'Connection error', 'Realtime stream is unavailable.');
    });
  };

  const createEventsUrl = () => {
    const url = new URL('/api/v1/events', window.location.href);

    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url;
  };

  const scheduleReconnect = () => {
    const delay = Math.min(reconnectBaseMs * 2 ** state.reconnectAttempt, reconnectMaxMs);

    state.reconnectAttempt += 1;
    setTimeout(() => {
      void start();
    }, delay);
  };

  const applyEvent = (event) => {
    if (!event || event.protocolVersion !== '1') {
      return;
    }

    if (event.type === 'snapshot.replace') {
      state.messageCount = 0;
      state.messages = [];
      state.messageKeys = new Set();
      applySnapshot(event.data);
    } else if (event.type === 'source.status') {
      upsertStatus(event.data);
      render();
    } else if (event.type === 'viewers.update') {
      state.snapshot = { ...state.snapshot, viewers: event.data };
      render();
    } else if (event.type === 'manifest.update') {
      state.snapshot = { ...state.snapshot, manifest: event.data };
      render();
    } else if (event.type === 'chat.message') {
      addChatMessage(event.data);
    }
  };

  const addChatMessage = (message) => {
    const messageKey = getMessageKey(message);

    if (!messageKey || state.messageKeys.has(messageKey)) {
      return;
    }

    state.messageKeys.add(messageKey);
    state.messages.push(message);
    state.messageCount += 1;

    while (state.messages.length > MAX_MESSAGES) {
      const removedMessage = state.messages.shift();
      state.messageKeys.delete(getMessageKey(removedMessage));
    }

    render({ stickToBottom: isChatNearBottom() });
  };

  const getMessageKey = (message) =>
    message?.source?.sourceId && message?.id ? `${message.source.sourceId}:${message.id}` : undefined;

  const applySnapshot = (snapshot) => {
    state.snapshot = {
      protocolVersion: snapshot?.protocolVersion,
      generatedAt: snapshot?.generatedAt,
      manifest: snapshot?.manifest ?? {},
      statuses: Array.isArray(snapshot?.statuses) ? snapshot.statuses : [],
      viewers: snapshot?.viewers ?? { sources: [], total: 0 },
    };
    render();
  };

  const upsertStatus = (status) => {
    const sourceId = status?.source?.sourceId;

    if (!sourceId) {
      return;
    }

    const statuses = [...(state.snapshot?.statuses ?? [])];
    const index = statuses.findIndex((existing) => existing.source?.sourceId === sourceId);

    if (index >= 0) {
      statuses[index] = status;
    } else {
      statuses.push(status);
    }

    state.snapshot = { ...state.snapshot, statuses };
  };

  const render = ({ stickToBottom = false } = {}) => {
    const snapshot = state.snapshot ?? {};

    elements.title.textContent = snapshot.manifest?.title ?? 'Unified Chat Aggregator';
    elements.viewerTotal.textContent = formatNumber(snapshot.viewers?.total ?? 0);
    elements.viewerUpdated.textContent = formatViewerUpdated(snapshot.viewers);
    elements.messageCount.textContent = formatNumber(state.messageCount);
    elements.playerPanel.replaceChildren(...createPlayerElements(snapshot.manifest));
    elements.sourceList.replaceChildren(...createSourceElements(snapshot));
    elements.chatList.replaceChildren(...createChatElements());

    if (stickToBottom) {
      elements.chatList.scrollTop = elements.chatList.scrollHeight;
    }
  };

  const createSourceElements = (snapshot) => {
    const rows = new Map();

    for (const source of snapshot.manifest?.sources ?? []) {
      rows.set(source.sourceId, { source });
    }

    for (const status of snapshot.statuses ?? []) {
      mergeSourceRow(rows, status.source, { status });
    }

    for (const viewer of snapshot.viewers?.sources ?? []) {
      mergeSourceRow(rows, viewer.source, { viewer });
    }

    return rows.size > 0 ? [...rows.values()].map(createSourceElement) : [createEmptySourceElement()];
  };

  const createPlayerElements = (manifest = {}) => {
    const source = (manifest.sources ?? []).find(
      (candidate) => candidate.player?.provider === 'twitch' && candidate.player.channel,
    );

    if (!source) {
      return [createPlayerFallback('No Twitch player is configured yet.')];
    }

    const title = document.createElement('h2');
    const frameWrap = document.createElement('div');
    const frame = document.createElement('iframe');
    const fallback = document.createElement('p');
    const link = document.createElement('a');

    title.textContent = source.channelLabel ?? source.player.channel;
    frameWrap.className = 'player-frame-wrap';
    frame.className = 'player-frame';
    frame.src = createTwitchPlayerUrl(source.player.channel);
    frame.title = `Twitch player for ${source.channelLabel ?? source.player.channel}`;
    frame.allow = 'autoplay; fullscreen; picture-in-picture';
    frame.allowFullscreen = true;
    link.href = source.watchUrl ?? `https://www.twitch.tv/${source.player.channel}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = 'Open on Twitch';
    fallback.className = 'player-fallback';
    fallback.append('If the embedded player is unavailable, ', link, '.');
    frameWrap.append(frame);

    return [createPanelKicker('Player'), title, frameWrap, fallback];
  };

  const createPlayerFallback = (message) => {
    const fallback = document.createElement('div');

    fallback.className = 'empty-state';
    fallback.textContent = message;
    return fallback;
  };

  const createPanelKicker = (text) => {
    const kicker = document.createElement('p');

    kicker.className = 'panel-kicker';
    kicker.textContent = text;
    return kicker;
  };

  const createTwitchPlayerUrl = (channel) => {
    const url = new URL('https://player.twitch.tv/');

    url.searchParams.set('channel', channel);
    url.searchParams.set('parent', window.location.hostname);
    url.searchParams.set('muted', 'true');
    return url.toString();
  };

  const mergeSourceRow = (rows, source, patch) => {
    if (source?.sourceId) {
      rows.set(source.sourceId, { ...rows.get(source.sourceId), source, ...patch });
    }
  };

  const createSourceElement = ({ source, status, viewer }) => {
    const row = document.createElement('div');
    const label = source.channelLabel ?? source.broadcasterName ?? source.sourceId;
    const viewerDisplay = getViewerDisplay(viewer);

    row.className = `source-row source-row-${viewerDisplay.state}`;
    row.innerHTML = [
      '<div class="source-main">',
      '<div class="source-name"></div>',
      '<div class="source-meta"></div>',
      '<div class="source-updated"></div>',
      '</div>',
      '<div class="source-viewers">',
      '<strong class="source-viewer-count"></strong>',
      '<span class="source-viewer-state"></span>',
      '<span class="source-state"></span>',
      '</div>',
    ].join('');
    row.querySelector('.source-name').textContent = source.platform;
    row.querySelector('.source-meta').textContent = label;
    row.querySelector('.source-updated').textContent = formatViewerSourceUpdated(viewer);
    row.querySelector('.source-viewer-count').textContent = viewerDisplay.count;
    row.querySelector('.source-viewer-state').textContent = viewerDisplay.label;
    row.querySelector('.source-state').textContent = `connector: ${status?.state ?? 'idle'}`;
    return row;
  };

  const createEmptySourceElement = () => {
    const row = document.createElement('div');

    row.className = 'empty-state';
    row.textContent = 'No public sources are enabled yet.';
    return row;
  };

  const createChatElements = () =>
    state.messages.length > 0
      ? state.messages.map(createMessageElement)
      : [createEmptyChatElement()];

  const createMessageElement = (message) => {
    const article = document.createElement('article');
    const avatar = createAvatarElement(message);
    const body = document.createElement('div');
    const meta = document.createElement('div');
    const platform = document.createElement('span');
    const source = document.createElement('span');
    const author = document.createElement('strong');
    const time = document.createElement('time');
    const content = document.createElement('div');

    article.className = 'chat-message';
    body.className = 'chat-message-body';
    meta.className = 'chat-message-meta';
    platform.className = 'platform-pill';
    source.className = 'source-pill';
    content.className = 'chat-message-content';

    platform.textContent = message.source?.platform ?? 'unknown';
    source.textContent = message.source?.channelLabel ?? message.source?.broadcasterName ?? 'unknown source';
    author.textContent = message.author?.name ?? 'Unknown';
    time.dateTime = message.timestamp ?? '';
    time.textContent = formatTime(message.timestamp);

    meta.append(platform, source, ...createBadgeElements(message.author?.badges), author, time);
    content.append(...createFragmentElements(message));
    body.append(meta, content);
    article.append(avatar, body);
    return article;
  };

  const createAvatarElement = (message) => {
    const avatarUrl = message.avatarUrl ?? message.author?.avatarUrl;

    if (avatarUrl) {
      const image = document.createElement('img');

      image.className = 'chat-avatar';
      image.src = avatarUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      return image;
    }

    const fallback = document.createElement('div');

    fallback.className = 'chat-avatar chat-avatar-fallback';
    fallback.textContent = (message.author?.name ?? '?').slice(0, 1).toUpperCase();
    return fallback;
  };

  const createBadgeElements = (badges = []) =>
    badges.map((badge) => {
      if (badge.imageUrl) {
        const image = document.createElement('img');

        image.className = 'author-badge';
        image.src = badge.imageUrl;
        image.alt = badge.label;
        image.title = badge.label;
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        return image;
      }

      const label = document.createElement('span');

      label.className = 'author-badge author-badge-text';
      label.textContent = badge.label;
      return label;
    });

  const createFragmentElements = (message) => {
    const fragments = Array.isArray(message.fragments) ? message.fragments : [];

    if (fragments.length === 0) {
      return [document.createTextNode(message.text ?? '')];
    }

    return fragments.map((fragment) => {
      if (fragment.type === 'emote' && fragment.imageUrl) {
        const image = document.createElement('img');

        image.className = 'chat-emote';
        image.src = fragment.imageUrl;
        image.alt = fragment.text;
        image.title = fragment.text;
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        return image;
      }

      return document.createTextNode(fragment.text ?? '');
    });
  };

  const createEmptyChatElement = () => {
    const empty = document.createElement('div');

    empty.className = 'empty-state';
    empty.dataset.chatEmpty = '';
    empty.textContent = 'Waiting for new public chat messages from the realtime gateway.';
    return empty;
  };

  const isChatNearBottom = () =>
    elements.chatList.scrollHeight - elements.chatList.scrollTop - elements.chatList.clientHeight < 48;

  const formatNumber = (value) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);

  const getViewerDisplay = (viewer) => {
    if (!viewer) {
      return { state: 'unavailable', count: '-', label: 'viewers unavailable' };
    }

    if (viewer.state === 'available') {
      const count = viewer.count ?? 0;

      return {
        state: count === 0 ? 'offline' : 'available',
        count: formatNumber(count),
        label: count === 0 ? 'offline or zero viewers' : 'watching now',
      };
    }

    if (viewer.state === 'disabled') {
      return { state: 'disabled', count: '-', label: 'viewers disabled' };
    }

    return { state: 'unavailable', count: '-', label: 'viewers unavailable' };
  };

  const formatViewerUpdated = (viewers) => {
    const latest = (viewers?.sources ?? [])
      .map((viewer) => new Date(viewer.updatedAt).valueOf())
      .filter((timestamp) => Number.isFinite(timestamp))
      .sort((left, right) => right - left)[0];

    return latest ? `Last viewer update: ${formatDateTime(new Date(latest).toISOString())}` : 'No viewer update yet.';
  };

  const formatViewerSourceUpdated = (viewer) =>
    viewer?.updatedAt ? `Updated ${formatDateTime(viewer.updatedAt)}` : 'No viewer update yet.';

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);

    return Number.isNaN(date.valueOf())
      ? ''
      : formatClock(date);
  };

  const formatDateTime = (timestamp) => {
    const date = new Date(timestamp);

    return Number.isNaN(date.valueOf()) ? 'unknown time' : formatClock(date);
  };

  const formatClock = (date) =>
    new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);

  void start();
})();
