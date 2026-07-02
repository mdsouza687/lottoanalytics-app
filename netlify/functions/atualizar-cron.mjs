// Netlify Scheduled Function — roda a cada 3 horas mesmo sem ninguém com o
// app aberto. Busca os resultados das 9 loterias da Caixa e grava no
// Supabase (tabela "resultados"), de onde o cliente lê primeiro (evita
// CORS e reduz dependência de fontes externas instáveis).
//
// Substitui o antigo api/atualizar.js (Vercel), que parou de rodar quando o
// deploy migrou para Netlify em 2026-07-01 — vercel.json não tem "crons" e o
// projeto não é mais publicado na Vercel, então aquela função nunca mais foi
// executada.
//
// Powerball e Mega Millions: os RESULTADOS (dezenas sorteadas) continuam só
// no cliente (boot + verificação a cada 30min + botão Atualizar), que já tem
// a lógica própria de premiações/cálculo de concurso pela data — grande
// demais para duplicar com segurança aqui.
//
// O JACKPOT (valor estimado do prêmio) é diferente: o cliente busca isso via
// scraping de HTML através de proxies CORS gratuitos e instáveis (rodando no
// navegador, sujeito a bloqueio de CORS pelos sites oficiais) — por isso
// ficava sempre desatualizado e precisava de atualização manual no código.
// Rodando aqui no servidor não existe CORS, então dá pra chamar a API oficial
// de cada loteria diretamente, sem proxy e sem regex de scraping frágil.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CAIXA_BASE = "https://servicebus2.caixa.gov.br/portaldeloterias/api";

const LOTERIAS = [
  { api: "megasena", key: "megasena" },
  { api: "lotofacil", key: "lotofacil" },
  { api: "quina", key: "quina" },
  { api: "lotomania", key: "lotomania" },
  { api: "timemania", key: "timemania" },
  { api: "duplasena", key: "duplasena" },
  { api: "diadesorte", key: "diasorte" },
  { api: "supersete", key: "supersete" },
  { api: "maismilionaria", key: "maismilionaria" },
];

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

function dataPassou(dataBR) {
  if (!dataBR) return false;
  const [d, m, y] = dataBR.split("/");
  if (!d || !m || !y) return false;
  const dt = new Date(`${y}-${m}-${d}T23:00:00-03:00`); // 23h Brasília
  return dt < new Date();
}

async function buscarResultado(apiKey, concursoAtual) {
  // 1. Tenta o próximo concurso diretamente
  if (concursoAtual > 0) {
    const d = await fetchJson(`${CAIXA_BASE}/${apiKey}/${concursoAtual + 1}`).catch(() => null);
    if (d?.numero || d?.concurso) return d;
  }

  // 2. Busca o mais recente e confere se já passou de fato — sem engolir o
  // erro aqui (diagnóstico): se a Caixa bloquear/recusar a conexão, o
  // chamador precisa saber a causa exata, não só "sem resposta".
  const latest = await fetchJson(`${CAIXA_BASE}/${apiKey}`);
  if (!latest) return null;

  const proxNum = latest.numeroConcursoProximo || latest.proximoConcurso;
  const proxData = latest.dataProximoConcurso;

  if (proxNum && dataPassou(proxData)) {
    for (let i = 0; i < 5; i++) {
      const alvo = proxNum + i;
      const d = await fetchJson(`${CAIXA_BASE}/${apiKey}/${alvo}`).catch(() => null);
      if (!d?.numero && !d?.concurso) break;
      const dataNext = d.dataProximoConcurso;
      latest._best = d;
      if (!dataPassou(dataNext)) break;
    }
    if (latest._best) return latest._best;
  }

  return latest;
}

function fmtUSD(n) {
  if (n == null || isNaN(n)) return null;
  const milhoes = n / 1e6;
  return `US$ ${milhoes.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Milhões`;
}

// As APIs "oficiais" (powerball.com/api/v1/estimates, megamillions.com
// utilservice.asmx) estão indisponíveis a partir daqui: a da Powerball
// devolve 301 direto pra home (endpoint descontinuado) e a da Mega Millions
// devolve 403 (bloqueio de bot). A Texas Lottery — membro oficial do MUSL,
// mesma fonte já usada como fallback no cliente — publica uma página HTML
// simples (sem JS) com os jackpots atuais das duas loterias na MESMA página
// ("latest results"), confirmado manualmente batendo com o valor oficial.
const TX_LOTTERY_URL = "https://www.texaslottery.com/export/sites/lottery/Games/Mega_Millions/index.html";

