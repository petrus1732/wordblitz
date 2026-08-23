import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const FB_APP_PLAY_URL =
  'https://www.facebook.com/gaming/play/2211386328877300/';
const OUTPUT_JSON = path.resolve('./event_rankings.json');
const NOW = new Date(Date.now()) // current UTC in ms
const PLAYER_RENAME_ID = '98610e86acb0a629da17f0993ec0fd50';
const PLAYER_DISCARD_ID = '139aeeddeccb7d58d846dd92803b02fa';
const STORAGE_PATHS = ['./storage_state.json', './storage_state2.json'];
const PLAYERS_CSV = path.resolve('./players.csv');
const FIRST_ACCOUNT_STORAGE = path.resolve('./storage_state.json');
const SELF_PLAYER_NAME = '陳奕安';

const UNIT_IN_MS = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

const MONTH_INDEX = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function formatDate(date) {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function normaliseWhitespace(value) {
  if (!value) return '';
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseCsvTable(raw) {
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
      if (row.some(value => value.length > 0)) table.push(row);
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

async function loadPlayerMappings() {
  const raw = await fs.readFile(PLAYERS_CSV, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const profiles = raw ? parseCsvTable(raw) : [];
  const aliases = new Map();

  for (const profile of profiles) {
    if (!profile.playerId) continue;
    for (const name of [profile.fullName, profile.firstName]) {
      const key = normaliseWhitespace(name).toLocaleLowerCase();
      if (!key) continue;
      const existing = aliases.get(key);
      if (existing && existing.playerId !== profile.playerId) aliases.set(key, null);
      else if (existing !== null) {
        aliases.set(key, {
          playerId: profile.playerId,
          avatar: /^https?:\/\//i.test(profile.profilePhoto || '')
            ? profile.profilePhoto
            : '',
        });
      }
    }
  }
  console.log(`Loaded ${profiles.length} player profiles from ${PLAYERS_CSV}.`);
  return { aliases, profiles };
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

async function savePlayerMappings(playerDirectory) {
  const header = ['fullName', 'firstName', 'playerId', 'profilePhoto'];
  const rows = playerDirectory.profiles.map(profile =>
    header.map(column => csvCell(profile[column])).join(','),
  );
  await fs.writeFile(PLAYERS_CSV, `${header.join(',')}\n${rows.join('\n')}\n`, 'utf8');
}

async function resolveMappedPlayer(observedName, playerDirectory) {
  const normalizedObserved = normaliseWhitespace(observedName).toLocaleLowerCase();
  if (!normalizedObserved) return null;
  const exact = playerDirectory.aliases.get(normalizedObserved);
  if (exact) return exact;

  const candidates = playerDirectory.profiles.filter(profile => {
    if (!profile.playerId || profile.fullName) return false;
    const firstName = normaliseWhitespace(profile.firstName).toLocaleLowerCase();
    return firstName && (
      normalizedObserved === firstName ||
      normalizedObserved.startsWith(`${firstName} `) ||
      normalizedObserved.endsWith(` ${firstName}`)
    );
  });
  const uniqueIds = [...new Set(candidates.map(profile => profile.playerId))];
  if (uniqueIds.length !== 1) return null;

  const profile = candidates.find(candidate => candidate.playerId === uniqueIds[0]);
  profile.fullName = normaliseWhitespace(observedName);
  const mapped = {
    playerId: profile.playerId,
    avatar: /^https?:\/\//i.test(profile.profilePhoto || '') ? profile.profilePhoto : '',
  };
  playerDirectory.aliases.set(normalizedObserved, mapped);
  await savePlayerMappings(playerDirectory);
  console.log(`Added full-name mapping: "${profile.fullName}" -> ${profile.playerId}`);
  return mapped;
}

function parseRelativeDate(raw, base = NOW) {
  if (!raw) return null;
  const text = normaliseWhitespace(raw).toLowerCase();
  if (!text) return null;

  if (text.includes('hour')) {
    const target = new Date(base.getTime() - UNIT_IN_MS.day);
    return formatDate(target);
  }

  const relativeMatch = text.match(
    /(?:about\s+)?(a|\d+)\s+(day)s?\s+ago/
  );
  if (relativeMatch) {
    const [, quantityText, unit] = relativeMatch;
    const quantity =
      quantityText === 'a'
        ? 1
        : Number.parseInt(quantityText, 10);
    const unitMs = UNIT_IN_MS[unit];
    if (!Number.isNaN(quantity) && unitMs) {
      const adjustedQuantity = quantity; // in-game daily summaries lag by one day
      const target = new Date(base.getTime() - adjustedQuantity * unitMs);
      return formatDate(target);
    }
  }

  const monthMatch = text.match(
    /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,\s*(\d{4}))?$/
  );
  if (monthMatch) {
    const [, monthToken, dayText, yearText] = monthMatch;
    const monthLower = monthToken.toLowerCase();
    const monthKey = monthLower.slice(0, 3);
    const monthIndex =
      MONTH_INDEX[monthLower] ?? MONTH_INDEX[monthKey];
    const day = Number.parseInt(dayText, 10);
    let year =
      yearText ? Number.parseInt(yearText, 10) : base.getUTCFullYear();
    if (monthIndex !== undefined && !Number.isNaN(day) && !Number.isNaN(year)) {
      let resolved = new Date(Date.UTC(year, monthIndex, day));

      // 若解析出的日期在未來（例如現在是 1 月，標籤是 12/31），則表示是去年的
      if (!yearText && !Number.isNaN(resolved.valueOf()) && resolved > base) {
        year -= 1;
        resolved = new Date(Date.UTC(year, monthIndex, day));
      }

      if (!Number.isNaN(resolved.valueOf())) return formatDate(resolved);
    }
  }

  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return formatDate(new Date(parsed));
  return null;
}

async function readExistingEvents(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    console.warn(`Unable to read existing event rankings: ${err.message}`);
    return [];
  }
}

async function attachToGameFrame(outerFrame) {
  if (!outerFrame) throw new Error('Unable to resolve the outer game iframe.');
  const bundleHandle = await outerFrame
    .waitForSelector('iframe[name="game-bundle"]', { timeout: 15000 })
    .catch(() => null);
  if (!bundleHandle) return outerFrame;

  const gameFrame = await bundleHandle.contentFrame();
  if (!gameFrame) throw new Error('Unable to resolve the nested game iframe.');
  return gameFrame;
}

async function dismissJoinRewardPopup(frame, timeout = 10000) {
  const button = frame.locator('.secondary-button', { hasText: 'Lose rewards' }).first();
  const appeared = await button.waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return false;
  await button.click({ force: true });
  await button.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  console.log('Dismissed the optional join-reward popup via "Lose rewards".');
  return true;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function mergeEventsByDate(existing, updates) {
  const eventsByDate = new Map();

  existing.forEach((event) => {
    if (!event || typeof event !== 'object') return
    const eventDate = event.date ?? 'unknown'
    eventsByDate.set(eventDate, event)
  })

  updates.forEach((event) => {
    if (!event || typeof event !== 'object') return
    const eventDate = event.date ?? 'unknown'
    const existingEvent = eventsByDate.get(eventDate)
    if (!existingEvent) {
      eventsByDate.set(eventDate, event)
      return
    }
    const mergedRankings = mergeRankings(existingEvent.rankings, event.rankings)
    eventsByDate.set(eventDate, {
      ...existingEvent,
      rankings: mergedRankings,
    })
  })

  return Array.from(eventsByDate.values())
}

function mergeRankings(listA = [], listB = []) {
  const merged = [...(listA ?? []), ...(listB ?? [])]
  const seen = new Set()
  const deduped = []

  let allArenasEntry = null
  merged.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return
    const playerId = entry.playerId || `name:${entry.name || 'Unknown'}`
    const key = `${playerId}:${entry.points ?? ''}`
    if (entry.name === 'All arenas' || entry.name === "All Players") {
      allArenasEntry = entry
      return
    }
    if (seen.has(key)) return
    seen.add(key)
    deduped.push({ ...entry })
  })

  deduped.sort((a, b) => {
    const scoreA = Number(a.points ?? 0)
    const scoreB = Number(b.points ?? 0)
    if (scoreB !== scoreA) return scoreB - scoreA
    const rankA = Number(a.rank ?? Infinity)
    const rankB = Number(b.rank ?? Infinity)
    if (rankA !== rankB) return rankA - rankB
    return (a.name || '').localeCompare(b.name || '')
  })

  let denseRank = 0
  let previousPoints = null
  deduped.forEach((entry) => {
    const points = Number(entry.points ?? 0)
    if (previousPoints === null || points !== previousPoints) denseRank += 1
    entry.rank = denseRank
    previousPoints = points
  })

  if (allArenasEntry) {
    allArenasEntry.rank = 0;
    deduped.unshift(allArenasEntry);
  }
  console.log(deduped)
  return deduped
}

function isEventClosed(metadata, isoDate) {
  const timeText = normaliseWhitespace(metadata?.relativeTime).toLowerCase();
  console.log(`  Detected time text: "${timeText}"`);
  if (timeText) {
    return !timeText.includes('left')
  }

  if (isoDate && isoDate !== 'unknown') {
    const eventDay = new Date(isoDate);
    if (!Number.isNaN(eventDay.valueOf())) {
      const today = new Date(NOW);
      today.setHours(0, 0, 0, 0);
      eventDay.setHours(0, 0, 0, 0);
      if (eventDay.getTime() < today.getTime())
        return true;
      if (eventDay.getTime() === today.getTime())
        return timeText.includes('today') || timeText.includes('ago');
    }
  }

  return false;
}

async function extractLeaderboardLegacy(frame) {
  return frame.$$eval(
    '.rank-list-item',
    (items, { discardId, renameId, renameName }) => {
      const rows = items.map((el) => {
        const rankText = el.querySelector('.number')?.innerText ?? '';
        const parsedRank = Number.parseInt(rankText.replace(/\D+/g, ''), 10);

        let name = (el.querySelector('.name-text-a .ensure-space-if-empty')?.innerText ?? '')
          .replace(/\u00a0/g, ' ')
          .trim();
        const normalizedName = name.toLowerCase();

        const pointsText = el.querySelector('.primary-explaining-text-A')?.innerText ?? '';
        const pointsMatch = pointsText.match(/([\d,]+)/);
        const points = pointsMatch ? Number(pointsMatch[1].replace(/,/g, '')) : Number.NaN;

        const avatar = el.querySelector('.profile-picture img')?.src ?? '';
        const idMatch = avatar.match(/([0-9a-f]{32})/i);
        const playerId = idMatch ? idMatch[1] : '';
        if (playerId === discardId) return null;
        if (playerId === renameId) name = renameName;

        if (!name || Number.isNaN(points)) return null;
        const rank =
          normalizedName === 'all arenas' ? 0 : Number.isNaN(parsedRank) ? null : parsedRank;
        if (rank === null) return null;
        return { rank, name, points, playerId, avatar };
      }).filter(Boolean)

      const seen = new Set()
      const deduped = []
      rows.forEach((entry) => {
        const key = entry.playerId || `name:${entry.name}`
        if (!key || seen.has(key)) return
        seen.add(key)
        deduped.push(entry)
      })

      const arenas = []
      const others = []
      deduped.forEach((entry) => {
        const normalized = entry.name.trim().toLowerCase()
        if (normalized === 'all arenas') {
          entry.rank = 0
          arenas.push(entry)
        } else {
          others.push(entry)
        }
      })

      others.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points
        return a.name.localeCompare(b.name)
      })

      let currentRank = 0
      let previousPoints = null
      others.forEach((entry) => {
        if (previousPoints === null || entry.points !== previousPoints) {
          currentRank += 1
          previousPoints = entry.points
        }
        entry.rank = currentRank
      })

      return [...others, ...arenas]
    },
    {
      discardId: PLAYER_DISCARD_ID,
      renameId: PLAYER_RENAME_ID,
      renameName: '奕安',
    }
  );
}

