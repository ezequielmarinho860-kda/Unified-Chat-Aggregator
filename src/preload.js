const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('chatAggregator', {
  appName: 'Unified Chat Aggregator',
});
