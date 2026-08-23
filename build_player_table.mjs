import fs from 'node:fs/promises';
import path from 'node:path';

const CUTOFF_DATE = '2026-08-16';
const INPUT_PATH = path.resolve(process.argv[2] || './daily_scores.csv');
const OUTPUT_PATH = path.resolve(process.argv[3] || './players.csv');
const OVERRIDES_PATH = path.resolve(process.argv[4] || './player_alias_overrides.csv');
const EVENT_INPUT_PATH = path.resolve(process.argv[5] || './event_rankings.json');
const GENERIC_NAMES = new Set(['all players', 'all arenas', 'you']);

function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < raw.length; index++) {
    const character = raw[index];
    if (character === '"') {
      if (quoted && raw[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && raw[index + 1] === '\n') index++;
      row.push(field);
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...data] = rows;
  return data.map(values => Object.fromEntries(
    header.map((column, index) => [column, values[index] || '']),
  ));
}

function cleanName(value) {
  return (value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedName(value) {
  return cleanName(value).toLocaleLowerCase();
}

function isGenericName(value) {
  return GENERIC_NAMES.has(normalizedName(value));
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function increment(map, value) {
  if (!value) return;
  map.set(value, (map.get(value) || 0) + 1);
}

function mostFrequent(map, fallback = '') {
  return Array.from(map.entries()).sort((a, b) =>
    b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]),
  )[0]?.[0] || fallback;
}

function sameResultKey(row) {
  return `${row.leaderboardKey}\u0000${row.rank}\u0000${row.points}`;
}

const raw = await fs.readFile(INPUT_PATH, 'utf8');
const dailyRows = parseCsv(raw).map(row => ({
  ...row,
  leaderboardKey: `daily:${row.dailyDate}`,
  name: cleanName(row.name),
  playerId: row.playerId.trim(),
  avatarUrl: row.avatarUrl.trim(),
}));

const eventRaw = await fs.readFile(EVENT_INPUT_PATH, 'utf8');
const events = JSON.parse(eventRaw);
if (!Array.isArray(events)) {
  throw new TypeError(`${EVENT_INPUT_PATH} must contain a JSON array.`);
}

const eventRows = events.flatMap((event, eventIndex) => {
  const eventDate = String(event?.date || '');
  const eventName = cleanName(event?.name);
  if (!Array.isArray(event?.rankings)) {
    console.warn(`Ignored event without rankings at index ${eventIndex}.`);
    return [];
  }

  return event.rankings.map(row => ({
    dailyDate: eventDate,
    leaderboardKey: `event:${eventDate}:${eventName}:${eventIndex}`,
    rank: String(row?.rank ?? ''),
    points: String(row?.points ?? ''),
    name: cleanName(row?.name),
    playerId: String(row?.playerId ?? '').trim(),
    avatarUrl: String(row?.avatar ?? '').trim(),
  }));
});

const rows = [...dailyRows, ...eventRows];

const players = new Map();
const identifiedByResult = new Map();

for (const row of rows) {
  if (!row.playerId || isGenericName(row.name)) continue;
  if (!players.has(row.playerId)) {
    players.set(row.playerId, {
      playerId: row.playerId,
      shortNames: new Map(),
      fullNames: new Map(),
      photos: new Map(),
    });
  }

  const player = players.get(row.playerId);
  // Through the cutoff, rankings exposed only the legacy/short display name.
  // Newer scraper output can attach the ID directly to the full-name row, so
  // those names must not be treated as short names merely because an ID exists.
  if (row.dailyDate <= CUTOFF_DATE) increment(player.shortNames, row.name);
  else increment(player.fullNames, row.name);
  if (/^https?:\/\//i.test(row.avatarUrl)) increment(player.photos, row.avatarUrl);

  const key = sameResultKey(row);
  if (!identifiedByResult.has(key)) identifiedByResult.set(key, []);
  identifiedByResult.get(key).push(row);
}

let matchedFullNames = 0;
const unresolvedFullNames = new Map();
const resolvedFullNames = new Set();

for (const row of rows) {
  if (row.dailyDate <= CUTOFF_DATE || row.playerId || isGenericName(row.name)) continue;

  const candidates = identifiedByResult.get(sameResultKey(row)) || [];
  let matches = candidates;
  if (matches.length > 1) {
    matches = matches.filter(candidate => {
      const shortName = normalizedName(candidate.name);
      const fullName = normalizedName(row.name);
      return fullName.startsWith(`${shortName} `) ||
        fullName.endsWith(` ${shortName}`) ||
        fullName === shortName;
    });
  }

  const uniqueIds = [...new Set(matches.map(candidate => candidate.playerId))];
  if (uniqueIds.length === 1) {
    increment(players.get(uniqueIds[0]).fullNames, row.name);
    resolvedFullNames.add(normalizedName(row.name));
    matchedFullNames++;
  } else {
    increment(unresolvedFullNames, row.name);
  }
}

const overrideRaw = await fs.readFile(OVERRIDES_PATH, 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '';
  throw error;
});
const overrides = overrideRaw ? parseCsv(overrideRaw) : [];
let appliedOverrides = 0;

for (const override of overrides) {
  const fullName = cleanName(override.fullName);
  const firstName = cleanName(override.firstName);
  const playerId = override.playerId.trim();
  const player = players.get(playerId);

  if (!fullName || !playerId || !player) {
    console.warn(`Ignored invalid player alias override: ${JSON.stringify(override)}`);
    continue;
  }

  if (firstName) increment(player.shortNames, firstName);
  player.overrideFirstName = firstName;
  player.overrideFullName = fullName;
  resolvedFullNames.add(normalizedName(fullName));
  for (const unresolvedName of unresolvedFullNames.keys()) {
    if (normalizedName(unresolvedName) === normalizedName(fullName))
      unresolvedFullNames.delete(unresolvedName);
  }
  appliedOverrides++;
}

let matchedByUniqueAlias = 0;
for (const [fullName, count] of [...unresolvedFullNames.entries()]) {
  const normalizedFullName = normalizedName(fullName);
  const matchingPlayers = [];

  for (const player of players.values()) {
    const matchesAlias = [...player.shortNames.keys()].some(shortName => {
      const normalizedShortName = normalizedName(shortName);
      return normalizedFullName === normalizedShortName ||
        normalizedFullName.startsWith(`${normalizedShortName} `) ||
        normalizedFullName.endsWith(` ${normalizedShortName}`);
    });
    if (matchesAlias) matchingPlayers.push(player);
  }

  if (matchingPlayers.length === 1) {
    matchingPlayers[0].fullNames.set(
      fullName,
      (matchingPlayers[0].fullNames.get(fullName) || 0) + count,
    );
    resolvedFullNames.add(normalizedFullName);
    unresolvedFullNames.delete(fullName);
    matchedByUniqueAlias++;
  }
}

const outputRows = [];
for (const player of players.values()) {
  const firstName = player.overrideFirstName ||
    mostFrequent(player.shortNames, mostFrequent(player.fullNames));
  const fullName = player.overrideFullName || mostFrequent(player.fullNames);
  outputRows.push({
    fullName,
    firstName,
    playerId: player.playerId,
    profilePhoto: mostFrequent(player.photos),
  });
}

for (const fullName of unresolvedFullNames.keys()) {
  if (resolvedFullNames.has(normalizedName(fullName))) continue;
  outputRows.push({ fullName, firstName: '', playerId: '', profilePhoto: '' });
}

outputRows.sort((a, b) =>
  (a.fullName || a.firstName).localeCompare(b.fullName || b.firstName) ||
  a.playerId.localeCompare(b.playerId),
);

const header = ['fullName', 'firstName', 'playerId', 'profilePhoto'];
const csv = [
  header.join(','),
  ...outputRows.map(row => header.map(column => csvCell(row[column])).join(',')),
].join('\n');

await fs.writeFile(OUTPUT_PATH, `${csv}\n`, 'utf8');
console.log(`Created ${OUTPUT_PATH}`);
console.log(`Daily ranking rows read: ${dailyRows.length}`);
console.log(`Event ranking rows read: ${eventRows.length} from ${events.length} events`);
console.log(`Players with IDs: ${players.size}`);
console.log(`Full-name records matched by date/rank/score: ${matchedFullNames}`);
console.log(`Manual alias overrides applied: ${appliedOverrides}`);
console.log(`Full names matched by unique historical alias: ${matchedByUniqueAlias}`);
const unresolved = outputRows.filter(row => !row.playerId)
console.log(`Unresolved full names: ${unresolved.length}`);
console.log(unresolved)
