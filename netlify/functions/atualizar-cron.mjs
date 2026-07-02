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
// Powerball e Mega Millions NÃO estão aqui: o cliente já busca os dois
// diretamente (boot + verificação a cada 30min + botão Atualizar) usando uma
// lógica própria (jackpot, premiações, cálculo de concurso pela data) grande
// demais para duplicar com segurança neste primeiro passo.

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
  if (!r.ok) return null;
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

  // 2. Busca o mais recente e confere se já passou de fato
  const latest = await fetchJson(`${CAIXA_BASE}/${apiKey}`).catch(() => null);
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

  console.log("atualizar-cron:", JSON.stringify(relatorio));
  return new Response(JSON.stringify({ timestamp: new Date().toISOString(), relatorio }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config = {
  schedule: "0 */3 * * *",
};
