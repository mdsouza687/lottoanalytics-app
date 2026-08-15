// Ponte segura main→renderer só pros eventos de auto-update (Fase 108b) —
// contextIsolation:true bloqueia o renderer de falar com o processo main
// direto, então esse é o único jeito de mandar o progresso do update pra
// tela sem desligar o isolamento inteiro do app.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lottoUpdater', {
  onEvent: function (callback) {
    ipcRenderer.on('auto-update-event', function (_event, payload) { callback(payload); });
  },
  // Chamado pelo botão "Instalar e Reiniciar" do banner (Fase 108c) —
  // main.js escuta esse canal e chama autoUpdater.quitAndInstall(), que
  // fecha o app, roda o instalador e reabre sozinho na versão nova.
  instalarAgora: function () {
    ipcRenderer.send('auto-update-instalar-agora');
  }
});
