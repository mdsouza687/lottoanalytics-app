const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

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
    autoHideMenuBar: true
  });

  win.loadFile('index.html');

  // Remove o menu padrão do Electron (File/Edit/View/...) para uma
  // experiência mais limpa de aplicativo desktop.
  win.setMenuBarVisibility(false);

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
