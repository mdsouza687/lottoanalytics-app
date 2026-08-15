// Ponte segura main→renderer só pros eventos de auto-update (Fase 108b) —
// contextIsolation:true bloqueia o renderer de falar com o processo main
// direto, então esse é o único jeito de mandar o progresso do update pra
// tela sem desligar o isolamento inteiro do app.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lottoUpdater', {
  onEvent: function (callback) {
    ipcRenderer.on('auto-update-event', function (_event, payload) { callback(payload); });
  }
});
