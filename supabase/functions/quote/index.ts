// Bonsai · función «quote» para Supabase Edge Functions
//
// Busca activos (acciones, ETF, fondos, cripto) y devuelve su precio en tu moneda usando
// los datos públicos de Yahoo Finance. Sólo responde a usuarios con sesión iniciada en Bonsai.
//
//   GET /functions/v1/quote?q=IE00B4L5Y983              → { results: [{ symbol, name, exchange, type }] }
//   GET /functions/v1/quote?symbols=IWDA.AS,BTC-EUR&currency=EUR
//                                                       → { prices: { SYM: { price, currency, native, time } }, errors: {} }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const YAHOO = 'https://query2.finance.yahoo.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept': 'application/json',
};
const TYPES = ['EQUITY', 'ETF', 'MUTUALFUND', 'CRYPTOCURRENCY'];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Sólo usuarios con sesión (no basta la clave pública anon). */
function role(req: Request): string | null {
  try {
    const token = (req.headers.get('Authorization') || '').split(' ')[1];
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role ?? null;
  } catch {
    return null;
  }
}

async function getJSON(url: string) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`Yahoo respondió ${r.status}`);
  return r.json();
}

async function chart(symbol: string) {
  const j = await getJSON(`${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`);
  const m = j?.chart?.result?.[0]?.meta;
  if (!m || m.regularMarketPrice == null) throw new Error('sin precio');
  return { price: Number(m.regularMarketPrice), currency: String(m.currency || ''), time: Number(m.regularMarketTime || 0) };
}

// Algunas bolsas cotizan en céntimos (p. ej. Londres en peniques: GBp)
function normalize(price: number, cur: string): [number, string] {
  if (cur === 'GBp' || cur === 'GBX') return [price / 100, 'GBP'];
  if (cur === 'ZAc') return [price / 100, 'ZAR'];
  if (cur === 'ILA') return [price / 100, 'ILS'];
  return [price, cur.toUpperCase()];
}

const fxCache = new Map<string, number>();
async function fx(from: string, to: string) {
  if (!from || from === to) return 1;
  const key = from + to;
  if (!fxCache.has(key)) fxCache.set(key, (await chart(`${from}${to}=X`)).price);
  return fxCache.get(key)!;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (role(req) !== 'authenticated') return json({ error: 'Inicia sesión en Bonsai para usar las cotizaciones' }, 401);

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  const to = (url.searchParams.get('currency') || 'EUR').toUpperCase();

  try {
    if (q) {
      const j = await getJSON(`${YAHOO}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0`);
      const results = (j.quotes || [])
        .filter((x: any) => TYPES.includes(x.quoteType))
        .map((x: any) => ({
          symbol: x.symbol,
          name: x.longname || x.shortname || x.symbol,
          exchange: x.exchDisp || x.exchange || '',
          type: x.quoteType,
        }));
      return json({ results });
    }

    const symbols = (url.searchParams.get('symbols') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 25);
    const prices: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    for (const s of symbols) {
      try {
        const c = await chart(s);
        const [p, cur] = normalize(c.price, c.currency);
        prices[s] = { price: p * (await fx(cur, to)), currency: to, native: cur, time: c.time };
      } catch (e) {
        errors[s] = String((e as Error).message || e);
      }
    }
    return json({ prices, errors });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502);
  }
});
