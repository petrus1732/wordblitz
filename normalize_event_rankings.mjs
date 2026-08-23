import fs from 'node:fs/promises';
import path from 'node:path';

const SELF_PLAYER_ID = '98610e86acb0a629da17f0993ec0fd50';
const SELF_PLAYER_NAME = '陳奕安';
const INPUT_PATH = path.resolve(process.argv[2] || './event_rankings.json');
const OUTPUT_PATH = path.resolve(process.argv[3] || INPUT_PATH);
const PLAYERS_PATH = path.resolve('./players.csv');

function parseCsv(raw) {
  const table = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < raw.length; index++) {
    const character = raw[index];
    if (character === '"') {
      if (quoted && raw[index + 1] === '"') {
        field += '"';
        index++;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && raw[index + 1] === '\n') index++;
      row.push(field);
      if (row.some(value => value.length)) table.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (field || row.length) {
    row.push(field);
    table.push(row);
  }

  const [header, ...records] = table;
  if (!header) return [];
  return records.map(values => Object.fromEntries(
    header.map((column, index) => [column, values[index] || '']),
  ));
}

function isSummary(entry) {
  const name = String(entry?.name || '').trim().toLocaleLowerCase();
  return name === 'all players' || name === 'all arenas';
}

function isUsablePlayerId(value) {
  const playerId = String(value || '').trim();
  return /^[0-9a-f]{32}$/i.test(playerId) && !/^a{32}$/i.test(playerId);
}

function namesAreAliases(left, right) {
  const a = String(left || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const b = String(right || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b} `) || a.endsWith(` ${b}`) ||
    b.startsWith(`${a} `) || b.endsWith(` ${a}`);
}

function mergeResultDuplicates(entries) {
  const removed = new Set();
  const groups = new Map();

  for (const entry of entries) {
    if (isSummary(entry)) continue;
    const key = `${entry.rank}\u0000${entry.points}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  let merged = 0;
  for (const group of groups.values()) {
    const identified = group.filter(entry => isUsablePlayerId(entry.playerId));
    const unidentified = group.filter(entry => !isUsablePlayerId(entry.playerId));

    for (const incomplete of unidentified) {
      const matches = identified.filter(candidate =>
        namesAreAliases(candidate.name, incomplete.name),
      );
      if (matches.length !== 1) continue;

      const target = matches[0];
      if (String(incomplete.name || '').trim().length > String(target.name || '').trim().length)
        target.name = incomplete.name;
      removed.add(incomplete);
      merged++;
    }
  }

  return {
    entries: entries.filter(entry => !removed.has(entry)),
    merged,
  };
}

function preferEntry(current, candidate) {
  const currentPoints = Number(current.points) || 0;
  const candidatePoints = Number(candidate.points) || 0;
  if (candidatePoints !== currentPoints)
    return candidatePoints > currentPoints ? candidate : current;

  const currentQuality = Number(Boolean(current.playerId)) + Number(/^https?:\/\//i.test(current.avatar || ''));
  const candidateQuality = Number(Boolean(candidate.playerId)) + Number(/^https?:\/\//i.test(candidate.avatar || ''));
  return candidateQuality > currentQuality ? candidate : current;
}

const playersRaw = await fs.readFile(PLAYERS_PATH, 'utf8').catch(() => '');
const playerProfiles = parseCsv(playersRaw);
const playersById = new Map(playerProfiles
  .filter(row => isUsablePlayerId(row.playerId) && String(row.fullName || '').trim())
  .map(row => [row.playerId.trim().toLocaleLowerCase(), row]));
const selfProfile = playerProfiles.find(row => row.playerId === SELF_PLAYER_ID);
const selfAvatar = selfProfile?.profilePhoto || '';

const raw = await fs.readFile(INPUT_PATH, 'utf8');
const events = JSON.parse(raw);
if (!Array.isArray(events)) throw new Error('event_rankings.json must contain an array.');

let replacedYou = 0;
let removedEmptyYou = 0;
let removedDuplicates = 0;
let mergedResultDuplicates = 0;
let replacedWithFullName = 0;
let replacedWithEventFullName = 0;
let tiedPlayers = 0;

for (const event of events) {
  const source = Array.isArray(event.rankings) ? event.rankings : [];
  const summaries = [];
  const playersByIdentity = new Map();

  for (const original of source) {
    if (!original || typeof original !== 'object') continue;
    const entry = { ...original, points: Number(original.points) || 0 };
    if (!isUsablePlayerId(entry.playerId)) entry.playerId = '';
    const normalizedName = String(entry.name || '').trim().toLocaleLowerCase();

    if (normalizedName === 'you' && entry.points === 0) {
      removedEmptyYou++;
      continue;
    }
    if (normalizedName === 'you' && entry.points > 0) {
      entry.name = SELF_PLAYER_NAME;
      entry.playerId = SELF_PLAYER_ID;
      entry.avatar = selfAvatar || entry.avatar || '';
      replacedYou++;
    } else if (entry.playerId === SELF_PLAYER_ID) {
      entry.name = SELF_PLAYER_NAME;
      entry.avatar = selfAvatar || entry.avatar || '';
    }

    const playerProfile = playersById.get(
      String(entry.playerId || '').trim().toLocaleLowerCase(),
    );
    const fullName = String(playerProfile?.fullName || '').trim();
    if (fullName && entry.name !== fullName) {
      entry.name = fullName;
      replacedWithFullName++;
    }

    if (isSummary(entry)) {
      entry.rank = 0;
      summaries.push(entry);
      continue;
    }

    const identity = entry.playerId || `name:${String(entry.name || '').trim().toLocaleLowerCase()}`;
    const existing = playersByIdentity.get(identity);
    if (existing) {
      playersByIdentity.set(identity, preferEntry(existing, entry));
      removedDuplicates++;
    } else playersByIdentity.set(identity, entry);
  }

  const merged = mergeResultDuplicates([...playersByIdentity.values()]);
  mergedResultDuplicates += merged.merged;
  const rankings = merged.entries.sort((a, b) =>
    b.points - a.points || String(a.name || '').localeCompare(String(b.name || '')),
  );

  let denseRank = 0;
  let previousPoints = null;
  for (const entry of rankings) {
    if (previousPoints === null || entry.points !== previousPoints) denseRank++;
    else tiedPlayers++;
    entry.rank = denseRank;
    previousPoints = entry.points;
  }

  const summaryByName = new Map();
  for (const summary of summaries)
    summaryByName.set(String(summary.name).trim().toLocaleLowerCase(), summary);
  event.rankings = [...summaryByName.values(), ...rankings];
}

// Some full names are discoverable only in a newer scrape of a historical
// event. Propagate the longest known event name to every row with that ID.
// An explicit fullName from players.csv always remains authoritative.
const canonicalEventNames = new Map(
  [...playersById.entries()].map(([playerId, profile]) => [playerId, profile.fullName.trim()]),
);
for (const event of events) {
  for (const entry of event.rankings || []) {
    if (!isUsablePlayerId(entry.playerId)) continue;
    const playerId = entry.playerId.trim().toLocaleLowerCase();
    if (playersById.has(playerId)) continue;
    const candidate = String(entry.name || '').trim();
    const current = canonicalEventNames.get(playerId) || '';
    if (candidate.length > current.length) canonicalEventNames.set(playerId, candidate);
  }
}
for (const event of events) {
  for (const entry of event.rankings || []) {
    const playerId = String(entry.playerId || '').trim().toLocaleLowerCase();
    const fullName = canonicalEventNames.get(playerId);
    if (fullName && entry.name !== fullName) {
      entry.name = fullName;
      replacedWithEventFullName++;
    }
  }
}

if (OUTPUT_PATH === INPUT_PATH) {
  const backupPath = `${INPUT_PATH}.backup`;
  const backupExists = await fs.access(backupPath).then(() => true).catch(() => false);
  if (!backupExists) {
    await fs.copyFile(INPUT_PATH, backupPath);
    console.log(`Created backup: ${backupPath}`);
  }
}

await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(events, null, 2)}\n`, 'utf8');
console.log(`Normalized ${events.length} events in ${OUTPUT_PATH}`);
console.log(`Replaced nonzero "You" rows: ${replacedYou}`);
console.log(`Removed zero-score "You" rows: ${removedEmptyYou}`);
console.log(`Removed duplicate player rows: ${removedDuplicates}`);
console.log(`Merged duplicate short/full-name result rows: ${mergedResultDuplicates}`);
console.log(`Player names replaced from players.csv: ${replacedWithFullName}`);
console.log(`Player names replaced from event history: ${replacedWithEventFullName}`);
console.log(`Players sharing a dense rank: ${tiedPlayers}`);