async function extractLeaderboard(
  frame,
  { playerDirectory, apiPlayersByName, isFirstAccount },
) {
  const items = frame.locator('.rank-list-item');
  const itemCount = await items.count();
  const rows = [];
  let ignoredRows = 0;

  async function readShieldValue(row, template, readValue) {
    const iframe = row.locator(
      `iframe[src*="/overlay_views/templates/${template}.xml"]`,
    ).first();
    if (await iframe.count() === 0) return '';
    const shieldFrame = iframe.contentFrame();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const body = shieldFrame.locator('body');
      if (await body.count()) {
        const value = await readValue(body).catch(() => '');
        if (value) return value;
      }
      await frame.waitForTimeout(250);
    }
    return '';
  }

  async function readShieldName(row) {
    return readShieldValue(row, 'profile_name', async body =>
      normaliseWhitespace(await body.innerText({ timeout: 1000 })),
    );
  }

  async function readShieldAvatar(row) {
    return readShieldValue(row, 'profile_pic', body => body.evaluate(body => {
      const urls = [];
      for (const element of [body, ...body.querySelectorAll('*')]) {
        if (element instanceof HTMLImageElement && element.currentSrc)
          urls.push(element.currentSrc);
        const match = getComputedStyle(element).backgroundImage
          ?.match(/url\(["']?(.*?)["']?\)/);
        if (match?.[1]) urls.push(match[1]);
      }
      return urls.find(url => /[0-9a-f]{32}/i.test(url)) || urls[0] || '';
    }));
  }

  for (let index = 0; index < itemCount; index++) {
    const row = items.nth(index);
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await frame.waitForTimeout(300);

    const rankText = await row.locator('.number').innerText().catch(() => '');
    const parsedRank = Number.parseInt(rankText.replace(/\D+/g, ''), 10);
    const pointsText = await row.locator('.primary-explaining-text-A')
      .innerText()
      .catch(() => '');
    const pointsMatch = pointsText.match(/([\d,]+)/);
    const points = pointsMatch ? Number(pointsMatch[1].replace(/,/g, '')) : Number.NaN;
    const directName = await row.locator('.name-text-a')
      .innerText({ timeout: 1000 })
      .catch(() => '');
    const shieldName = normaliseWhitespace(directName) ? '' : await readShieldName(row);
    let name = normaliseWhitespace(directName) || shieldName;
    const initialName = name.toLocaleLowerCase();

    if (initialName === 'invite' && Number.isNaN(points)) {
      ignoredRows++;
      console.log(`Ignored invitation control at leaderboard DOM row ${index}.`);
      continue;
    }
    if (initialName === 'you' && points === 0) {
      ignoredRows++;
      continue;
    }

    let mappedPlayer = await resolveMappedPlayer(name, playerDirectory);
    if (initialName === 'you' && isFirstAccount) {
      name = SELF_PLAYER_NAME;
      mappedPlayer = playerDirectory.aliases.get(SELF_PLAYER_NAME.toLocaleLowerCase());
    }
    const apiPlayer = apiPlayersByName.get(name.toLocaleLowerCase());
    const rawAvatar = mappedPlayer || apiPlayer ? '' : await readShieldAvatar(row);
    const avatarId = rawAvatar.match(/([0-9a-f]{32})/i)?.[1] || '';
    const playerId = initialName === 'you' && isFirstAccount
      ? PLAYER_RENAME_ID
      : avatarId || mappedPlayer?.playerId || apiPlayer?.playerId || '';
    const avatar = /^https?:\/\//i.test(rawAvatar)
      ? rawAvatar
      : mappedPlayer?.avatar || apiPlayer?.avatar || '';
    if (playerId === PLAYER_DISCARD_ID) {
      ignoredRows++;
      continue;
    }
    const isSummary = ['all arenas', 'all players'].includes(name.toLocaleLowerCase());
    const rank = isSummary ? 0 : Number.isNaN(parsedRank) ? null : parsedRank;

    if (rank !== null && name && !Number.isNaN(points)) {
      rows.push({ rank, name, points, playerId, avatar });
    } else {
      console.warn('Skipped leaderboard DOM row:', {
        index,
        missing: [rank === null && 'rank', !name && 'name', Number.isNaN(points) && 'points']
          .filter(Boolean),
        rankText: normaliseWhitespace(rankText),
        pointsText: normaliseWhitespace(pointsText),
        directName: normaliseWhitespace(directName),
        shieldName,
        rowText: normaliseWhitespace(
          await row.innerText({ timeout: 1000 }).catch(() => ''),
        ),
      });
    }
  }

  const seen = new Set();
  const deduped = rows.filter(entry => {
    const key = entry.playerId || `name:${entry.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const summaries = deduped.filter(entry =>
    ['all arenas', 'all players'].includes(entry.name.toLocaleLowerCase()),
  );
  const others = deduped.filter(entry => !summaries.includes(entry));
  others.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  let currentRank = 0;
  let previousPoints = null;
  for (const entry of others) {
    if (previousPoints === null || entry.points !== previousPoints) currentRank++;
    previousPoints = entry.points;
    entry.rank = currentRank;
  }
  summaries.forEach(entry => { entry.rank = 0; });

  const expectedRows = itemCount - ignoredRows;
  console.log(`Extracted ${rows.length}/${expectedRows} leaderboard player rows.`);
  if (rows.length !== expectedRows)
    console.warn(`Skipped ${expectedRows - rows.length} player rows.`);
  return [...others, ...summaries];
}

async function readEventCardMetadata(card) {
  return card.evaluate(el => {
    const clean = value =>
      (value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

    const timeElement =
      el.querySelector('.cell-time .time-since') ?? null;
    console.log(`  Raw time element text: "${timeElement?.textContent ?? ''}"`);

    return {
      title: clean(el.querySelector('.cell-title')?.textContent),
      relativeTime: clean(timeElement?.textContent),
    };
  });
}

async function runForStorage(storagePath) {
  const STORAGE = path.resolve(storagePath);
  const isFirstAccount = STORAGE === FIRST_ACCOUNT_STORAGE;
  const playerDirectory = await loadPlayerMappings();
  const apiPlayersByName = new Map();

  function indexApiPlayers(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (!Array.isArray(value)) {
      const playerId = [value.playerId, value.userId, value.id]
        .find(candidate => typeof candidate === 'string' && /^[0-9a-f]{32}$/i.test(candidate));
      const name = [value.name, value.displayName, value.playerName, value.userName]
        .find(candidate => typeof candidate === 'string' && candidate.trim());
      const avatar = [value.avatar, value.avatarUrl, value.image, value.imageUrl,
        value.picture, value.profilePicture]
        .find(candidate => typeof candidate === 'string' && /^https?:\/\//i.test(candidate));
      if (playerId && name) {
        apiPlayersByName.set(normaliseWhitespace(name).toLocaleLowerCase(), {
          playerId,
          avatar: avatar || '',
        });
      }
    }
    for (const child of Object.values(value)) indexApiPlayers(child, seen);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STORAGE });
  const page = await context.newPage();
  page.on('response', response => {
    const responseUrl = response.url();
    if (responseUrl.includes('wordblitz-api') && !responseUrl.includes('/user/online')) {
      response.json().then(indexApiPlayers).catch(() => {});
    }
  });
  console.log('Opening Word Blitz lobby…');
  await page.goto(FB_APP_PLAY_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  // 等待幾秒確保畫面穩定並偵測推播通知要求的 overlay
  await page.waitForTimeout(5000);
  const notifyBtn = page.locator('div[role="alertdialog"][aria-label="推播通知要求"] button:has-text("關閉")');
  if (await notifyBtn.isVisible()) {
    await notifyBtn.click();
    console.log('✨ 已自動關閉推播通知要求。');
    await page.waitForTimeout(1000);
  }

  const iframeHandle = await page.waitForSelector('iframe#games_iframe_web', {
    timeout: 60000,
  });
  let frame = await attachToGameFrame(await iframeHandle.contentFrame());
  await dismissJoinRewardPopup(frame);
  console.log('Game iframe ready.');

  await frame.waitForSelector('.cell-event', { timeout: 90000 });
  console.log('Event list detected.');

  const existingEvents = await readExistingEvents(OUTPUT_JSON);
  const events = [];
  let index = 0;

  while (true) {
    await frame.waitForSelector('.cell-event', { timeout: 60000 });
    const cards = await frame.$$('.cell-event');
    if (index >= cards.length) break;

    const card = cards[index];
    const metadata = await readEventCardMetadata(card);
    console.log(` Event ${index + 1}/${cards.length} metadata:`, metadata);
    const title = normaliseWhitespace(metadata.title);
    const eventDate =
      parseRelativeDate(metadata.relativeTime) ??
      'unknown';
    const closed = isEventClosed(metadata, eventDate);

    if (!closed) {
      console.log(
        `Skipping open event ${index + 1}/${cards.length}: ${title || 'Unknown'
        }`
      );
      index++;
      continue;
    }

    console.log(
      `Processing event ${index + 1}/${cards.length}: ${title || 'Unknown'} (${eventDate})`
    );

    await card.scrollIntoViewIfNeeded().catch(() => { });
    const clickSucceeded = await card
      .click()
      .then(() => true)
      .catch(err => {
        console.warn(`Unable to open "${title || 'Unknown'}": ${err.message}`);
        return false;
      });
    if (!clickSucceeded) {
      index++;
      continue;
    }

    const allArenasBtn = await frame.$(
      '.btn:has-text("All players"), .btn:has-text("All arenas")',
    );
    if (allArenasBtn) {
      await allArenasBtn.click().catch(() => { });
      await sleep(2000);
    }

    await frame.waitForSelector('.rank-list-item', { timeout: 60000 });
    await sleep(1000);

    const rankings = await extractLeaderboard(frame, {
      playerDirectory,
      apiPlayersByName,
      isFirstAccount,
    });
    console.log(
      `  → captured ${rankings.length} player(s) for ${title || 'Unknown'
      } (${eventDate})`,
    );
    events.push({
      date: eventDate,
      name: title,
      rankings,
    });

    const backBtn = await frame.$('.icon-back');
    if (backBtn) {
      await backBtn.click();
      await frame.waitForSelector('.cell-event', { timeout: 60000 });
      await sleep(1000);
    } else {
      console.warn('Back button missing; reloading to restore event list.');
      await page.reload({ waitUntil: 'domcontentloaded' });
      const newIframeHandle = await page.waitForSelector('iframe#games_iframe_web', {
        timeout: 60000,
      });
      frame = await attachToGameFrame(await newIframeHandle.contentFrame());
      await dismissJoinRewardPopup(frame);
      await frame.waitForSelector('.cell-event', { timeout: 60000 });
      await sleep(1000);
    }

    index++;
  }

  const mergedEvents = mergeEventsByDate(existingEvents, events);
  await fs.writeFile(
    OUTPUT_JSON,
    JSON.stringify(mergedEvents, null, 2),
    'utf8'
  );
  console.log(`Saved ${mergedEvents.length} events to ${OUTPUT_JSON}`);
  await browser.close();
}

(async () => {
  for (const storagePath of STORAGE_PATHS) {
    try {
      await runForStorage(storagePath);
    } catch (err) {
      console.error(`Failed for ${storagePath}:`, err);
    }
  }
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
