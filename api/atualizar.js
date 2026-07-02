// Vercel Serverless Function — região gru1 (São Paulo)
// Busca resultados da Caixa (IP brasileiro) e salva no Supabase

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CAIXA_BASE   = "https://servicebus2.caixa.gov.br/portaldeloterias/api";

const LOTERIAS = [
  { api: "megasena",       key: "megasena"       },
  { api: "lotofacil",      key: "lotofacil"      },
  { api: "quina",          key: "quina"           },
  { api: "lotomania",      key: "lotomania"       },
  { api: "timemania",      key: "timemania"       },
  { api: "duplasena",      key: "duplasena"       },
  { api: "diadesorte",     key: "diasorte"        },
  { api: "supersete",      key: "supersete"       },
  { api: "maismilionaria", key: "maismilionaria"  },
];

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
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
  // 1. Tenta próximo concurso diretamente (IP BR da Vercel gru1)
  if (concursoAtual > 0) {
    const d = await fetchJson(`${CAIXA_BASE}/${apiKey}/${concursoAtual + 1}`).catch(() => null);
    if (d?.numero || d?.concurso) return d;
  }

  // 2. Busca latest e verifica se tem concurso mais novo — sem engolir o erro
  // aqui: se a Caixa recusar a conexão, o chamador precisa saber a causa
  // exata (ex.: "HTTP 403"), não só "sem resposta".
  const latest = await fetchJson(`${CAIXA_BASE}/${apiKey}`);
  if (!latest) return null;

  const proxNum  = latest.numeroConcursoProximo || latest.proximoConcurso;
  const proxData = latest.dataProximoConcurso;

  if (proxNum && dataPassou(proxData)) {
    // Tenta buscar o próximo concurso que já ocorreu
    for (let i = 0; i < 5; i++) {
      const alvo = proxNum + i;
      const d = await fetchJson(`${CAIXA_BASE}/${apiKey}/${alvo}`).catch(() => null);
      if (!d?.numero && !d?.concurso) break;
      const proxNext = d.numeroConcursoProximo || d.proximoConcurso;
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
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) return {};
  const rows = await r.json();
  const map = {};
  for (const row of rows) map[row.loteria] = parseInt(row.concurso || "0") || 0;
  return map;
}

async function upsert(key, concurso, dados) {
  // Remove null bytes que o PostgreSQL não aceita
  const body = JSON.stringify({
    loteria: key,
    concurso: String(concurso),
    dados,
    atualizado_em: new Date().toISOString(),
  }).replace(/\\u0000/g, "");

  const r = await fetch(`${SUPABASE_URL}/rest/v1/resultados?on_conflict=loteria`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates",
    },
    body,
  });
  return r.ok;
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    res.status(500).json({ erro: "SUPABASE_URL/SUPABASE_KEY não configurados no projeto Vercel" });
    return;
  }
  // Protege o endpoint contra chamadas públicas aleatórias (ele só existe
  // pra ser chamado pelo cron do Netlify, que roda a cada 3h) — segredo
  // simples via query string, não uma autenticação forte.
  const CRON_SECRET = process.env.CRON_SECRET;
  if (CRON_SECRET && req.query?.secret !== CRON_SECRET) {
    res.status(401).json({ erro: "não autorizado" });
    return;
  }

  // Aceita GET (cron do Vercel) ou POST (chamada manual)
  const relatorio = {};

  const concursosAtuais = await getSupabaseData();

  await Promise.all(LOTERIAS.map(async ({ api, key }) => {
    try {
      const atual = concursosAtuais[key] || 0;
      const dados = await buscarResultado(api, atual);
      if (!dados) { relatorio[key] = "sem resposta"; return; }

      const numero = dados.numero || dados.concurso;
      const data   = dados.dataApuracao || dados.data || "";
      const ok     = await upsert(key, numero, dados);
      relatorio[key] = `${ok ? "ok" : "erro"} - ${numero} (${data})`;
    } catch (e) {
      relatorio[key] = `erro: ${e.message}`;
    }
  }));

  res.status(200).json({ timestamp: new Date().toISOString(), relatorio });
}
