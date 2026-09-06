import fs from 'node:fs/promises';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const checkpointPath = path.resolve('event_details.checkpoint.json');
const outputPath = path.resolve('event_details.json');
const allowIncomplete = args.has('--allow-incomplete');
const deleteCheckpoint = args.has('--delete-checkpoint');
const dryRun = args.has('--dry-run');

function normalizeEventName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase();
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function addUtcDays(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function recordStartDate(record) {
  if (isIsoDate(record.eventStartDate)) return record.eventStartDate;
  const dates = [
    ...(record.boards ?? []).map(board => board.date),
    ...(record.missingDates ?? []),
  ].filter(isIsoDate).sort();
  return dates[0] ?? '';
}

function validateCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object') throw new Error('Checkpoint is not an object.');
  if (!normalizeEventName(checkpoint.eventName)) throw new Error('Checkpoint has no eventName.');
  if (!isIsoDate(checkpoint.eventStartDate)) throw new Error('Checkpoint has no valid eventStartDate.');
  if (!Array.isArray(checkpoint.boards)) throw new Error('Checkpoint boards must be an array.');

  const boardDates = checkpoint.boards.map(board => board?.date);
  const missingDates = Array.isArray(checkpoint.missingDates) ? checkpoint.missingDates : [];
  const expectedDates = Array.from({ length: 7 }, (_, index) =>
    addUtcDays(checkpoint.eventStartDate, index));
  const expectedSet = new Set(expectedDates);

  for (const date of [...boardDates, ...missingDates]) {
    if (!isIsoDate(date)) throw new Error(`Invalid board date: ${date}`);
    if (!expectedSet.has(date)) throw new Error(`Date ${date} is outside this seven-day event.`);
  }
  if (new Set(boardDates).size !== boardDates.length) throw new Error('Checkpoint has duplicate board dates.');
  if (new Set(missingDates).size !== missingDates.length) throw new Error('Checkpoint has duplicate missing dates.');
  const overlap = boardDates.find(date => missingDates.includes(date));
  if (overlap) throw new Error(`${overlap} is both captured and missing.`);

  const accountedDates = new Set([...boardDates, ...missingDates]);
  const unaccountedDates = expectedDates.filter(date => !accountedDates.has(date));
  if (unaccountedDates.length > 0 && !allowIncomplete) {
    throw new Error(
      `Checkpoint is incomplete; unaccounted dates: ${unaccountedDates.join(', ')}. ` +
      'Use --allow-incomplete only if you intentionally want a partial event.',
    );
  }

  return {
    boardDates,
    missingDates,
    unaccountedDates,
  };
}

const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
const validation = validateCheckpoint(checkpoint);
const boards = [...checkpoint.boards]
  .sort((left, right) => left.date.localeCompare(right.date));
const missingDates = [...new Set([
  ...validation.missingDates,
  ...(allowIncomplete ? validation.unaccountedDates : []),
])].sort();
const converted = {
  eventName: checkpoint.eventName,
  boards,
  ...(missingDates.length > 0 ? { missingDates } : {}),
};

const existing = JSON.parse(await fs.readFile(outputPath, 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '[]';
  throw error;
}));
if (!Array.isArray(existing)) throw new Error('event_details.json must contain an array.');

const matchingIndex = existing.findIndex(event =>
  normalizeEventName(event.eventName) === normalizeEventName(checkpoint.eventName) &&
  recordStartDate(event) === checkpoint.eventStartDate);
if (matchingIndex >= 0) existing[matchingIndex] = converted;
else existing.push(converted);

console.log(`${matchingIndex >= 0 ? 'Replace' : 'Append'} event: ${checkpoint.eventName}`);
console.log(`Captured dates: ${boards.map(board => board.date).join(', ') || '(none)'}`);
console.log(`Missing dates: ${missingDates.join(', ') || '(none)'}`);

if (dryRun) {
  console.log('Dry run complete; no files changed.');
  process.exit(0);
}

const backupPath = `${outputPath}.bak`;
const temporaryPath = `${outputPath}.tmp`;
await fs.copyFile(outputPath, backupPath).catch(error => {
  if (error.code !== 'ENOENT') throw error;
});
await fs.writeFile(temporaryPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
await fs.rename(temporaryPath, outputPath);

if (deleteCheckpoint) await fs.unlink(checkpointPath);

console.log(`Updated: ${outputPath}`);
console.log(`Backup: ${backupPath}`);
console.log(deleteCheckpoint ? 'Checkpoint deleted.' : 'Checkpoint preserved.');
