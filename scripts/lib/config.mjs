// Fantasy Five game constants. Change here, not in the scripts.

// Apparatus events (score sources). 'aa' is the all-around total from one meet where she competed all four.
export const EVENTS = ['vault', 'bars', 'beam', 'floor'];
// Lineup slots, one gymnast each. Slot key = the score she contributes.
export const SLOTS = ['vault', 'bars', 'beam', 'floor', 'aa'];
export const SLOT_LABEL = { vault: 'Vault', bars: 'Bars', beam: 'Beam', floor: 'Floor', aa: 'All-Around' };
export const SLOT_SHORT = { vault: 'VT', bars: 'UB', beam: 'BB', floor: 'FX', aa: 'AA' };

// Lineup JSON schema. v1 (retired) = 5 gymnasts per event, 20 slots. v2 = 5 single picks above.
export const LINEUP_SCHEMA = 2;

// Constraints across the whole lineup.
export const MAX_PER_TEAM_PER_LINEUP = 1;   // all 5 picks from 5 different teams
export const MAX_USES_PER_GYMNAST = 1;      // a gymnast fills at most one slot

// How a slot is scored when a gymnast competes it more than once in a week.
//   'best'    -> her highest score that week (best single event score, or best AA total)
//   'average' -> mean of her scores that week, rounded to 3 decimals
export const MULTI_MEET_MODE = 'best';

// Default lock: Friday 17:00 America/Chicago. Each week in data/season.json carries its own `lock`
// timestamp, which is what the workflows actually enforce.
export const DEFAULT_LOCK = { weekday: 'Friday', time: '17:00', tz: 'America/Chicago' };

export const REPO = 'thefivegym/fantasy-five';
export const LINEUP_TITLE_PREFIX = 'Lineup:';
export const LINEUP_LABEL = 'lineup';
