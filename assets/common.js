// Shared helpers for every Fantasy Five page. Vanilla JS, no build step.
const FF = (() => {
  const REPO = 'thefivegym/fantasy-five';
  const EVENTS = ['vault', 'bars', 'beam', 'floor'];
  const EV_SHORT = { vault: 'VT', bars: 'UB', beam: 'BB', floor: 'FX' };
  const EV_NAME = { vault: 'Vault', bars: 'Bars', beam: 'Beam', floor: 'Floor' };
  const TZ = 'America/Chicago';
  const cache = {};
  const v = () => Math.floor(Date.now() / 60000); // 1-minute cache buster for data files

  async function json(path, fallback) {
    if (cache[path]) return cache[path];
    try {
      const r = await fetch(`${path}?v=${v()}`);
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return (cache[path] = await r.json());
    } catch (e) { if (fallback !== undefined) return fallback; throw e; }
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f3 = x => (x === null || x === undefined || x === '' ? '—' : Number(x).toFixed(3));
  const fTot = x => (x === null || x === undefined ? '—' : Number(x).toFixed(3));
  const q = new URLSearchParams(location.search);
  const fmtCT = (iso, opts = {}) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...opts }) + ' CT';
  const fmtDate = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  async function seasons() {
    const main = await json('data/season.json');
    const demo = main.demo ? await json(main.demo.file, null) : null;
    return { main, demo };
  }
  /** Pick the season to show: ?season=demo, else main. */
  async function season(id = q.get('season')) {
    const { main, demo } = await seasons();
    if (demo && id && String(id) === String(demo.season)) return demo;
    return main;
  }
  /** The open week (earliest lock in the future), else null. */
  function openWeek(s, now = Date.now()) {
    return [...s.weeks].sort((a, b) => new Date(a.lock) - new Date(b.lock)).find(w => new Date(w.lock).getTime() > now) || null;
  }
  function weekState(w, now = Date.now()) {
    if (now < new Date(w.lock).getTime()) return 'open';
    if (now <= new Date(`${w.end}T23:59:59-06:00`).getTime()) return 'locked';
    return 'done';
  }
  function countdown(ms) {
    if (ms <= 0) return 'Locked';
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
    return (d ? `${d}d ` : '') + `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }
  let cfg;
  /** Game constants, imported from the same module the workflows use (scripts/lib/config.mjs). */
  const config = async () => (cfg ||= await import(new URL('scripts/lib/config.mjs', location.href).href));
  async function gymnasts() {
    const g = await json('data/gymnasts.json');
    if (!g._byId) g._byId = Object.fromEntries(g.gymnasts.map(x => [x.id, x]));
    return g;
  }
  /** Projection used for sorting and the builder's projected total: 2026 NQS, else 2026 average, else null. */
  const proj = (g, ev) => { const p = g?.proj?.[ev]; return p ? (p.nqs ?? p.avg ?? null) : null; };
  const isDemo = s => s?.demo === true;
  /** Tag for a gymnast with no projection on an event: NEW = no 2026 NCAA record; no RQS = competed in 2026 but too few scores to rank. */
  const noProj = g => (g?.projection_status === 'none' || !g?.rtn_ids?.length) ? '<span class="pill new" title="No 2026 NCAA record">NEW</span>' : '<span class="pill" title="No 2026 RQS on this event">no RQS</span>';
  const seasonParam = s => (isDemo(s) ? `season=${encodeURIComponent(s.season)}&` : '');

  function chrome(active) {
    const nav = [['index.html', 'Home'], ['roster.html', 'Roster'], ['build.html', 'Build lineup'], ['leaderboard.html', 'Leaderboard']];
    const h = document.createElement('header');
    h.className = 'site-header';
    h.innerHTML = `<div class="wrap"><div class="top"><h1><a href="index.html"><span class="brand">The Five That Score</span> <span class="dash">—</span> <span class="sub">Fantasy Five</span></a></h1>
      <a class="handle" href="https://x.com/thefivethatscore" target="_blank" rel="noopener">@thefivethatscore</a></div>
      <nav class="tabs">${nav.map(([href, t]) => `<a href="${href}" class="${href === active ? 'on' : ''}">${t}</a>`).join('')}</nav></div>`;
    document.body.prepend(h);
    const f = document.createElement('footer');
    f.className = 'site-footer';
    f.innerHTML = `<div class="wrap"><p>Fantasy Five by <a href="https://x.com/thefivegym" target="_blank" rel="noopener">The Five Gym</a> · graphics <a href="https://x.com/thefivethatscore" target="_blank" rel="noopener">@thefivethatscore</a> · <a href="https://thefivegym.github.io/live-scoreboard/">Live scoreboard</a> · <a href="https://github.com/${REPO}">Source &amp; data</a></p>
      <p>Scores and 2026 averages/NQS from <a href="https://www.roadtonationals.com" target="_blank" rel="noopener">Road to Nationals</a>; 2026–27 rosters from official team sites. Unofficial fan project, not affiliated with the NCAA, RTN or any school. Just the read.</p></div>`;
    document.body.append(f);
  }
  function demoBanner(s, el) {
    if (!isDemo(s) || !el) return;
    el.hidden = false;
    el.innerHTML = `<span class="demo-tag">DEMO</span> This is a demonstration week built from real <b>2026</b> scores (${esc(s.weeks[0].label)}) with sample lineups. It is not part of the 2027 game. <a href="${location.pathname.split('/').pop() || 'index.html'}">Back to 2027</a>`;
  }
  const playerUrl = (login, s) => `player.html?${seasonParam(s)}u=${encodeURIComponent(login)}`;
  const cardUrl = (login, week, s) => `card.html?${seasonParam(s)}u=${encodeURIComponent(login)}&week=${week}`;
  const isDemoLogin = l => /^DEMO-/i.test(l);

  return { REPO, EVENTS, EV_SHORT, EV_NAME, json, esc, f3, fTot, q, fmtCT, fmtDate, seasons, season, openWeek, weekState, countdown, gymnasts, proj, chrome, demoBanner, noProj, config, isDemo, seasonParam, playerUrl, cardUrl, isDemoLogin };
})();
