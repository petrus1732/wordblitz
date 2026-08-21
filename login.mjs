// login.mjs
import { chromium } from 'playwright';
import path from 'node:path';
import readline from 'node:readline/promises';

const STORAGE = path.resolve('./storage_state3.json');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
  console.log('請在新視窗完成 Facebook 登入後，回到終端機按 Enter。');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('登入完成後按 Enter 以儲存登入狀態：');
  rl.close();

  await context.storageState({ path: STORAGE });
  console.log(`✅ 已儲存登入狀態到 ${STORAGE}`);
  await browser.close();
})();