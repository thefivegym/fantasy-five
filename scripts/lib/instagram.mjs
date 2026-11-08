// Instagram handle normalizing + validation. Shared by signup.html (browser) and the sign-up workflow (Node).
// Accepts "@Name", "name", "instagram.com/name", "https://www.instagram.com/name/?hl=en". Returns lowercase.
export const IG_MAX = 30;
export const IG_RE = /^[a-z0-9._]{1,30}$/;

export function normalizeInstagram(raw) {
  let s = String(raw ?? '').trim();
  s = s.replace(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/+/i, '');  // URL prefix
  s = s.split(/[/?#]/)[0];                                                                // trailing path / query
  s = s.replace(/^@+/, '').toLowerCase();
  return s;
}
/** { ok, handle } or { ok:false, error } with the exact message the page and the workflow show. */
export function checkInstagram(raw) {
  const handle = normalizeInstagram(raw);
  if (!handle) return { ok: false, error: 'Instagram handle is required.' };
  if (handle.length > IG_MAX) return { ok: false, error: `Instagram handle is ${handle.length} characters. Max ${IG_MAX}.` };
  if (!IG_RE.test(handle)) return { ok: false, error: 'Instagram handles use only letters, digits, . and _.' };
  if (!/[a-z0-9]/.test(handle)) return { ok: false, error: 'Instagram handle must include a letter or digit.' };
  if (handle.startsWith('.') || handle.endsWith('.') || handle.includes('..')) return { ok: false, error: 'Instagram handles cannot start or end with a period, or use two periods in a row.' };
  return { ok: true, handle };
}
