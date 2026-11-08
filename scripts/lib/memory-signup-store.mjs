// In-memory player list for tests and the local dev server. Never touches data/players or GitHub.
import { REPO_OWNER } from './config.mjs';

export function memoryPlayerStore(seed = [], owner = REPO_OWNER) {
  const players = seed.map(p => ({ ...p }));
  const commits = [];
  return {
    players,
    commits,
    async list() {
      return players.map(p => ({ login: p.login, instagram: p.instagram, auth: p.auth }));
    },
    async commit(record) {
      const login = String(record?.login || '').toLowerCase();
      if (login === String(owner).toLowerCase() || record?.reminders !== false || record?.auth !== 'instagram' || record?.login !== record?.instagram) {
        return { ok: false, code: 'unavailable' };
      }
      if (players.some(p => String(p.login).toLowerCase() === login || String(p.instagram || '').toLowerCase() === login)) {
        return { ok: false, code: 'duplicate' };
      }
      players.push({ ...record });
      commits.push({ ...record });
      return { ok: true, commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
    },
  };
}
