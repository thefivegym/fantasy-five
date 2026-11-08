// Browser-side signup. Builds the POST and accepts a success response only when the server
// confirms a new handle-only save. Does not store anything in the browser.
import { checkInstagram } from './instagram.mjs';
import { isSavedSignup, UNCONFIGURED, NOT_CONFIRMED, UNAVAILABLE } from './direct-signup.mjs';

export { checkInstagram, UNCONFIGURED, NOT_CONFIRMED };
export const NETWORK = "Sign-up couldn't be reached. Nothing was saved.";

export function prepareSignup(apiUrl, raw) {
  const base = String(apiUrl ?? '').trim();
  if (!base) return { ok: false, kind: 'unconfigured', message: UNCONFIGURED };
  let url;
  try { url = new URL(base); } catch { return { ok: false, kind: 'unconfigured', message: UNCONFIGURED }; }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return { ok: false, kind: 'unconfigured', message: UNCONFIGURED };
  const c = checkInstagram(raw);
  if (!c.ok) return { ok: false, kind: 'invalid', message: c.error };
  return { ok: true, url: url.toString(), handle: c.handle, body: { instagram: c.handle } };
}

function safeError(body, fallback) {
  const e = body && typeof body.error === 'string' ? body.error.trim() : '';
  if (!e || e.length > 400 || body?.saved === true || /token|bearer|ghp_|github_pat_/i.test(e)) return fallback;
  return e;
}

/** Turn a response into the text the page may show. Success is the server's own sentence. */
export function interpretSignup(status, body, handle) {
  if (isSavedSignup(body, handle) && Number(status) === 201) return { ok: true, kind: 'saved', message: body.message };
  if (Number(status) === 201) return { ok: false, kind: 'error', message: NOT_CONFIRMED };
  if (Number(status) === 409) return { ok: false, kind: 'duplicate', message: safeError(body, "That Instagram handle is already signed up. Nothing was changed.") };
  if (Number(status) === 429) return { ok: false, kind: 'rate', message: safeError(body, 'Too many sign-up attempts. Nothing was saved. Wait and try again.') };
  if (Number(status) === 400) return { ok: false, kind: 'invalid', message: safeError(body, 'That handle was not accepted. Nothing was saved.') };
  return { ok: false, kind: 'error', message: safeError(body, UNAVAILABLE) };
}
