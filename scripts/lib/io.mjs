import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA = join(ROOT, 'data');
export async function readJson(p, fallback = undefined) {
  try { return JSON.parse(await readFile(p, 'utf8')); }
  catch (e) { if (fallback !== undefined) return fallback; throw e; }
}
export async function writeJson(p, obj) {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(obj, null, 1) + '\n');
}
export function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
}
/** Season descriptor: '2027' -> data/season.json, 'demo' -> data/demo/season.json */
export async function loadSeason(id) {
  const main = await readJson(join(DATA, 'season.json'));
  if (String(id) === String(main.season)) return main;
  if (main.demo && String(id) === String(main.demo.season)) return readJson(join(DATA, main.demo.file));
  throw new Error(`Unknown season ${id}`);
}
