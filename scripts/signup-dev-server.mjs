#!/usr/bin/env node
// Local signup page + memory store. Does not call GitHub and does not write data/players or data/lineups.
//   node scripts/signup-dev-server.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { ROOT } from './lib/io.mjs';
import { SIGNUP_ORIGINS } from './lib/config.mjs';
import { handleSignup } from './lib/signup-http.mjs';
import { memoryRateStore } from './lib/signup-rate.mjs';
import { memoryPlayerStore } from './lib/memory-signup-store.mjs';
import { loadPlayers } from './lib/players.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

export async function startSignupDevServer({ port = 0, host = '127.0.0.1' } = {}) {
  const store = memoryPlayerStore(await loadPlayers());
  const rate = memoryRateStore();
  let origin = '';
  const root = ROOT.endsWith(sep) ? ROOT : ROOT + sep;
  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url || '/', origin || `http://${host}`);
      if (u.pathname === '/api/signup') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const headers = new Headers();
        if (req.headers['content-type']) headers.set('content-type', req.headers['content-type']);
        if (req.headers.origin) headers.set('origin', req.headers.origin);
        if (req.headers.accept) headers.set('accept', req.headers.accept);
        const request = new Request(origin + u.pathname, {
          method: req.method,
          headers,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
        });
        const response = await handleSignup(request, {
          ip: req.socket.remoteAddress || 'unknown',
          rate,
          origins: [origin, ...SIGNUP_ORIGINS],
          listPlayers: () => store.list(),
          commit: record => store.commit(record),
        });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (u.pathname === '/data/signup-api.json') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ url: `${origin}/api/signup` }));
        return;
      }
      let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      if (rel.includes('\0') || rel.split('/').includes('..')) { res.writeHead(403).end('no'); return; }
      const file = join(ROOT, rel);
      if (file !== ROOT && !file.startsWith(root)) { res.writeHead(403).end('no'); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch (e) {
      if (e?.code === 'ENOENT') { res.writeHead(404).end('not found'); return; }
      console.error('dev server', e?.code || e?.name || 'error');
      res.writeHead(500).end('error');
    }
  });
  await new Promise((resolve, reject) => server.listen(port, host, err => err ? reject(err) : resolve()));
  const addr = server.address();
  origin = `http://${host}:${addr.port}`;
  return {
    url: origin,
    store,
    close() { return new Promise(resolve => server.close(resolve)); },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const srv = await startSignupDevServer({ port: Number(process.env.PORT || 8000) });
  console.log(`Memory-only signup at ${srv.url}/signup.html`);
  console.log('Does not call GitHub and does not write data/players.');
}
