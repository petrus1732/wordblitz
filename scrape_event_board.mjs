// scrape_wordblitz_board_v2.mjs
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';

const FB_APP_PLAY_URL = 'https://www.facebook.com/gaming/play/2211386328877300/';
const STORAGE = path.resolve('./storage_state2.json');
const JSON_PATH = path.resolve('./event_details.json');

// 寫入 JSON
async function saveJson(data) {
  const prev = await fs.readFile(JSON_PATH, 'utf8').catch(() => '[]');
  const all = JSON.parse(prev);
  all.push(data);
  await fs.writeFile(JSON_PATH, JSON.stringify(all, null, 2), 'utf8');
  console.log(`💾 已寫入 ${JSON_PATH}`);
}

// UTC 日期計算：取得 n 天前的日期 (YYYY-MM-DD)
function getDateNDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// 全域資料容器
const data = {
  eventName: 'blitz round',
  boards: []
};

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function dismissPostGameOverlays(page) {
  const shareDialog = page.locator('[role="dialog"]')
    .filter({ hasText: /Here's where you landed|Share your score|表現很棒|分享.*分數/i })
    .last();
  const dialogClose = shareDialog.locator([
    '[aria-label="關閉"]',
    '[aria-label="Close"]',
    '[aria-label*="關閉分享"]',
    '[aria-label*="Close share"]',
  ].join(', ')).first();
  const fallbackShareClose = page.locator([
    '[aria-label="關閉分享對話方塊"]',
    '[aria-label="Close share dialog"]',
  ].join(', ')).first();
  const adClose = page.locator([
    '[aria-label="關閉廣告"]',
    '[aria-label="Close ad"]',
  ].join(', ')).first();

  for (const closeButton of [dialogClose, fallbackShareClose, adClose]) {
    if (await closeButton.isVisible().catch(() => false)) {
      const label = await closeButton.getAttribute('aria-label').catch(() => null);
      await closeButton.click({ force: true });
      console.log(`✨ 已關閉 Facebook 覆蓋層${label ? ` (${label})` : ''}。`);
      await sleep(1000);
      return true;
    }
  }

  return false;
}

async function waitForPostGameOverlayOrResults(page, frame, timeout = 90000) {
  const deadline = Date.now() + timeout;
  console.log('⏳ 等待分享對話或遊戲結果出現...');

  while (Date.now() < deadline) {
    if (await dismissPostGameOverlays(page)) return;

    const resultReady = await frame.locator('.duel-result-row, .btn')
      .filter({ hasText: /All words/i })
      .first()
      .isVisible()
      .catch(() => false);
    if (resultReady) return;

    await sleep(1000);
  }

  console.log('⏳ 尚未看到分享對話；繼續在結果載入階段監看。');
}

async function waitForEventWords(page, frame, timeout = 180000) {
  const deadline = Date.now() + timeout;
  const allWordsBtn = frame.locator('.btn', { hasText: 'All words' }).first();
  const wordCells = frame.locator('.duel-result-row .word span');
  let clickedAllWords = false;
  let loggedServerWait = false;

  while (Date.now() < deadline) {
    await dismissPostGameOverlays(page);

    const words = (await wordCells.allInnerTexts().catch(() => []))
      .map(word => word.trim())
      .filter(Boolean);
    if (words.length > 0) return { words, wordCells };

    if (!clickedAllWords && await allWordsBtn.isVisible().catch(() => false)) {
      const clicked = await allWordsBtn.click({ force: true })
        .then(() => true)
        .catch(() => false);
      if (clicked) {
        console.log('📝 已點擊「All words」。等待字詞列表載入...');
        clickedAllWords = true;
      }
    } else if (!loggedServerWait && await frame.locator('.loader').isVisible().catch(() => false)) {
      console.log('⏳ 遊戲已結束，但伺服器仍在載入結果；將繼續等待...');
      loggedServerWait = true;
    }

    await sleep(2000);
  }

  throw new Error(`Timed out after ${Math.round(timeout / 1000)} seconds waiting for event words.`);
}

async function debugMissingEventWords(page, frame, date, dayIndex) {
  const prefix = `debug-event-words-${date}-day${dayIndex}`;
  const frameText = await frame.locator('body').innerText().catch(() => '');
  const frameHtml = await frame.locator('body').innerHTML().catch(() => '');
  const selectors = [
    '.duel-result-row',
    '.duel-result-row .word span',
    '.letter-grid .core-letter-cell',
    '.button-primary',
    '.btn',
    '.icon-back',
  ];
  const selectorCounts = {};
  for (const selector of selectors) {
    selectorCounts[selector] = await frame.locator(selector).count().catch(() => -1);
  }

  const summary = {
    date,
    dayIndex,
    pageUrl: page.url(),
    frameUrl: frame.url(),
    selectorCounts,
    frameText: frameText.slice(0, 12000),
  };

  await fs.writeFile(`${prefix}.json`, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await fs.writeFile(`${prefix}.html`, frameHtml, 'utf8');
  await page.screenshot({ path: `${prefix}.png`, fullPage: true });
  console.error(`🧪 Missing-word diagnostics written: ${prefix}.{json,html,png}`);
  console.error('🧪 Missing-word summary:', summary);
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

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STORAGE });
  const page = await context.newPage();

  console.log('🚀 開啟 Word Blitz 遊戲頁...');
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
  const frame = await attachToGameFrame(await iframeHandle.contentFrame());
  console.log('✅ 已附著到遊戲內容 iframe。');

  // --- 自動進入即將結束的賽事 ---
  console.log('🔍 正在尋找即將結束的賽事 (剩餘時間包含 "hour")...');
  try {
    // 1. 定位目標賽事：尋找 .cell-event.clickable 且其內部的 .time-remaining 包含 "hour"
    const eventLocator = frame.locator('.cell-event.clickable', {
      has: frame.locator('.time-remaining', { hasText: 'hour' })
    }).first();

    await eventLocator.waitFor({ state: 'visible', timeout: 30000 });

    // 2. 擷取賽事名稱
    const titleEl = eventLocator.locator('.cell-title.truncate');
    const eventName = await titleEl.innerText();
    console.log(`🎯 找到目標賽事: "${eventName}"`);
    data.eventName = eventName; // 更新全域資料

    // 3. 點擊賽事
    await eventLocator.click();
    console.log('👆 已點擊賽事圖示。');

    // 4. 點擊 "Let’s go!"
    // 使用 user 提供的 text，注意是 ’ (right single quotation mark)
    const letsGoBtn = frame.locator('.button-primary', { hasText: 'Let’s go!' });
    await letsGoBtn.waitFor({ state: 'visible', timeout: 10000 });
    // 增加一點延遲確保動畫完成
    await sleep(2000);
    await letsGoBtn.click({ force: true });
    console.log('👆 已點擊 "Let’s go!" (Force + Delay)。');

    // 5. 點擊 "開始玩"
    console.log('⏳ 準備點擊 "開始玩" (v4 - Checking both Page and Frame)...');

    // 定位按鈕：可能是 Facebook 的覆蓋層 (in page) 或遊戲內部 (in frame)
    const startPlayInPage = page.locator('div[role="button"]').filter({ hasText: '開始玩' });
    const startPlayInFrame = frame.locator('div[role="button"]').filter({ hasText: '開始玩' });

    try {
      // 使用 Promise.any 等待其中一個可見
      const location = await Promise.any([
        startPlayInPage.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'Page'),
        startPlayInFrame.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'Frame')
      ]);

      console.log(`🎯 在 [${location}] 找到 "開始玩" 按鈕！`);
      await sleep(2000);

      if (location === 'Page') {
        await startPlayInPage.click({ force: true });
      } else {
        await startPlayInFrame.click({ force: true });
      }
      console.log(`👆 已點擊 [${location}] 中的 "開始玩" (v4)`);
    } catch (err) {
      console.warn('⚠️ 等待 "開始玩" 按鈕超時，嘗試最後手段 (getByText)...');
      try {
        await sleep(2000);
        await page.getByText('開始玩').click({ timeout: 5000 });
        console.log('👆 已點擊 "開始玩" (最後手段成功)');
      } catch (e2) {
        throw new Error('無法找到或點擊 "開始玩" 按鈕: ' + err.message);
      }
    }

    // 額外等待進入遊戲
    await sleep(8000);

  } catch (error) {
    console.warn('⚠️ 自動進入賽事流程失敗 (可能無 "hour" 賽事或介面改變):', error.message);
    // 截圖以輔助除錯 (僅在本機有 display 時有效，headless 也可以)
    try {
      await page.screenshot({ path: 'debug_event_entry_fail.png' });
      console.log('📸 已儲存錯誤截圖: debug_event_entry_fail.png');
    } catch (e) { /* ignore */ }

    console.warn('⚠️ 請手動進入賽事畫面以繼續後續流程...');
  }
  // ---------------------------


  // 循環 7 天（今天到前 6 天）
  for (let i = 1; i <= 7; i++) {
    const date = getDateNDaysAgo(7 - i);
    console.log(`📅 目標日期：${date}`);

    // 使用更精確的 footer selector 避免 layout offset 點到別處 (如 All Players 標籤)
    const playBtn = frame.locator('.screen-component-footer .button-primary:has-text("Play")');
    if (await playBtn.count() > 0) {
      await playBtn.click({ force: true }).catch(() => { });
      console.log('🎮 已點擊「Play」。等待遊戲進行中 (95 秒)...');

      // 1. 等待遊戲結束 (91秒預留緩衝)
      await sleep(95000);
      console.log('⏰ 95 秒已到，展開後續自動化操作...');

      // Facebook may create the share dialog well after the game timer ends.
      await waitForPostGameOverlayOrResults(page, frame);

      // 2. 自動關閉分享對話 (Facebook 覆蓋層)
      console.log('⏳ 檢查是否有分享對話/廣告...');
      const closeSharingBtn = page.locator('div[aria-label="關閉淘汰賽對話"]');
      const closeAdBtn = page.locator('div[aria-label="關閉廣告"]');

      try {
        // 嘗試關閉分享視窗
        if (await closeSharingBtn.isVisible()) {
          await closeSharingBtn.click({ force: true });
          console.log('✨ 已自動關閉分享對話。');
          await sleep(10000);
        }

        // 嘗試關閉廣告 (如果有)
        if (await closeAdBtn.isVisible()) {
          await closeAdBtn.click({ force: true });
          console.log('✨ 已自動關閉廣告。');
          await sleep(1000);
        }
      } catch (e) {
        console.warn('⚠️ 關閉對話/廣告時發生非預期狀況:', e.message);
      }
    }

    // 移除原有的手動暫停邏輯
    // const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // await rl.question(`⏸️ 請切換到第 ${i} 天（${date}）的結算畫面，確認後按 Enter 繼續...`);
    // rl.close();

    // 點擊 All words
    let words;
    let wordCells;
    try {
      ({ words, wordCells } = await waitForEventWords(page, frame));
    } catch (error) {
      console.warn(`⚠️ ${error.message}`);
      await debugMissingEventWords(page, frame, date, i);
      throw error;
    }
    console.log(`✅ 擷取到 ${words.length} 個單字。`);

    // 點擊第一個字詞以顯示棋盤
    if (words.length > 0) {
      const firstWord = wordCells.first();
      if (firstWord) {
        const wordText = await firstWord.innerText();
        console.log(`🔠 點擊第一個單字 "${wordText}" 以顯示棋盤...`);
        await firstWord.click().catch(() => { });
        await frame.locator('.letter-grid .core-letter-cell').first()
          .waitFor({ state: 'visible', timeout: 30000 });
        await sleep(1500);
      }
    } else {
      console.warn('⚠️ 沒有偵測到任何單字，已暫停以便檢查目前畫面。');
      await debugMissingEventWords(page, frame, date, i);
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      await rl.question('⏸️ 請檢查瀏覽器中的結果畫面；修正或手動切換後按 Enter 繼續：');
      rl.close();
    }

    // 擷取棋盤盤面
    const board = await frame.$$eval('.letter-grid .core-letter-cell', cells =>
      cells.map(el => {
        const letter = el.querySelector('.letter')?.innerText?.trim() || '';
        const bonus =
          el.querySelector('.bonus .circle')?.innerText?.trim() ||
          el.className.match(/2L|3L|2W|3W|DL|TL|DW|TW/i)?.[0] ||
          '';
        const active = el.classList.contains('active');
        return { letter, bonus, active };
      })
    );

    // 建立 payload 並推入 data.boards
    const payload = {
      date,
      wordCount: words.length,
      board: board.length ? board : 'not found',
      words
    };

    data.boards.push(payload);
    console.log(`📦 完成擷取 ${date}：共 ${words.length} 字詞，棋盤格數 ${board.length}`);

    // --- 自動返回與繼續 (進入下一天) ---
    if (i < 7) {
      console.log('🔄 準備進入下一天，執行導航自動化...');
      try {
        const backBtn = frame.locator('.icon-back');
        await backBtn.waitFor({ state: 'visible', timeout: 5000 });
        await backBtn.click();
        console.log('👆 已點擊返回按鈕。');

        await sleep(1000);

        const continueBtn = frame.locator('.button-primary', { hasText: 'Continue' });
        await continueBtn.waitFor({ state: 'visible', timeout: 5000 });
        await continueBtn.click();
        console.log('👆 已點擊「Continue」按鈕。');

        await sleep(2000); // 等待畫面轉場
      } catch (err) {
        console.warn('⚠️ 自動導航回賽事畫面失敗:', err.message);
        console.log('📸 已儲存導航失敗截圖: debug_nav_fail.png');
        await page.screenshot({ path: 'debug_nav_fail.png' });
      }
    }
  }

  // 所有天數結束後一次儲存
  await saveJson(data);

  console.log('✅ 全部七天擷取完成！視窗將保持開啟，請自行檢查。');
  await new Promise(() => { }); // 永遠不 resolve，保持視窗開啟
})();

