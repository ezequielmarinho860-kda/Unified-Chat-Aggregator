const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatAggregator', {
  appName: 'Unified Chat Aggregator',
  onChatMessage: (callback) => {
    const listener = (_event, message) => callback(message);

    ipcRenderer.on('chat:message', listener);

    return () => {
      ipcRenderer.off('chat:message', listener);
    };
  },
  onConnectorStatus: (callback) => {
    const listener = (_event, status) => callback(status);

    ipcRenderer.on('chat:status', listener);

    return () => {
      ipcRenderer.off('chat:status', listener);
    };
  },
  onConnectorStatuses: (callback) => {
    const listener = (_event, statuses) => callback(statuses);

    ipcRenderer.on('chat:statuses', listener);

    return () => {
      ipcRenderer.off('chat:statuses', listener);
    };
  },
});
