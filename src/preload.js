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
});
