// Fixed-window counters. The HTTP handler fails closed when the store is missing or throws.
import { SIGNUP_LIMITS } from './config.mjs';

export function rateKeys(ip, nowMs, windowSec = SIGNUP_LIMITS.windowSec) {
  const bucket = Math.floor(Number(nowMs) / 1000 / windowSec);
  const safeIp = String(ip || 'unknown').replace(/[^\w.:-]/g, '').slice(0, 80) || 'unknown';
  return { ip: `ff-signup:ip:${safeIp}:${bucket}`, global: `ff-signup:global:${bucket}`, retryAfter: windowSec - (Math.floor(Number(nowMs) / 1000) % windowSec) };
}

export function memoryRateStore() {
  const m = new Map();
  return {
    async incr(key) {
      const n = (m.get(key) || 0) + 1;
      m.set(key, n);
      return n;
    },
  };
}

/** Cloudflare KV binding. expirationTtl must be at least 60 seconds. */
export function kvRateStore(kv) {
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') return null;
  return {
    async incr(key, ttlSec) {
      const cur = Number(await kv.get(key)) || 0;
      const n = cur + 1;
      await kv.put(key, String(n), { expirationTtl: Math.max(60, Number(ttlSec) || 60) });
      return n;
    },
  };
}
