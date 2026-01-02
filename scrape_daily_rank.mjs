// scrape_wordblitz_auto.mjs
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const FB_APP_PLAY_URL =
  'https://www.facebook.com/gaming/play/2211386328877300/';

const storage_paths = ['./storage_state.json', './storage_state2.json'];

function normaliseWhitespace(value) {
  if (!value) return '';
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
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

async function runForStorage(storage_path) {
  const STORAGE = path.resolve(storage_path);
  const CSV = path.resolve('./daily_scores.csv');
  const PLAYER_RENAME_ID = '98610e86acb0a629da17f0993ec0fd50';
  const PLAYER_DISCARD_ID = '139aeeddeccb7d58d846dd92803b02fa';

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
          if (parsed.playerId === PLAYER_DISCARD_ID) return;
          if (parsed.playerId === PLAYER_RENAME_ID) parsed.name = '奕安';
          const key = `${parsed.dailyDate}:${parsed.playerId}`;
          records.set(key, parsed);
        });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    let inserted = 0;
    for (const row of rows) {
      if (row.playerId === PLAYER_DISCARD_ID) continue;
      const key = `${dailyDate}:${row.playerId}`;
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
        if (entry.name === 'All arenas') {
          entry.rank = '';
          continue;
        }
        if (previousPoints === null || entry.points !== previousPoints) {
          currentRank += 1;
          previousPoints = entry.points;
        }
        entry.rank = String(currentRank);
        finalRows.push(entry);
      }
      // Ensure "All arenas" rows (if any) still persist at end for date
      const arenas = group.filter((entry) => entry.name === 'All arenas');
      arenas.forEach((entry) => {
        entry.rank = '';
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
    return await frame.$$eval('.rank-list-item', items => {
      const rows = [];
      for (const el of items) {
        const rank = el.querySelector('.number')?.innerText.trim().replace(/\D+/g, '') || '';
        const name = el.querySelector('.name-text-a .ensure-space-if-empty')?.innerText.trim() || '';
        const ptsText = el.querySelector('.primary-explaining-text-A')?.innerText.trim() || '';
        const ptsMatch = ptsText.match(/([\d,]+)/);
        const points = ptsMatch ? ptsMatch[1].replace(/,/g, '') : '';

        const avatar = el.querySelector('.profile-picture img')?.src || '';
        const idMatch = avatar.match(/([0-9a-f]{32})/i);
        const playerId = idMatch ? idMatch[1] : '';

        if (rank && name && points)
          rows.push({ rank, name, points, playerId, avatar });
      }
      return rows;
    });
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
  const frame = await iframeHandle.contentFrame();
  console.log('✅ 已附著到遊戲 iframe。');

  // 等待主畫面載入
  console.log('⏳ 等待 Daily Game 區塊載入…');
  await frame.waitForSelector('.cell-daily', { timeout: 90000 });
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
    console.table(data.slice(0, 5));
    await ensureCsvHeader();
    await appendCsv(data, dailyDate);

    // 回前頁
    const backBtn = await frame.$('.icon.icon-back');
    if (backBtn) {
      console.log('↩️ 返回主畫面…');
      await backBtn.click();
      await frame.waitForSelector('.cell-daily', { timeout: 60000 });
      await frame.waitForTimeout(1500);
    } else {
      console.warn('⚠️ 找不到返回按鈕，嘗試刷新 Daily 列表');
      await page.reload({ waitUntil: 'domcontentloaded' });
      const newIframe = await page.waitForSelector('iframe#games_iframe_web', { timeout: 60000 });
      const newFrame = await newIframe.contentFrame();
      await newFrame.waitForSelector('.cell-daily', { timeout: 60000 });
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
