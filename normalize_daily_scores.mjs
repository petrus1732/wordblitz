import fs from 'node:fs/promises';
import path from 'node:path';

const INPUT_PATH = path.resolve(process.argv[2] || './daily_scores.csv');
const OUTPUT_PATH = path.resolve(process.argv[3] || INPUT_PATH);

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
  return {
    header,
    records: records.map(values => Object.fromEntries(
      header.map((column, index) => [column, values[index] || '']),
    )),
  };
}

function isSummary(row) {
  const name = String(row.name || '').trim().toLocaleLowerCase();
  return name === 'all players' || name === 'all arenas';
}

function quote(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

const raw = await fs.readFile(INPUT_PATH, 'utf8');
const { header, records } = parseCsv(raw);
if (!header?.length) throw new Error('The input CSV has no header.');

const byDate = new Map();
for (const row of records) {
  if (!byDate.has(row.dailyDate)) byDate.set(row.dailyDate, []);
  byDate.get(row.dailyDate).push(row);
}

let changedRanks = 0;
const normalized = [];
for (const date of [...byDate.keys()].sort()) {
  const group = byDate.get(date);
  const summaries = group.filter(isSummary);
  const players = group.filter(row => !isSummary(row));
  players.sort((a, b) =>
    (Number(b.points) || 0) - (Number(a.points) || 0) ||
    String(a.name || '').localeCompare(String(b.name || '')),
  );

  let denseRank = 0;
  let previousPoints = null;
  for (const player of players) {
    const points = Number(player.points) || 0;
    if (previousPoints === null || points !== previousPoints) denseRank++;
    const nextRank = String(denseRank);
    if (player.rank !== nextRank) changedRanks++;
    player.rank = nextRank;
    previousPoints = points;
  }
  for (const summary of summaries) {
    if (summary.rank !== '0') changedRanks++;
    summary.rank = '0';
  }

  normalized.push(...players, ...summaries);
}

const lines = normalized.map(row => [
  row.dailyDate,
  row.rank,
  row.playerId,
  quote(row.name),
  row.points,
  row.avatarUrl,
].join(','));
await fs.writeFile(OUTPUT_PATH, `${header.join(',')}\n${lines.join('\n')}\n`, 'utf8');
console.log(`Normalized ${normalized.length} rows across ${byDate.size} dates.`);
console.log(`Ranks changed: ${changedRanks}`);
