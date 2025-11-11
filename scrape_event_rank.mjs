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
      const adjustedQuantity = quantity + 1; // in-game daily summaries lag by one day
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
    const year = yearText ? Number.parseInt(yearText, 10) : base.getFullYear();
    if (monthIndex !== undefined && !Number.isNaN(day) && !Number.isNaN(year)) {
      const resolved = new Date(year, monthIndex, day);
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

  merged.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return
    const playerId = entry.playerId || `name:${entry.name || 'Unknown'}`
    const key = `${playerId}:${entry.points ?? ''}:${entry.rank ?? ''}`
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

  deduped.forEach((entry, index) => {
    entry.rank = index + 1
  })

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

async function extractLeaderboard(frame) {
  return frame.$$eval(
    '.rank-list-item',
    (items, { discardId, renameId, renameName }) =>
      items
      .map(el => {
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
      })
        .filter(Boolean),
    {
      discardId: PLAYER_DISCARD_ID,
      renameId: PLAYER_RENAME_ID,
      renameName: '奕安',
    }
  );
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
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STORAGE });
  const page = await context.newPage();
  console.log('Opening Word Blitz lobby…');
  await page.goto(FB_APP_PLAY_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  const iframeHandle = await page.waitForSelector('iframe#games_iframe_web', {
    timeout: 60000,
  });
  let frame = await iframeHandle.contentFrame();
  if (!frame) throw new Error('Unable to resolve game iframe.');
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
        `Skipping open event ${index + 1}/${cards.length}: ${
          title || 'Unknown'
        }`
      );
      index++;
      continue;
    }

    console.log(
      `Processing event ${index + 1}/${cards.length}: ${title || 'Unknown'} (${eventDate})`
    );

    await card.scrollIntoViewIfNeeded().catch(() => {});
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

    const allArenasBtn = await frame.$('.btn:has-text("All arenas")');
    if (allArenasBtn) {
      await allArenasBtn.click().catch(() => {});
      await frame.waitForTimeout(2000);
    }

    await frame.waitForSelector('.rank-list-item', { timeout: 60000 });
    await frame.waitForTimeout(1000);

    const rankings = await extractLeaderboard(frame);
    console.log(
      `  → captured ${rankings.length} player(s) for ${
        title || 'Unknown'
      } (${eventDate})`,
    );
    events.push({
      date: eventDate,
      name: title, 
      rankings,
    });

    const backBtn = await frame.$('.icon.icon-back');
    if (backBtn) {
      await backBtn.click();
      await frame.waitForSelector('.cell-event', { timeout: 60000 });
      await frame.waitForTimeout(1000);
    } else {
      console.warn('Back button missing; reloading to restore event list.');
      await page.reload({ waitUntil: 'domcontentloaded' });
      const newIframeHandle = await page.waitForSelector('iframe#games_iframe_web', {
        timeout: 60000,
      });
      frame = await newIframeHandle.contentFrame();
      if (!frame) throw new Error('Unable to reacquire iframe after reload.');
      await frame.waitForSelector('.cell-event', { timeout: 60000 });
      await frame.waitForTimeout(1000);
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
