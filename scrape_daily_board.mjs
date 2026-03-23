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

  // --- 自動進入每日挑戰 ---
  console.log('🔍 正在尋找每日挑戰 (Daily Game)...');
  try {
    const dailyGrid = frame.locator('.cell-daily.clickable').first();
    await dailyGrid.waitFor({ state: 'visible', timeout: 50000 });

    // 點擊每日挑戰內部的 Go 按鈕 (button-round)
    const goBtn = dailyGrid.locator('.btn-go .button-round.clickable');
    await goBtn.click();
    console.log('👆 已點擊「Daily Game」Go 按鈕。');

    // 點擊 "Play" 按鈕 (使用 footer selector 確保精確)
    const playBtn = frame.locator('.screen-component-footer .button-primary:has-text("Play")');
    await playBtn.waitFor({ state: 'visible', timeout: 10000 });
    await frame.waitForTimeout(2000); // 確保動畫穩定
    await playBtn.click({ force: true });
    console.log('🎮 已點擊「Play」。等待遊戲進行中 (95 秒)...');

    // 1. 等待遊戲結束 (95秒預留緩衝)
    await frame.waitForTimeout(95000);
    console.log('⏰ 95 秒已到，展開後續自動化操作...');

    // 2. 自動關閉分享對話 (Facebook 覆蓋層)
    const closeSharingBtn = page.locator('div[aria-label="關閉淘汰賽對話"]');
    const closeAdBtn = page.locator('div[aria-label="關閉廣告"]');

    if (await closeSharingBtn.isVisible()) {
      await closeSharingBtn.click({ force: true });
      console.log('✨ 已自動關閉分享對話。');
      await frame.waitForTimeout(1000);
    }

    if (await closeAdBtn.isVisible()) {
      await closeAdBtn.click({ force: true });
      console.log('✨ 已自動關閉廣告。');
      await frame.waitForTimeout(1000);
    }

    // 3. 點擊 All words（確保顯示完整清單）
    const allWordsBtn = frame.locator('.btn', { hasText: 'All words' });
    if (await allWordsBtn.isVisible()) {
      await allWordsBtn.click({ force: true });
      console.log('📝 已點擊「All words」。等待字詞列表載入...');
      await frame.waitForTimeout(2000);
    }

    // 擷取所有字詞
    const words = await frame.$$eval('.duel-result-row .word span', els =>
      els.map(e => e.innerText.trim()).filter(Boolean)
    );
    console.log(`✅ 擷取到 ${words.length} 個單字。`);

    // 點擊任意字詞以打開棋盤
    if (words.length > 0) {
      const firstWord = await frame.$('.duel-result-row .word span');
      if (firstWord) {
        console.log(`🔠 點擊第一個單字以顯示棋盤...`);
        await firstWord.click().catch(() => { });
        await frame.waitForSelector('.letter-grid .core-letter-cell', { timeout: 10000 });
        await frame.waitForTimeout(1500);
      }
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
    const resultData = {
      date,
      wordCount: words.length,
      board: board.length ? board : 'not found',
      words,
    };

    console.log(`📦 完成擷取！共 ${words.length} 字詞，棋盤格數 ${board.length}`);
    await saveJson(resultData);

  } catch (err) {
    console.error('⚠️ 自動化流程發生錯誤:', err.message);
    try {
      await page.screenshot({ path: 'debug_daily_board_fail.png' });
    } catch (e) { }
  } finally {
    console.log('🏁 任務結束。');
    await browser.close();
  }
})();
