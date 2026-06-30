# LottoAnalytics

> Análise estatística de loterias brasileiras e americanas — app desktop para Windows e Mac.

![Versão](https://img.shields.io/badge/versão-1.0.0-blue)
![Plataforma](https://img.shields.io/badge/plataforma-Windows%20%7C%20Mac-lightgrey)
![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron)

## O que é

LottoAnalytics empacota uma análise estatística completa de loterias como um app de desktop, usando Electron. O instalador cria atalho automaticamente na Área de Trabalho.

## Pré-requisitos

- [Node.js](https://nodejs.org) versão 18 ou mais recente (baixe a versão LTS)

Confirme a instalação:

```bash
node --version
# deve aparecer v20.x.x ou v22.x.x
```

## Como gerar o instalador

1. Clone ou extraia esta pasta em qualquer lugar do computador
2. Abra o PowerShell (Windows) ou Terminal (Mac) dentro da pasta
3. Instale as dependências:

```bash
npm install
```

4. Gere o instalador:

```bash
# Windows
npm run dist:win

# Mac
npm run dist:mac
```

5. O instalador estará na pasta `dist/`:
   - Windows: `dist\LottoAnalytics Setup 1.0.0.exe`
   - Mac: `dist/LottoAnalytics-1.0.0.dmg`

## Como atualizar

Substitua o arquivo `index.html` pelo mais recente e rode novamente o comando `npm run dist:win` (ou `dist:mac`).

## Resolução de problemas

| Erro | Solução |
|------|---------|
| `npm: comando não encontrado` | Reinstale o Node.js e reabra o terminal |
| Windows Defender avisa sobre o app | Clique em "Mais informações" → "Executar assim mesmo" |
| Mac: "desenvolvedor não identificado" | Clique com botão direito → Abrir → confirme "Abrir mesmo assim" |

## Autor

Mario — [mdsouza687](https://github.com/mdsouza687)
