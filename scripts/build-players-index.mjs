#!/usr/bin/env node
// Rebuilds data/players.json (login -> IG handle) from data/players/*.json. Usage: node scripts/build-players-index.mjs [out]
import { writePlayersIndex } from './lib/players.mjs';
const idx = await writePlayersIndex(process.argv[2]);
console.log(`players.json: ${Object.keys(idx.players).length} player(s)`);
