// Public index entry for one player. No filesystem. Safe to import from the signup worker.
// Readers that only use .instagram keep working. auth is set only for handle-only signups.
export function playerIndexEntry(p) {
  const entry = { instagram: p?.instagram || null };
  if (p?.auth === 'instagram') entry.auth = 'instagram';
  return entry;
}
