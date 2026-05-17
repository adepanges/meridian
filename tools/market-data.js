import { log } from "../logger.js";

const DEXSCREENER_BASE = "https://api.dexscreener.com/latest/dex/pairs/solana";
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5_000;

/** @type {Map<string, {data: object, ts: number}>} */
const _cache = new Map();

/**
 * Fetch 5m/1h market data for a Solana pair from DexScreener.
 * Results are cached for 60 seconds per pair address.
 * Returns null on any failure — never throws.
 *
 * @param {string} pairAddress  Meteora pool address (= DexScreener pairAddress for Solana)
 * @returns {Promise<{
 *   volume_5m: number|null, volume_1h: number|null,
 *   price_change_5m: number|null, price_change_1h: number|null,
 *   txn_buys_5m: number|null, txn_sells_5m: number|null,
 *   liquidity_usd: number|null, fetched_at: string
 * }|null>}
 */
export async function fetchPoolMarketData(pairAddress) {
  if (!pairAddress) return null;

  const cached = _cache.get(pairAddress);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${DEXSCREENER_BASE}/${pairAddress}`, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      log("market_data", `DexScreener HTTP ${res.status} for ${pairAddress.slice(0, 8)}`);
      return null;
    }

    const json = await res.json();
    // DexScreener returns { pairs: [...] } for /pairs/solana/:address
    const pair = Array.isArray(json?.pairs) ? json.pairs[0] : (json?.pair ?? null);
    if (!pair) {
      log("market_data", `DexScreener: pair not found for ${pairAddress.slice(0, 8)}`);
      return null;
    }

    const data = {
      volume_5m:       pair.volume?.m5      ?? null,
      volume_1h:       pair.volume?.h1      ?? null,
      price_change_5m: pair.priceChange?.m5 ?? null,
      price_change_1h: pair.priceChange?.h1 ?? null,
      txn_buys_5m:     pair.txns?.m5?.buys  ?? null,
      txn_sells_5m:    pair.txns?.m5?.sells ?? null,
      liquidity_usd:   pair.liquidity?.usd  ?? null,
      fetched_at:      new Date().toISOString(),
    };

    _cache.set(pairAddress, { data, ts: Date.now() });
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      log("market_data", `DexScreener timeout for ${pairAddress.slice(0, 8)}`);
    } else {
      log("market_data", `DexScreener fetch failed for ${pairAddress.slice(0, 8)}: ${err.message}`);
    }
    return null;
  }
}

/** Clear the in-process cache (useful for testing). */
export function clearMarketDataCache() {
  _cache.clear();
}
