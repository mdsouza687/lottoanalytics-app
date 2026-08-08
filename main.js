const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

// Duas janelas do .exe abertas ao mesmo tempo (ex.: testar duas contas em
// paralelo) tentavam abrir o MESMO IndexedDB local (mesma pasta userData) —
// o backend de armazenamento do Electron só aceita um processo por vez
// escrevendo ali, então a segunda janela falhava ao inicializar o banco e
// toda sincronização de loteria caía em "DB não inicializado" na hora,
// mesmo com login/conta diferente. requestSingleInstanceLock() detecta essa
// segunda instância; em vez de bloqueá-la (padrão usual), deixamos ela
// seguir com uma pasta de dados própria, isolada da primeira.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.setPath('userData', app.getPath('userData') + '-instancia2');
}

// Desde as versões recentes do Electron, window.open() é BLOQUEADO por
// padrão (sem aviso, sem erro no console) a menos que o app trate
// explicitamente via setWindowOpenHandler — foi isso que quebrou o botão
// de convidar participante (abre o WhatsApp): window.open('','_blank')
// virava um popup negado silenciosamente. Links de verdade (http/https)
// vão pro navegador padrão do sistema via shell.openExternal — é o
// comportamento esperado pra wa.me, não abrir dentro do próprio app.
// window.open('','_blank') com URL vazia continua sendo PERMITIDO — é o
// padrão usado tanto pelo convite (window.open('', ...) seguido de
// location.href=) quanto pela impressão (document.write no popup), que
// dependem de ganhar uma janela real do Electron primeiro.
function isHttpUrl(url) { return !!url && /^https?:\/\//i.test(url); }
function attachExternalLinkHandling(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  win.webContents.on('did-create-window', (childWindow) => {
    attachExternalLinkHandling(childWindow);
    // Cobre o padrão window.open('','_blank') + depois location.href=URL
    // (usado pelo convite de WhatsApp) — a navegação do popup em branco
    // pra uma URL real também precisa ser desviada pro navegador padrão.
    childWindow.webContents.on('will-navigate', (event, url) => {
      if (isHttpUrl(url)) { event.preventDefault(); shell.openExternal(url); childWindow.close(); }
    });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    icon: path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    title: 'LottoAnalytics',
    backgroundColor: '#0a0e14',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Necessário para chamadas fetch() a APIs externas (resultados das
      // loterias) funcionarem normalmente, igual a um navegador comum.
      webSecurity: true
    },
    autoHideMenuBar: true,
    show: false
  });

  win.loadFile('index.html');

  // Remove o menu padrão do Electron (File/Edit/View/...) para uma
  // experiência mais limpa de aplicativo desktop.
  win.setMenuBarVisibility(false);

  attachExternalLinkHandling(win);

  // A janela nascia com o tamanho fixo (1400x900) acima, sem maximizar e
  // sem zoom nenhum — bem menor/mais difícil de ler que uma aba de
  // navegador maximizada no mesmo monitor. Só afeta o app instalado (o
  // site continua usando o zoom que o próprio navegador do usuário já
  // controla). Maximiza só depois de pronta pra mostrar (evita o flash de
  // janela pequena antes de crescer).
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(1.2);
  });

  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
