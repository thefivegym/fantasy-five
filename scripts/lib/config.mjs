// Fantasy Five game constants. Change here, not in the scripts.

export const EVENTS = ['vault', 'bars', 'beam', 'floor'];
export const SLOTS_PER_EVENT = 5;
// Within one event, at most this many picks may come from the same team (across events, no limit).
export const MAX_PER_TEAM_PER_EVENT = 1;

// How a slot is scored when a gymnast competes an event more than once in a week.
//   'best'    -> her highest score that week (v1 default)
//   'average' -> mean of her scores that week, rounded to 3 decimals
export const MULTI_MEET_MODE = 'best';

// Default lock: Friday 17:00 America/Chicago. Each week in data/season.json carries its own `lock`
// timestamp, which is what the workflows actually enforce.
export const DEFAULT_LOCK = { weekday: 'Friday', time: '17:00', tz: 'America/Chicago' };

export const REPO = 'thefivegym/fantasy-five';
export const LINEUP_TITLE_PREFIX = 'Lineup:';
export const LINEUP_LABEL = 'lineup';
