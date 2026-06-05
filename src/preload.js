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
  onConfigChanged: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);

    ipcRenderer.on('chat:config', listener);

    return () => {
      ipcRenderer.off('chat:config', listener);
    };
  },
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  restartConnectors: () => ipcRenderer.invoke('connectors:restart'),
  sendMessage: (payload) => ipcRenderer.invoke('chat:send', payload),
  connectTwitch: () => ipcRenderer.invoke('twitch:connect'),
  disconnectTwitch: () => ipcRenderer.invoke('twitch:disconnect'),
  resolveKickChatroom: (channel) => ipcRenderer.invoke('kick:resolve-chatroom', channel),
});
