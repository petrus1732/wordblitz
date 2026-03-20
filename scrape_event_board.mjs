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
  const frame = await iframeHandle.contentFrame();
  console.log('✅ 已附著到遊戲 iframe。');

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
    await frame.waitForTimeout(2000);
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
      await frame.waitForTimeout(2000);

      if (location === 'Page') {
        await startPlayInPage.click({ force: true });
      } else {
        await startPlayInFrame.click({ force: true });
      }
      console.log(`👆 已點擊 [${location}] 中的 "開始玩" (v4)`);
    } catch (err) {
      console.warn('⚠️ 等待 "開始玩" 按鈕超時，嘗試最後手段 (getByText)...');
      try {
        await frame.waitForTimeout(2000);
        await page.getByText('開始玩').click({ timeout: 5000 });
        console.log('👆 已點擊 "開始玩" (最後手段成功)');
      } catch (e2) {
        throw new Error('無法找到或點擊 "開始玩" 按鈕: ' + err.message);
      }
    }

    // 額外等待進入遊戲
    await frame.waitForTimeout(8000);

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
      await frame.waitForTimeout(95000);
      console.log('⏰ 95 秒已到，展開後續自動化操作...');

      // 2. 自動關閉分享對話 (Facebook 覆蓋層)
      console.log('⏳ 檢查是否有分享對話/廣告...');
      const closeSharingBtn = page.locator('div[aria-label="關閉淘汰賽對話"]');
      const closeAdBtn = page.locator('div[aria-label="關閉廣告"]');

      try {
        // 嘗試關閉分享視窗
        if (await closeSharingBtn.isVisible()) {
          await closeSharingBtn.click({ force: true });
          console.log('✨ 已自動關閉分享對話。');
          await frame.waitForTimeout(5000);
        }

        // 嘗試關閉廣告 (如果有)
        if (await closeAdBtn.isVisible()) {
          await closeAdBtn.click({ force: true });
          console.log('✨ 已自動關閉廣告。');
          await frame.waitForTimeout(1000);
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
    const allWordsBtn = await frame.$('.btn:has-text("All words")');
    if (allWordsBtn) {
      await allWordsBtn.click().catch(() => { });
      console.log('📝 已點擊「All words」。等待字詞列表載入...');
      await frame.waitForTimeout(1500);
    }

    // 擷取所有字詞
    const words = await frame.$$eval('.duel-result-row .word span', els =>
      els.map(e => e.innerText.trim()).filter(Boolean)
    );
    console.log(`✅ 擷取到 ${words.length} 個單字。`);

    // 點擊第一個字詞以顯示棋盤
    if (words.length > 0) {
      const firstWord = await frame.$('.duel-result-row .word span');
      if (firstWord) {
        const wordText = await firstWord.evaluate(e => e.innerText);
        console.log(`🔠 點擊第一個單字 "${wordText}" 以顯示棋盤...`);
        await firstWord.click().catch(() => { });
        await frame.waitForSelector('.letter-grid .core-letter-cell', { timeout: 10000 });
        await frame.waitForTimeout(1500);
      }
    } else {
      console.warn('⚠️ 沒有偵測到任何單字，略過棋盤擷取。');
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
        const backBtn = frame.locator('.icon-button .icon-back');
        await backBtn.waitFor({ state: 'visible', timeout: 5000 });
        await backBtn.click();
        console.log('👆 已點擊返回按鈕。');

        await frame.waitForTimeout(1000);

        const continueBtn = frame.locator('.button-primary', { hasText: 'Continue' });
        await continueBtn.waitFor({ state: 'visible', timeout: 5000 });
        await continueBtn.click();
        console.log('👆 已點擊「Continue」按鈕。');

        await frame.waitForTimeout(2000); // 等待畫面轉場
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