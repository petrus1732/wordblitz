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

  const iframeHandle = await page.waitForSelector('iframe#games_iframe_web', { timeout: 60000 });
  const frame = await iframeHandle.contentFrame();
  console.log('✅ 已附著到遊戲 iframe。');

  // 循環 7 天（今天到前 6 天）
  for (let i = 1; i <= 7; i++) {
    const date = getDateNDaysAgo(7 - i);
    console.log(`📅 目標日期：${date}`);

    // 暫停等待使用者手動關閉廣告
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question(`⏸️ 請切換到第 ${i} 天（${date}）的結算畫面，確認後按 Enter 繼續...`);
    rl.close();

    // 點擊 All words
    const allWordsBtn = await frame.$('.btn:has-text("All words")');
    if (allWordsBtn) {
      await allWordsBtn.click().catch(() => {});
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
        await firstWord.click().catch(() => {});
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
  }

  // 所有天數結束後一次儲存
  await saveJson(data);

  console.log('✅ 全部七天擷取完成！視窗將保持開啟，請自行檢查。');
  await new Promise(() => {}); // 永遠不 resolve，保持視窗開啟
})();
