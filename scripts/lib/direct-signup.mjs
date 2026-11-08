// Decide a handle-only signup. Pure: no disk, no network, no token.
// A saved player id is the normalized Instagram handle. It is not the repo owner's GitHub login,
// and this function never returns an update of someone already on file.
import { checkInstagram } from './instagram.mjs';
import { REPO_OWNER } from './config.mjs';

export const DUPLICATE_HANDLE = "That Instagram handle is already signed up. This form can't change an existing registration. Nothing was changed.";
export const DUPLICATE_LOGIN = "That player name is already registered. This form can't change an existing registration. Nothing was changed.";
export const RATE_LIMIT = 'Too many sign-up attempts. Nothing was saved. Wait and try again.';
export const UNAVAILABLE = "Sign-up can't be saved right now. Nothing was saved.";
export const UNCONFIGURED = "Sign-up can't be saved yet. Nothing was saved.";
export const NOT_CONFIRMED = 'The response did not confirm a saved signup. Treat it as not saved.';
export const BAD_BODY = 'Send only the Instagram handle. No email, password, or player name. Nothing was saved.';
export const NO_REMINDERS = 'Weekly reminders are GitHub mentions. A handle-only signup cannot turn them on, and no email is sent. Nothing was saved.';

export function savedMessage(record) {
  return [
    `Saved. Player name: ${record.login}. Instagram: @${record.instagram}.`,
    'This does not verify that you own that account.',
    'The handle is public on the leaderboard once the site refreshes, and it is how weekly winners are contacted.',
    'No email or password was collected.',
    'Weekly reminders are GitHub mentions; this signup has no GitHub account, so no reminder and no email are sent.',
  ].join(' ');
}

export function isSavedSignup(body, handle) {
  return !!body && body.ok === true && body.saved === true && body.verified === false
    && body.record?.instagram === handle && body.record?.login === handle
    && body.record?.auth === 'instagram' && body.record?.reminders === false
    && typeof body.message === 'string' && body.message.includes('does not verify')
    && !/ownership verified|email sent|github email/i.test(body.message);
}

function fail(status, error) {
  return { ok: false, status, body: { ok: false, saved: false, verified: false, error } };
}

/** { ok, status, record?, body } — body is the JSON the browser is allowed to see. */
export function decideDirectSignup({ instagram, players = [], now, owner = REPO_OWNER } = {}) {
  if (typeof instagram !== 'string') return fail(400, 'Instagram handle is required. Nothing was saved.');
  const ig = checkInstagram(instagram);
  if (!ig.ok) return fail(400, `${ig.error} Nothing was saved.`);
  const handle = ig.handle;
  const ownerId = String(owner || '').toLowerCase();
  if (ownerId && handle === ownerId) return fail(409, DUPLICATE_LOGIN);
  const list = Array.isArray(players) ? players : [];
  if (list.some(p => String(p?.instagram || '').toLowerCase() === handle)) return fail(409, DUPLICATE_HANDLE);
  if (list.some(p => String(p?.login || '').toLowerCase() === handle)) return fail(409, DUPLICATE_LOGIN);
  const joined = typeof now === 'string' ? now : new Date(now ?? Date.now()).toISOString();
  const record = { login: handle, instagram: handle, joined_at: joined, reminders: false, auth: 'instagram' };
  return { ok: true, status: 201, record, body: { ok: true, saved: true, verified: false, record, message: savedMessage(record) } };
}

const RECORD_KEYS = 'auth,instagram,joined_at,login,reminders';

/** Refuse any record the committer should not write. Throws {code}. */
export function assertNewHandleRecord(record, owner = REPO_OWNER) {
  const keys = Object.keys(record || {}).sort().join(',');
  const bad = (code = 'bad-record') => { const err = new Error(code); err.code = code; throw err; };
  if (keys !== RECORD_KEYS) bad();
  if (record.auth !== 'instagram' || record.reminders !== false) bad();
  if (typeof record.login !== 'string' || record.login !== record.instagram) bad();
  if (record.login === String(owner || '').toLowerCase()) bad();
  if (typeof record.joined_at !== 'string' || Number.isNaN(Date.parse(record.joined_at))) bad();
  playerFilePath(record.login);
  return record;
}

/** Repo-relative path for a new handle file. Rejects anything that is not one path segment. */
export function playerFilePath(login) {
  if (typeof login !== 'string' || !/^[a-z0-9._]{1,30}$/.test(login) || login.startsWith('.') || login.endsWith('.') || login.includes('..') || !/[a-z0-9]/.test(login)) {
    const err = new Error('unsafe player id');
    err.code = 'bad-record';
    throw err;
  }
  return `data/players/${login}.json`;
}
