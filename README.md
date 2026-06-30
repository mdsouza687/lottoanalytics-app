# LottoAnalytics — Gerar instalador (Windows / Mac)

Este projeto empacota o LottoAnalytics (o arquivo `index.html`) como um
aplicativo de desktop de verdade, usando Electron. O instalador final cria
atalho automaticamente na Área de Trabalho.

## Por que isso precisa ser rodado no seu computador

Para gerar o instalador, é preciso baixar o "motor" do Electron (~150MB),
hospedado nos servidores de release do GitHub. Esse download é bloqueado no
ambiente onde este projeto foi montado, então o último passo (baixar +
empacotar) precisa ser feito no seu computador, com internet normal.

## Pré-requisito

Instalar o Node.js (versão 18 ou mais recente): https://nodejs.org
(baixe a versão "LTS", clique em todos os "Próximo" — instalação padrão).

Para confirmar que instalou certo, abra o Terminal (Mac) ou PowerShell
(Windows) e digite:

```
node --version
```

Deve aparecer algo como `v20.x.x` ou `v22.x.x`.

## Como gerar o instalador

1. Extraia esta pasta `lottoanalytics-app` em qualquer lugar do computador
   (ex.: Área de Trabalho, Documentos).
2. Abra o Terminal (Mac) ou PowerShell (Windows) **dentro dessa pasta**:
   - Windows: abra a pasta no Explorador de Arquivos, clique na barra de
     endereço, digite `powershell` e aperte Enter.
   - Mac: clique com o botão direito na pasta → "Novo Terminal na Pasta"
     (ou abra o Terminal e digite `cd ` arrastando a pasta para dentro).
3. Rode estes dois comandos, um de cada vez:

```
npm install
```

(demora alguns minutos na primeira vez — está baixando tudo que falta)

**No Windows**, para gerar o instalador `.exe`:
```
npm run dist:win
```

**No Mac**, para gerar o instalador `.dmg`:
```
npm run dist:mac
```

4. Quando terminar, o instalador pronto estará na pasta `dist` que aparece
   dentro da pasta do projeto:
   - Windows: `dist\LottoAnalytics Setup 1.0.0.exe`
   - Mac: `dist/LottoAnalytics-1.0.0.dmg`

5. Rode esse instalador normalmente (duplo clique) — ele instala o programa
   e já cria o atalho na Área de Trabalho e no Menu Iniciar automaticamente.

## Se algo der errado

- **"npm: comando não encontrado"** → o Node.js não foi instalado
  corretamente, ou o terminal precisa ser reaberto depois de instalar.
- **Antivírus/Windows Defender avisa que o app não é reconhecido** → é
  normal para programas instalados fora da loja oficial; clique em
  "Mais informações" → "Executar assim mesmo". Isso acontece porque o app
  não tem uma assinatura digital paga (que custa por ano e não é necessária
  para uso pessoal).
- **No Mac, aviso de "desenvolvedor não identificado"** → clique com o botão
  direito no app → Abrir → confirme "Abrir mesmo assim". Necessário só na
  primeira vez.

## Atualizando o app depois

Quando o `index.html` for atualizado (novas correções), basta substituir o
arquivo `index.html` dentro desta pasta pelo mais recente e rodar de novo o
comando `npm run dist:win` (ou `dist:mac`) — gera um novo instalador com a
versão atualizada.
