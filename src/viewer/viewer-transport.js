(() => {
  const SNAPSHOT_PATH = '/api/v1/snapshot';
  const EVENTS_PATH = '/api/v1/events';

  const createDefaultViewerTransportClient = (options = {}) => {
    if (typeof window.__viewerTransportFactory === 'function') {
      return window.__viewerTransportFactory(options);
    }

    return createLocalViewerTransportClient(options);
  };

  const createLocalViewerTransportClient = ({
    fetchImpl = window.fetch.bind(window),
    locationImpl = window.location,
    WebSocketImpl = window.WebSocket,
  } = {}) => ({
    async loadSnapshot() {
      const response = await fetchImpl(SNAPSHOT_PATH, { cache: 'no-store' });

      if (!response.ok) {
        throw new Error(`Snapshot request failed with ${response.status}.`);
      }

      return response.json();
    },

    connectEvents({ onClose, onError, onEvent, onOpen } = {}) {
      const socket = new WebSocketImpl(createEventsUrl(locationImpl));

      socket.addEventListener('open', () => {
        onOpen?.();
      });
      socket.addEventListener('message', (event) => {
        onEvent?.(JSON.parse(event.data));
      });
      socket.addEventListener('close', () => {
        onClose?.();
      });
      socket.addEventListener('error', () => {
        onError?.();
      });

      return {
        close() {
          socket.close();
        },
      };
    },
  });

  const createMockViewerTransportClient = ({
    events = [],
    snapshot = {
      generatedAt: new Date().toISOString(),
      manifest: { sources: [], title: 'Mock Viewer Mode' },
      protocolVersion: '1',
      statuses: [],
      viewers: { sources: [], total: 0 },
    },
  } = {}) => ({
    async loadSnapshot() {
      return structuredClone(snapshot);
    },

    connectEvents({ onClose, onEvent, onOpen } = {}) {
      let closed = false;

      window.queueMicrotask(() => {
        if (closed) {
          return;
        }

        onOpen?.();

        for (const event of events) {
          if (closed) {
            return;
          }

          onEvent?.(structuredClone(event));
        }
      });

      return {
        close() {
          closed = true;
          onClose?.();
        },
      };
    },
  });

  const createEventsUrl = (locationImpl) => {
    const url = new URL(EVENTS_PATH, locationImpl.href);

    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url;
  };

  window.ViewerTransports = {
    createDefaultViewerTransportClient,
    createLocalViewerTransportClient,
    createMockViewerTransportClient,
  };
})();
