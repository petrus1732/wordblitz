import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const selfId = '98610e86acb0a629da17f0993ec0fd50';
const header = 'dailyDate,rank,playerId,name,points,avatarUrl\n';
const source = await fs.readFile(new URL('./scrape_daily_rank.mjs', import.meta.url), 'utf8');
// Exercise the scraper's real CSV merger without starting a browser or using account credentials.
const mergerSource = source.slice(0, source.indexOf('  async function extractLeaderboard(frame)'))
  .replace(/^import .*;\r?\n/gm, '') + '\nreturn { appendCsv };\n}\nreturn runForStorage(storagePath);';
const makeMerger = new (Object.getPrototypeOf(async function () {}).constructor)(
  'fs', 'path', 'console', 'storagePath', mergerSource,
);

async function fixture(initial = header) {
  let csv = initial;
  const mockFs = {
    access: async () => {},
    readFile: async file => file === path.resolve('./daily_scores.csv')
      ? csv : fs.readFile(file, 'utf8'),
    writeFile: async (file, value) => {
      assert.equal(file, path.resolve('./daily_scores.csv'));
      csv = value;
    },
  };
  const logger = { log() {}, warn() {} };
  return {
    first: await makeMerger(mockFs, path, logger, './storage_state.json'),
    second: await makeMerger(mockFs, path, logger, './storage_state2.json'),
    rows: () => csv.trim().split('\n').slice(1),
  };
}

test('own-account You score survives the other-account zero placeholder', async () => {
  const f = await fixture();
  await f.first.appendCsv([{ name: 'You', points: '1745', playerId: '', avatar: '' }], '2026-10-08');
  await f.second.appendCsv([{ name: '奕安', points: '0', playerId: selfId, avatar: '' }], '2026-10-08');
  assert.equal(f.rows().length, 1);
  assert.match(f.rows()[0], new RegExp(`${selfId},"陳奕安",1745,https://`));
});

test('historical self rows use full name and a fresh own-account score repairs zero', async () => {
  const f = await fixture(header + `2026-10-09,35,${selfId},"奕安",0,\n`);
  await f.second.appendCsv([], '2026-10-09');
  assert.match(f.rows()[0], /"陳奕安",0,/);
  await f.first.appendCsv([{ name: 'You', points: '1234', playerId: '', avatar: '' }], '2026-10-09');
  assert.equal(f.rows().length, 1);
  assert.match(f.rows()[0], /"陳奕安",1234,/);
});

test('other-account You and named self rows cannot supply the main account score', async () => {
  const f = await fixture();
  await f.second.appendCsv([{ name: 'You', points: '1000', playerId: 'other-account', avatar: '' }], '2026-10-08');
  await f.second.appendCsv([{ name: '奕安', points: '1500', playerId: selfId, avatar: '' }], '2026-10-08');
  assert.equal(f.rows().length, 0);
});

test('same-name positive row cannot overwrite first-account You, in either order', async () => {
  for (const namesakeFirst of [true, false]) {
    const f = await fixture();
    const own = () => f.first.appendCsv([{ name: 'You', points: '1745', playerId: '', avatar: '' }], '2026-10-09');
    const namesake = () => f.first.appendCsv([
      { name: '陳奕安', points: '888', playerId: selfId, avatar: '' },
      { name: '陳奕安', points: '777', playerId: '139aeeddeccb7d58d846dd92803b02fa', avatar: '' },
    ], '2026-10-09');
    if (namesakeFirst) { await namesake(); await own(); }
    else { await own(); await namesake(); }
    assert.equal(f.rows().length, 1);
    assert.match(f.rows()[0], /"陳奕安",1745,/);
  }
});
