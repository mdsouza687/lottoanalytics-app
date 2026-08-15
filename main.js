const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// Duas (ou mais) janelas do .exe abertas ao mesmo tempo (ex.: testar
// contas diferentes em paralelo) tentavam abrir o MESMO IndexedDB local
// (mesma pasta userData) — o backend de armazenamento do Electron só
// aceita um processo por vez escrevendo ali, então qualquer janela além
// da primeira falhava ao inicializar o banco e toda sincronização de
// loteria caía em "DB não inicializado" na hora. requestSingleInstanceLock()
// detecta que não é a primeira janela; em vez de bloqueá-la (padrão
// usual), deixamos ela seguir com uma pasta de dados própria, isolada.
//
// Fase 81 usava um sufixo FIXO ("-instancia2") pra essa pasta alternativa
// — funcionava com exatamente 2 janelas, mas uma 3ª (ou mais) janela
// simultânea caía de volta no mesmo problema: a 3ª também recebe
// gotLock=false e tentaria abrir essa MESMA pasta "-instancia2" que a 2ª
// já está usando, reproduzindo o conflito original um nível abaixo. Usar
// o PID do processo (único por lançamento, garantido pelo próprio SO) em
// vez de um sufixo fixo elimina esse limite — não importa quantas janelas
// estejam abertas ao mesmo tempo, cada uma além da primeira ganha uma
// pasta só sua. O efeito colateral aceito: essas janelas "extras" sempre
// nascem sem login/cache salvo (nunca reaproveitam a pasta de uma sessão
// anterior), precisando logar e sincronizar de novo a cada abertura.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.setPath('userData', app.getPath('userData') + '-instancia-' + process.pid);
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
      webSecurity: true,
      // Fase 108b: única ponte main→renderer do app, só pra mandar o
      // progresso do auto-update pra tela (ver preload.js) — sem isso o
      // renderer não tem como saber que uma atualização foi encontrada/
      // baixada, e a pessoa só via a tela nua do instalador NSIS sem
      // contexto nenhum (nem versão, nem confirmação de que terminou).
      preload: path.join(__dirname, 'preload.js')
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
  var _jaRodouAoCarregar = false;
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(1.2);
    // Só na primeira carga da janela — evita re-disparar o toast "Atualizado
    // para vX" e re-registrar os listeners do autoUpdater se a página for
    // recarregada por algum motivo (não deveria, mas por garantia).
    if (_jaRodouAoCarregar) return;
    _jaRodouAoCarregar = true;
    avisarSeAcabouDeAtualizar(win);
    configurarAutoUpdate(win);
  });

  return win;
}

// Fase 108b: depois que o instalador do auto-update roda e o app reabre
// na versão nova, não existia NENHUMA confirmação disso — a pessoa via a
// tela nua do NSIS (sem dizer pra qual versão) e depois nada, tinha que
// adivinhar se funcionou. Grava a última versão vista em
// userData/last-version.txt; se a versão atual for diferente da gravada
// (ou não existir arquivo — primeira vez), manda um toast "🎉 Atualizado"
// pro renderer e atualiza o arquivo. Roda em toda instalação (não só via
// auto-update), o que é o comportamento certo: também confirma quando a
// pessoa reinstala manualmente (como aconteceu no teste desta fase).
function avisarSeAcabouDeAtualizar(win) {
  if (!app.isPackaged) return;
  var arq = path.join(app.getPath('userData'), 'last-version.txt');
  var versaoAtual = app.getVersion();
  var versaoAnterior = null;
  try { versaoAnterior = fs.readFileSync(arq, 'utf8').trim(); } catch (e) { /* primeira execução, sem arquivo ainda */ }
  if (versaoAnterior && versaoAnterior !== versaoAtual) {
    win.webContents.send('auto-update-event', { type: 'updated', version: versaoAtual });
    _logAutoUpdate('versão mudou de ' + versaoAnterior + ' para ' + versaoAtual + ' — avisando o renderer');
  }
  try { fs.writeFileSync(arq, versaoAtual); } catch (e) { /* não crítico */ }
}

// Auto-update via GitHub Releases (repo público mdsouza687/lottoanalytics-app
// — o publish do electron-builder sobe o instalador + latest.yml pra lá).
// Baixa em segundo plano; a instalação roda quando o usuário fecha e
// reabre o app (não interrompe quem está usando). Só roda em build
// empacotado — em dev (`npm start`) o autoUpdater nem tenta, senão dá
// erro "not packed".
//
// Fase 108b: a v3.8.4 não gerou nenhum feedback claro em quem já tinha a
// 3.8.3 — o checkForUpdatesAndNotify() original só mostra uma notificação
// nativa do SO (fácil de perder/não aparecer dependendo de configuração
// do Windows) e não loga nada em lugar nenhum por padrão (autoUpdater.
// logger fica null a menos que a gente configure), então não dava pra
// saber SE ele sequer tentou checar. Duas mudanças:
// 1) cada evento do ciclo grava uma linha em userData/autoupdate.log
//    (arquivo de texto simples, sem dependência nova) — dá pra ler direto
//    do disco da máquina onde o app roda, sem precisar de DevTools (que
//    nem tá exposto no app empacotado).
// 2) troca a notificação nativa do SO por toast() DENTRO do próprio app
//    (via preload.js/IPC — ver window.lottoUpdater no index.html), com a
//    versão explícita em cada mensagem — resolve a reclamação de "não
//    mostra pra qual versão, não indica que terminou".
function _logAutoUpdate(linha) {
  try {
    var arq = path.join(app.getPath('userData'), 'autoupdate.log');
    fs.appendFileSync(arq, '[' + new Date().toISOString() + '] ' + linha + '\n');
  } catch (e) { /* nunca deixa o log quebrar o app */ }
}
function configurarAutoUpdate(win) {
  if (!app.isPackaged) return;
  function enviar(payload) { win.webContents.send('auto-update-event', payload); }
  _logAutoUpdate('boot: versão instalada = ' + app.getVersion());
  autoUpdater.on('checking-for-update', function () {
    _logAutoUpdate('checking-for-update');
  });
  autoUpdater.on('update-available', function (info) {
    _logAutoUpdate('update-available: ' + info.version);
    enviar({ type: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', function (info) {
    _logAutoUpdate('update-not-available (atual já é a mais nova: ' + info.version + ')');
  });
  autoUpdater.on('download-progress', function (p) {
    _logAutoUpdate('download-progress: ' + Math.round(p.percent) + '%');
  });
  autoUpdater.on('update-downloaded', function (info) {
    _logAutoUpdate('update-downloaded: ' + info.version + ' — instala ao reiniciar');
    enviar({ type: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', function (err) {
    var msg = err && err.message ? err.message : String(err);
    _logAutoUpdate('ERROR: ' + (err && err.stack ? err.stack : err));
    enviar({ type: 'error', message: msg });
  });
  autoUpdater.checkForUpdates().catch(function (e) {
    _logAutoUpdate('ERROR (catch da checkForUpdates): ' + e.message);
    enviar({ type: 'error', message: e.message });
  });
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
