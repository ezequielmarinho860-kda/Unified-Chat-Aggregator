const { contextBridge, ipcRenderer } = require('electron');

const invokeChatSend = async (payload) => {
  const response = await ipcRenderer.invoke('chat:send', payload);

  if (response?.ok === false) {
    const error = new Error(response.error || 'Send failed.');

    if (response.code) {
      error.code = response.code;
    }

    throw error;
  }

  return response;
};

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
  sendMessage: invokeChatSend,
  connectTwitch: () => ipcRenderer.invoke('twitch:connect'),
  disconnectTwitch: () => ipcRenderer.invoke('twitch:disconnect'),
  clearTwitchSession: () => ipcRenderer.invoke('twitch:clear-auth-session'),
  connectKick: () => ipcRenderer.invoke('kick:connect'),
  disconnectKick: () => ipcRenderer.invoke('kick:disconnect'),
  clearKickSession: () => ipcRenderer.invoke('kick:clear-auth-session'),
  connectX: () => ipcRenderer.invoke('x:connect'),
  disconnectX: () => ipcRenderer.invoke('x:disconnect'),
  getXAuthStatus: () => ipcRenderer.invoke('x:auth-status'),
});
