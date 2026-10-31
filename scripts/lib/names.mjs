export const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/&amp;/g, '&').replace(/[’'`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const slug = s => norm(s).replace(/ /g, '-');
