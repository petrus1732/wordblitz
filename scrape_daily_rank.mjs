// scrape_wordblitz_auto.mjs
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const FB_APP_PLAY_URL =
  'https://www.facebook.com/gaming/play/2211386328877300/';

const storage_paths = ['./storage_state.json', './storage_state2.json'];
const PLAYERS_CSV = path.resolve('./players.csv');
const FIRST_ACCOUNT_STORAGE = path.resolve('./storage_state.json');
const SELF_PLAYER_ID = '98610e86acb0a629da17f0993ec0fd50';
const SELF_PLAYER_NAME = '陳奕安';

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
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && raw[index + 1] === '\n') index++;
      row.push(field);
      if (row.some(value => value.length > 0)) table.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
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
      if (existing && existing.playerId !== profile.playerId) {
        aliases.set(key, null);
      } else if (existing !== null) {
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

async function readDailyCardMetadata(card) {
  return card.evaluate((el) => {
    const clean = (value) =>
      (value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const title = clean(
      el.querySelector('.cell-title')?.textContent ??
      el.querySelector('.cell-body .title')?.textContent ??
      '',
    );
    const relativeTime = clean(
      el.querySelector('.cell-time .time-since')?.textContent ?? '',
    );
    return { title, relativeTime };
  });
}

function isDailyClosed(metadata) {
  const text = normaliseWhitespace(metadata?.relativeTime).toLowerCase();
  if (!text) return false;
  return !text.includes('left');
}

async function writeDailyDebugArtifacts(page, frame, storagePath) {
  const accountName = path.basename(storagePath, path.extname(storagePath));
  const prefix = path.resolve(`debug-daily-${accountName}`);
  const frameText = await frame.locator('body').innerText().catch(() => '');
  const frameHtml = await frame.locator('body').innerHTML().catch(() => '');
  const selectorCounts = {};

  for (const selector of [
    '.cell-daily',
    '.cell-event',
    '.cell-game',
    '.loader',
    '[role="dialog"]',
    '.error-dialog',
    '.error',
  ]) {
    selectorCounts[selector] = await frame.locator(selector).count().catch(() => -1);
  }

  const summary = {
    storagePath,
    pageUrl: page.url(),
    frameUrl: frame.url(),
    pageTitle: await page.title().catch(() => ''),
    selectorCounts,
    frameText: frameText.slice(0, 10000),
  };

  await fs.writeFile(`${prefix}.json`, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await fs.writeFile(`${prefix}.html`, frameHtml, 'utf8');
  await page.screenshot({ path: `${prefix}.png`, fullPage: true });
  console.error(`🧪 Debug artifacts written: ${prefix}.{json,html,png}`);
  console.error('🧪 Debug summary:', summary);
}

async function attachToGameFrame(outerFrame) {
  if (!outerFrame) throw new Error('Unable to resolve the outer game iframe.');
  const bundleHandle = await outerFrame.waitForSelector(
    'iframe[name="game-bundle"]',
    { timeout: 90000 },
  );
  const gameFrame = await bundleHandle.contentFrame();
  if (!gameFrame) throw new Error('Unable to resolve the nested game iframe.');
  console.log('✅ 已附著到遊戲內容 iframe。');
  return gameFrame;
}

async function dismissJoinRewardPopup(frame, timeout = 10000) {
  const loseRewardsButton = frame
    .locator('.secondary-button', { hasText: 'Lose rewards' })
    .first();
  const appeared = await loseRewardsButton
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);

  if (!appeared) return false;

  await loseRewardsButton.click({ force: true });
  await loseRewardsButton
    .waitFor({ state: 'hidden', timeout: 10000 })
    .catch(() => {});
  console.log('Dismissed the optional join-reward popup via "Lose rewards".');
  return true;
}

async function runForStorage(storage_path) {
  const STORAGE = path.resolve(storage_path);
  const CSV = path.resolve('./daily_scores.csv');
  const PLAYER_RENAME_ID = SELF_PLAYER_ID;
  const PLAYER_DISCARD_ID = '139aeeddeccb7d58d846dd92803b02fa';
  const apiPlayersByName = new Map();
  const playerDirectory = await loadPlayerMappings();
  const mappedPlayersByName = playerDirectory.aliases;
  const isFirstAccount = STORAGE === FIRST_ACCOUNT_STORAGE;

  function isEmptyYouRow(row) {
    return normaliseWhitespace(row.name).toLocaleLowerCase() === 'you' &&
      Number(row.points) === 0;
  }

  function replaceFirstAccountYou(row, allowHistoricalMigration = false) {
    const isYou = normaliseWhitespace(row.name).toLocaleLowerCase() === 'you';
    if (!isYou || Number(row.points) === 0 || (!isFirstAccount && !allowHistoricalMigration))
      return row;

    const selfProfile = mappedPlayersByName.get(SELF_PLAYER_NAME.toLocaleLowerCase());
    row.name = SELF_PLAYER_NAME;
    row.playerId = SELF_PLAYER_ID;
    row.avatar = selfProfile?.avatar || row.avatar || '';
    return row;
  }

  function indexApiPlayers(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);

    if (!Array.isArray(value)) {
      const id = [value.playerId, value.userId, value.id]
        .find(candidate => typeof candidate === 'string' && /^[0-9a-f]{32}$/i.test(candidate));
      const name = [value.name, value.displayName, value.playerName, value.userName]
        .find(candidate => typeof candidate === 'string' && candidate.trim());
      const avatar = [value.avatar, value.avatarUrl, value.image, value.imageUrl,
        value.picture, value.profilePicture]
        .find(candidate => typeof candidate === 'string' && /^https?:\/\//i.test(candidate));
      if (id && name) {
        const key = normaliseWhitespace(name).toLocaleLowerCase();
        apiPlayersByName.set(key, { playerId: id, avatar: avatar || '' });
      }
    }

    for (const child of Object.values(value)) indexApiPlayers(child, seen);
  }

  function parseCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    values.push(current);

    if (values.length < 6)
      return null;

    const [dailyDate, rank, playerId, name, points, avatarUrl] = values;
    return {
      dailyDate,
      rank,
      playerId,
      name,
      points: Number(points) || 0,
      avatar: avatarUrl || '',
    };
  }

  function serializeCsvRow(row) {
    const safeName = row.name.replaceAll('"', '""');
    return `${row.dailyDate},${row.rank},${row.playerId},"${safeName}",${row.points},${row.avatar}`;
  }

  // 建立 CSV 檔頭
  async function ensureCsvHeader() {
    try { await fs.access(CSV); } catch {
      await fs.writeFile(CSV, 'dailyDate,rank,playerId,name,points,avatarUrl\n', 'utf8');
    }
  }

  // 寫入 CSV
  async function appendCsv(rows, dailyDate) {
    await ensureCsvHeader();

    const records = new Map();
    try {
      const existing = await fs.readFile(CSV, 'utf8');
      existing
        .split(/\r?\n/)
        .slice(1)
        .forEach(line => {
          if (!line) return;
          const parsed = parseCsvLine(line);
          if (!parsed) return;
          if (isEmptyYouRow(parsed)) return;
          replaceFirstAccountYou(parsed, true);
          if (parsed.playerId === PLAYER_DISCARD_ID) return;
          if (parsed.playerId === PLAYER_RENAME_ID) parsed.name = '奕安';
          const identity = parsed.playerId || `name:${parsed.name}`;
          const key = `${parsed.dailyDate}:${identity}`;
          records.set(key, parsed);
        });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    const historicalPlayersByName = new Map();
    for (const record of records.values()) {
      if (record.playerId && record.name) {
        historicalPlayersByName.set(
          normaliseWhitespace(record.name).toLocaleLowerCase(),
          { playerId: record.playerId, avatar: record.avatar || '' },
        );
      }
    }

    let inserted = 0;
    for (const row of rows) {
      if (isEmptyYouRow(row)) continue;
      replaceFirstAccountYou(row);
      const historicalPlayer = historicalPlayersByName.get(
        normaliseWhitespace(row.name).toLocaleLowerCase(),
      );
      if (!row.playerId) row.playerId = historicalPlayer?.playerId || '';
      if (!row.avatar) row.avatar = historicalPlayer?.avatar || '';
      if (row.playerId === PLAYER_DISCARD_ID) continue;
      if (row.playerId) records.delete(`${dailyDate}:name:${row.name}`);
      const identity = row.playerId || `name:${row.name}`;
      const key = `${dailyDate}:${identity}`;
      const next = {
        dailyDate,
        playerId: row.playerId,
        name: row.playerId === PLAYER_RENAME_ID ? '奕安' : row.name,
        points: Number(row.points) || 0,
        avatar: row.avatar || '',
        rank: '',
      };
      if (!records.has(key)) inserted++;
      records.set(key, next);
    }

    const grouped = new Map();
    for (const record of records.values()) {
      if (!grouped.has(record.dailyDate))
        grouped.set(record.dailyDate, []);
      grouped.get(record.dailyDate).push(record);
    }

    const sortedDates = Array.from(grouped.keys()).sort();
    const finalRows = [];
    for (const date of sortedDates) {
      const group = grouped.get(date);
      group.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return a.name.localeCompare(b.name);
      });
      let currentRank = 0;
      let previousPoints = null;
      for (const entry of group) {
        if (entry.name === 'All arenas' || entry.name === 'All Players') {
          entry.rank = '0';
          continue;
        }
        if (previousPoints === null || entry.points !== previousPoints) {
          currentRank += 1;
          previousPoints = entry.points;
        }
        entry.rank = String(currentRank);
        finalRows.push(entry);
      }
      // Ensure summary rows still persist at the end for each date.
      const arenas = group.filter(
        (entry) => entry.name === 'All arenas' || entry.name === 'All Players',
      );
      arenas.forEach((entry) => {
        entry.rank = '0';
        finalRows.push(entry);
      });
    }

    const header = 'dailyDate,rank,playerId,name,points,avatarUrl\n';
    const data = finalRows.map(serializeCsvRow).join('\n');
    await fs.writeFile(CSV, header + (data ? `${data}\n` : ''), 'utf8');

    if (!inserted) {
      console.log(`⚠️ ${dailyDate} 沒有新排行資料，略過寫入。`);
    } else {
      console.log(`✅ 已更新 ${inserted} 筆新排行資料，並重新排序所有資料。`);
    }
  }


  // 解析排行榜
  async function extractLeaderboard(frame) {
    const items = frame.locator('.rank-list-item');
    const itemCount = await items.count();
    const rows = [];
    let ignoredControlRows = 0;

    async function readOverlayText(row, templateName) {
      const overlay = row.locator(
        `iframe[src*="/overlay_views/templates/${templateName}.xml"]`,
      ).first();
      if (await overlay.count() === 0) return '';

      const overlayFrame = overlay.contentFrame();
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const text = await overlayFrame.locator('body')
          .innerText({ timeout: 1000 })
          .catch(() => '');
        const cleaned = normaliseWhitespace(text);
        if (cleaned) return cleaned;
        await frame.waitForTimeout(250);
      }
      return '';
    }

    async function readOverlayAvatar(row) {
      const overlay = row.locator(
        'iframe[src*="/overlay_views/templates/profile_pic.xml"]',
      ).first();
      if (await overlay.count() === 0) return '';

      const overlayFrame = overlay.contentFrame();
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const body = overlayFrame.locator('body');
        if (await body.count() === 0) {
          await frame.waitForTimeout(250);
          continue;
        }
        const urls = await body.evaluate((body) => {
          const found = [];
          for (const element of [body, ...body.querySelectorAll('*')]) {
            if (element instanceof HTMLImageElement && element.currentSrc)
              found.push(element.currentSrc);
            const background = getComputedStyle(element).backgroundImage;
            const match = background?.match(/url\(["']?(.*?)["']?\)/);
            if (match?.[1]) found.push(match[1]);
          }
          return found;
        }).catch(() => []);
        const avatar = urls.find(url => /[0-9a-f]{32}/i.test(url)) || urls[0] || '';
        if (avatar) return avatar;
        await frame.waitForTimeout(250);
      }
      return '';
    }

    for (let index = 0; index < itemCount; index++) {
      const row = items.nth(index);
      await row.scrollIntoViewIfNeeded().catch(() => {});
      await frame.waitForTimeout(300);

      const rankText = await row.locator('.number').innerText().catch(() => '');
      const rank = rankText.trim().replace(/\D+/g, '');
      const pointsText = await row.locator('.primary-explaining-text-A')
        .innerText()
        .catch(() => '');
      const pointsMatch = pointsText.match(/([\d,]+)/);
      const points = pointsMatch ? pointsMatch[1].replace(/,/g, '') : '';

      const directName = await row.locator('.name-text-a')
        .innerText({ timeout: 1000 })
        .catch(() => '');
      const overlayName = normaliseWhitespace(directName)
        ? ''
        : await readOverlayText(row, 'profile_name');
      const name = normaliseWhitespace(directName) || overlayName;
      const isInviteControl = name.toLocaleLowerCase() === 'invite' && !points;
      if (isInviteControl) {
        ignoredControlRows++;
        console.log(`Ignored invitation control at leaderboard DOM row ${index}.`);
        continue;
      }
      const mappedPlayer = await resolveMappedPlayer(name, playerDirectory);
      const apiPlayer = apiPlayersByName.get(name.toLocaleLowerCase());
      const rawAvatar = mappedPlayer || apiPlayer ? '' : await readOverlayAvatar(row);
      const idMatch = rawAvatar.match(/([0-9a-f]{32})/i);
      const playerId = idMatch
        ? idMatch[1]
        : mappedPlayer?.playerId || apiPlayer?.playerId || '';
      const avatar = /^https?:\/\//i.test(rawAvatar)
        ? rawAvatar
        : mappedPlayer?.avatar || apiPlayer?.avatar || '';

      if (rank && name && points) {
        rows.push({ rank, name, points, playerId, avatar });
      } else {
        const rowText = normaliseWhitespace(
          await row.innerText({ timeout: 1000 }).catch(() => ''),
        );
        const profileNameFrames = await row
          .locator('iframe[src*="/profile_name.xml"]')
          .count()
          .catch(() => -1);
        const profilePictureFrames = await row
          .locator('iframe[src*="/profile_pic.xml"]')
          .count()
          .catch(() => -1);
        console.warn('Skipped leaderboard DOM row:', {
          index,
          missing: [
            !rank && 'rank',
            !name && 'name',
            !points && 'points',
          ].filter(Boolean),
          rankText: normaliseWhitespace(rankText),
          pointsText: normaliseWhitespace(pointsText),
          directName: normaliseWhitespace(directName),
          overlayName,
          profileNameFrames,
          profilePictureFrames,
          rowText,
        });
      }
    }

    const expectedPlayerRows = itemCount - ignoredControlRows;
    console.log(`Extracted ${rows.length}/${expectedPlayerRows} leaderboard player rows.`);
    if (rows.length !== expectedPlayerRows)
      console.warn(`Skipped ${expectedPlayerRows - rows.length} player rows whose protected profile data did not load.`);
    return rows;
  }

  // 從遊戲內判斷當前 daily 日期
  async function detectDailyDate(frame) {
    // 若是進行中：有 countdown
    const countdownExists = await frame.$('.expiration-countdown');
    if (countdownExists) {
      const fields = await frame.$$eval('.expiration-countdown .count-down-field', els =>
        els.map(e => e.innerText.trim())
      );
      console.log(`🕒 進行中 Countdown: ${fields.join(':')}`);
      const now = new Date();
      return now.toISOString().slice(0, 10);
    }

    // 否則抓月/日
    const month = await frame.$eval('.month', el => el.innerText.trim()).catch(() => '');
    const day = await frame.$eval('.day', el => el.innerText.trim()).catch(() => '');
    console.log(`📅 偵測到 Monthly label: ${month} ${day}`);
    if (month && day) {
      const now = new Date();
      const currentYear = now.getFullYear();
      let d = new Date(`${month} ${day}, ${currentYear}`);

      // 若計算出的日期在未來（例如現在是 1 月，標籤是 12/31），則表示是去年的
      if (!isNaN(+d) && d > now) {
        d.setFullYear(currentYear - 1);
        console.log(`🔄 日期在未來，調整年份為 ${d.getFullYear()}`);
      }

      if (!isNaN(+d)) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
    }


    return 'unknown';
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STORAGE });
  const page = await context.newPage();

  page.on('console', (message) => {
    const text = message.text();
    if (
      message.type() === 'warning' &&
      text.includes('was preloaded using link preload')
    ) {
      return;
    }
    console.log(`[browser:${message.type()}] ${text}`);
  });

page.on('pageerror', (error) => {
  console.error('[pageerror]', error.message);
});

page.on('requestfailed', (request) => {
    const requestUrl = request.url();
    if (
      requestUrl.includes('google.com/measurement/conversion') ||
      requestUrl.includes('google.com.tw/ads/ga-audiences') ||
      requestUrl.includes('analytics.google.com/g/collect')
    ) {
      return;
    }
  console.error('[requestfailed]', request.url(), request.failure()?.errorText);
});

page.on('response', (response) => {
    const responseUrl = response.url();
    if (
      responseUrl.includes('wordblitz-api') &&
      !responseUrl.includes('/user/online')
    ) {
      console.log('[api]', response.status(), responseUrl);
      response.json()
        .then(payload => indexApiPlayers(payload))
        .catch(() => {});
  }
});

  console.log('🚀 開啟 Word Blitz 主畫面…');
  await page.goto(FB_APP_PLAY_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // 等待幾秒確保畫面穩定並偵測推播通知要求的 overlay
  await page.waitForTimeout(5000);
  const notifyBtn = page.locator('div[role="alertdialog"][aria-label="推播通知要求"] button:has-text("關閉")');
  if (await notifyBtn.isVisible()) {
    await notifyBtn.click();
    console.log('✨ 已自動關閉推播通知要求。');
    await page.waitForTimeout(1000);
  }

  const iframeHandle = await page.waitForSelector('iframe#games_iframe_web', { timeout: 60000 });
  let frame = await attachToGameFrame(await iframeHandle.contentFrame());
  await dismissJoinRewardPopup(frame);

  // 等待主畫面載入
  console.log('⏳ 等待 Daily Game 區塊載入…');
  try {
    await frame.waitForSelector('.cell-daily', { timeout: 90000 });
  } catch (error) {
    await writeDailyDebugArtifacts(page, frame, storage_path);
    await browser.close();
    throw error;
  }
  console.log('✅ 主畫面載入完成。');

  // 取得所有 Daily cards（通常是 5–6 個）
  const dailyCards = await frame.$$('.cell-daily');
  console.log(`📅 偵測到 ${dailyCards.length} 個 Daily Game。`);

  for (let i = 0; i < dailyCards.length; i++) {
    console.log(`\n▶️ 正在處理第 ${i + 1}/${dailyCards.length} 個 Daily…`);
    const card = dailyCards[i];

    const metadata = await readDailyCardMetadata(card).catch(() => null);
    if (!metadata || !isDailyClosed(metadata)) {
      console.log(
        `Skipping open daily ${i + 1}/${dailyCards.length}: ${metadata?.title || 'Unknown'
        } (${metadata?.relativeTime || 'unknown'})`,
      );
      continue;
    }

    await card.scrollIntoViewIfNeeded().catch(() => { });
    await card.click().catch(() => console.warn('⚠️ 點擊 Daily 失敗，嘗試繼續。'));

    // 點擊 All arenas（若有）
    const allArenasBtn = await frame.$(
      '.btn:has-text("All players"), .btn:has-text("All arenas")',
    );
    if (allArenasBtn) {
      console.log('🎮 點擊 All arenas...');
      await allArenasBtn.click().catch(() => console.warn('⚠️ 點擊 All arenas 失敗'));
      await frame.waitForTimeout(3000);
    }

    // 等排行榜載入
    await frame.waitForSelector('.rank-list-item', { timeout: 60000 });
    await frame.waitForTimeout(1000);

    const dailyDate = await detectDailyDate(frame);
    console.log(`📆 當前 Daily 日期：${dailyDate}`);

    const data = await extractLeaderboard(frame);
    // add Kitniti's score on Jan 3rd manually
    if (dailyDate === '2026-01-03') {
      data.push({
        rank: '',
        name: 'Kitniti',
        points: 1847,
        playerId: 'f33247461c13011c6c8465f7aed94ddc',
        avatar: 'https://storage.googleapis.com/wbuserimages/prod/24453968-f33247461c13011c6c8465f7aed94ddc',
      });
      console.log('➕ 已手動加入 Kitniti 的分數。');
    }

    console.table(data.slice(0, 5));
    await ensureCsvHeader();
    await appendCsv(data, dailyDate);

    // 回前頁
    await frame.waitForTimeout(1500);
    const backBtn = await frame.$('.icon-back');
    if (backBtn) {
      console.log('↩️ 返回主畫面…');
      await backBtn.click();
      await frame.waitForSelector('.cell-daily', { timeout: 60000 });
      await frame.waitForTimeout(1500);
    } else {
      console.warn('⚠️ 找不到返回按鈕，嘗試刷新 Daily 列表');
      await page.reload({ waitUntil: 'domcontentloaded' });
      const newIframe = await page.waitForSelector('iframe#games_iframe_web', { timeout: 60000 });
      frame = await attachToGameFrame(await newIframe.contentFrame());
      await dismissJoinRewardPopup(frame);
      await frame.waitForSelector('.cell-daily', { timeout: 60000 });
    }
  }
  console.log('🎉 所有 Daily Game 已處理完畢！');
  await browser.close();
}

; (async () => {
  for (const storagePath of storage_paths) {
    try {
      await runForStorage(storagePath);
    } catch (err) {
      console.error(`Failed for ${storagePath}:`, err);
    }
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
