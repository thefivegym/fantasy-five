import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSeason } from '../lib/io.mjs';
test('main season is not flagged demo; demo season is', async () => {
  const main = await loadSeason(2027);
  assert.notEqual(main.demo, true);
  const demo = await loadSeason('demo');
  assert.equal(demo.demo, true);
});
