// scrape_wordblitz_board_v2.mjs
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';

const FB_APP_PLAY_URL = 'https://www.facebook.com/gaming/play/2211386328877300/';
const STORAGE = path.resolve('./storage_state2.json');
const JSON_PATH = path.resolve('./daily_details.json');

// 寫入 JSON
async function saveJson(data) {
  const prev = await fs.readFile(JSON_PATH, 'utf8').catch(() => '[]');
  const all = JSON.parse(prev);
  all.push(data);
  await fs.writeFile(JSON_PATH, JSON.stringify(all, null, 2), 'utf8');
  console.log(`💾 已寫入 ${JSON_PATH}`);
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STORAGE });
  const page = await context.newPage();

  console.log('🚀 開啟 Word Blitz 遊戲頁...');
  await page.goto(FB_APP_PLAY_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });

  const iframeHandle = await page.waitForSelector('iframe#games_iframe_web', { timeout: 60000 });
  const frame = await iframeHandle.contentFrame();
  console.log('✅ 已附著到遊戲 iframe。');

  while (true) {

    // 等待使用者按 Enter 繼續
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    await rl.question('⏸️ 請手動關掉廣告，確認畫面準備好後按 Enter 繼續...');
    rl.close();
    // 點擊 All words（確保顯示完整清單）
    const allWordsBtn = await frame.$('.btn:has-text("All words")');
    if (allWordsBtn) {
      await allWordsBtn.click().catch(() => {});
      console.log('📝 已點擊「All words」。等待字詞列表載入...');
      await frame.waitForTimeout(1500);
    }

    // 擷取所有字詞（無論有沒有滑過）
    const words = await frame.$$eval('.duel-result-row .word span', els =>
      els.map(e => e.innerText.trim()).filter(Boolean)
    );
    console.log(`✅ 擷取到 ${words.length} 個單字。`);

    // 點擊任意字詞以打開棋盤（例如第一個）
    if (words.length > 0) {
      const firstWord = await frame.$('.duel-result-row .word span');
      if (firstWord) {
        console.log(`🔠 點擊第一個單字 "${await firstWord.evaluate(e => e.innerText)}" 以顯示棋盤...`);
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
        return { letter, bonus };
      })
    );

    const date = new Date().toISOString().slice(0, 10);

    const data = {
      date,
      wordCount: words.length,
      board: board.length ? board : 'not found',
      words,
    };

    console.log(`📦 完成擷取！共 ${words.length} 字詞，棋盤格數 ${board.length}`);
    await saveJson(data);
  }
})();