// {
//   "date": "2025-12-31",
//   "wordCount": 127,
//   "board": [
//     {
//       "letter": "P",
//       "bonus": "",
//       "active": false
//     },
//     {
//       "letter": "G",
//       "bonus": "",
//       "active": true
//     },
//     {
//       "letter": "O",
//       "bonus": "",
//       "active": true
//     },
//     {
//       "letter": "G",
//       "bonus": "",
//       "active": false
//     },
//     {
//       "letter": "L",
//       "bonus": "",
//       "active": false
//     },
//     {
//       "letter": "I",
//       "bonus": "",
//       "active": true
//     },
//     {
//       "letter": "B",
//       "bonus": "",
//       "active": true
//     },
//     {
//       "letter": "G",
//       "bonus": "",
//       "active": false
//     },
//     {
//       "letter": "I",
//       "bonus": "",
//       "active": true
//     },
//     {
//       "letter": "N",
//       "bonus": "",
//       "active": false
//     },
//     {
//       "letter": "O",
//       "bonus": "",
//       "active": false
//     },
//     {
//       "letter": "M",
//       "bonus": "",
//       "active": false
//     },
//     {
//       "letter": "D",
//       "bonus": "",
//       "active": true
//     },
//     {
//       "letter": "L",
//       "bonus": "",
//       "active": false
//     },
//     {
//       "letter": "R",
//       "bonus": "",
//       "active": false
//     },
//     {
//       "letter": "T",
//       "bonus": "",
//       "active": false
//     }
//   ],
//   "words": [
//     "GOBIID",
//     "OBOLI",
//     "ROBIN",
//     "TONDI",
//     "BINDI",
//     "GOMBO",
//     "PINOT",
//     "LOGOI",
//     "INRO",
//     "GORM",
//     "ROIN",
//     "ROIL",
//     "GOBI",
//     "PILI",
//     "TOLD",
//     "GOBO",
//     "BIND",
//     "DINO",
//     "LOBI",
//     "BOIL",
//     "LOBO",
//     "LION",
//     "MORT",
//     "BIOG",
//     "GOLD",
//     "NOGG",
//     "BORT",
//     "BORN",
//     "BORM",
//     "MOIL",
//     "TOMB",
//     "MORN",
//     "NOIL",
//     "LOGO",
//     "NORM",
//     "BOLD",
//     "OLID",
//     "GLIB",
//     "PION",
//     "MOLD",
//     "LOIN",
//     "TORN",
//     "LIND",
//     "OBOL",
//     "LORN",
//     "BOND",
//     "LINO",
//     "GLID",
//     "LILO",
//     "TROG",
//     "GOGO",
//     "TOIL",
//     "TRON",
//     "OLD",
//     "LOB",
//     "LOG",
//     "TOG",
//     "LOR",
//     "LOT",
//     "TON",
//     "TOM",
//     "TOR",
//     "GOB",
//     "LIB",
//     "LID",
//     "GON",
//     "DIN",
//     "GOR",
//     "LIG",
//     "GOT",
//     "PIG",
//     "LIN",
//     "LIP",
//     "PIN",
//     "BOG",
//     "BOI",
//     "NOB",
//     "GIB",
//     "ROB",
//     "BOR",
//     "BOT",
//     "NOG",
//     "GIO",
//     "NOM",
//     "GIN",
//     "GIP",
//     "NOR",
//     "ROM",
//     "NOT",
//     "OIL",
//     "ROT",
//     "ORT",
//     "OBI",
//     "OBO",
//     "MOB",
//     "BIG",
//     "MOG",
//     "MOI",
//     "NIB",
//     "BIN",
//     "NID",
//     "BIO",
//     "ION",
//     "MOL",
//     "MON",
//     "NIL",
//     "MOR",
//     "MOT",
//     "NIP",
//     "ID",
//     "IN",
//     "IO",
//     "BI",
//     "BO",
//     "TO",
//     "LI",
//     "LO",
//     "MO",
//     "NO",
//     "OB",
//     "OI",
//     "OM",
//     "ON",
//     "GI",
//     "OR",
//     "GO",
//     "PI"
//   ]
// }