function extrairJackpotTexas(html, logoAlt) {
  const idx = html.indexOf(`alt="${logoAlt}`);
  if (idx < 0) return null;
  const chunk = html.slice(idx, idx + 500);
  const jpM = chunk.match(/<h1>\$([\d.,]+)\s*(Million|Billion)<\/h1>/i);
  if (!jpM) return null;
  const cashM = chunk.match(/Cash Value:\s*<strong>\$([\d.,]+)\s*(Million|Billion)<\/strong>/i);
  const toNum = (m) => (m ? parseFloat(m[1].replace(/,/g, "")) * (/billion/i.test(m[2]) ? 1e9 : 1e6) : null);
  const jackpotNum = toNum(jpM);
  const cashNum = toNum(cashM);
  if (!jackpotNum) return null;
  return { jackpot: fmtUSD(jackpotNum), cash: fmtUSD(cashNum), fonte: "texaslottery" };
}

async function buscarJackpotsTexasLottery() {
  const r = await fetch(TX_LOTTERY_URL, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) return {};
  const html = await r.text();
  return {
    powerball: extrairJackpotTexas(html, "Powerball logo"),
    megamillions: extrairJackpotTexas(html, "Mega Millions logo"),
  };
}

async function upsertJackpot(loteria, info) {
  const body = JSON.stringify({
    loteria,
    jackpot: info.jackpot,
    cash: info.cash,
    fonte: info.fonte,
    atualizado_em: new Date().toISOString(),
  });
  const r = await fetch(`${SUPABASE_URL}/rest/v1/us_jackpots?on_conflict=loteria`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body,
  });
  return r.ok;
}

async function getSupabaseData() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/resultados?select=loteria,concurso`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) return {};
  const rows = await r.json();
  const map = {};
  for (const row of rows) map[row.loteria] = parseInt(row.concurso || "0") || 0;
  return map;
}

async function upsert(key, concurso, dados) {
  const body = JSON.stringify({
    loteria: key,
    concurso: String(concurso),
    dados,
    atualizado_em: new Date().toISOString(),
  }).replace(/\\u0000/g, "");

  const r = await fetch(`${SUPABASE_URL}/rest/v1/resultados?on_conflict=loteria`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body,
  });
  return r.ok;
}

export default async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("SUPABASE_URL/SUPABASE_KEY não configurados nas variáveis de ambiente do Netlify");
    return new Response(JSON.stringify({ erro: "env vars ausentes" }), { status: 500 });
  }

  const relatorio = {};
  const concursosAtuais = await getSupabaseData();

  await Promise.all(
    LOTERIAS.map(async ({ api, key }) => {
      try {
        const atual = concursosAtuais[key] || 0;
        const dados = await buscarResultado(api, atual);
        if (!dados) {
          relatorio[key] = "sem resposta";
          return;
        }
        const numero = dados.numero || dados.concurso;
        const data = dados.dataApuracao || dados.data || "";
        const ok = await upsert(key, numero, dados);
        relatorio[key] = `${ok ? "ok" : "erro"} - ${numero} (${data})`;
      } catch (e) {
        relatorio[key] = `erro: ${e.message}`;
      }
    })
  );

  // Jackpots americanos — Texas Lottery (server-side, sem CORS/proxy).
  try {
    const jackpots = await buscarJackpotsTexasLottery();
    for (const key of ["powerball", "megamillions"]) {
      const info = jackpots[key];
      if (!info) { relatorio[`${key}_jackpot`] = "sem resposta"; continue; }
      const ok = await upsertJackpot(key, info);
      relatorio[`${key}_jackpot`] = `${ok ? "ok" : "erro"} - ${info.jackpot} / ${info.cash}`;
    }
  } catch (e) {
    relatorio.powerball_jackpot = relatorio.megamillions_jackpot = `erro: ${e.message}`;
  }

  console.log("atualizar-cron:", JSON.stringify(relatorio));
  return new Response(JSON.stringify({ timestamp: new Date().toISOString(), relatorio }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config = {
  schedule: "0 */3 * * *",
};
