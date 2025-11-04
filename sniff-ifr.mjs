// node sniff-ifr.mjs [--login]
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const FB_APP_PLAY_URL =
  'https://www.facebook.com/gaming/play/2211386328877300/?context_source_id=24784068497931922&context_type=GENERIC';

const STORAGE = path.resolve('./storage_state2.json');
const OUT = path.resolve('./network-log.ndjson');
const NEEDLE = /leader|board|rank|score|entries|graphql/i;
const args = new Set(process.argv.slice(2));
const DO_LOGIN = args.has('--login');

async function log(obj) {
  await fs.appendFile(OUT, JSON.stringify(obj) + '\n', 'utf8');
}

(async () => {
  const browser = await chromium.launch({ headless: !DO_LOGIN });
  const context = await browser.newContext({
    storageState: (await fs.stat(STORAGE).catch(() => null)) && !DO_LOGIN ? STORAGE : undefined,
  });
  const page = await context.newPage();

  // 1) 如需登入：先到 facebook.com，讓你手動登入一次
  if (DO_LOGIN) {
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    console.log('請在這個視窗手動登入 Facebook，登入完成後再按下終端機的 Enter。');
    process.stdin.resume();
    await new Promise(res => process.stdin.once('data', res));
    await context.storageState({ path: STORAGE });
    console.log('✅ 已儲存登入狀態到 storage_state.json。接著會自動前往遊戲頁。');
  }

  // 2) 前往遊戲頁
  await page.goto(FB_APP_PLAY_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // 3) 取得遊戲 iframe（用 id 或 src 兩種策略）
  // 先等整體載入再找
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});
  const iframeHandle =
    await page.$('iframe#games_iframe_web') ||
    await page.$('iframe[src*="apps-2211386328877300.apps.fbsbx.com"]');

  if (!iframeHandle) {
    console.error('❌ 找不到遊戲 iframe（#games_iframe_web）。請確認已進到遊戲畫面。');
    process.exit(1);
  }
  const gameFrame = await iframeHandle.contentFrame();
  if (!gameFrame) {
    console.error('❌ 無法附著到遊戲 iframe。');
    process.exit(1);
  }
  console.log('✅ attached to iframe:', gameFrame.url());

  // 4) 只記錄此 iframe 的請求/回應
  page.on('request', async (req) => {
    if (req.frame() !== gameFrame) return;
    const url = req.url();
    if (NEEDLE.test(url)) {
      await log({ t: 'request', url, method: req.method(), post: req.postData() || '' });
      console.log('[REQ]', req.method(), url);
    }
  });

  page.on('response', async (res) => {
    if (res.frame() !== gameFrame) return;
    const url = res.url();
    if (!NEEDLE.test(url)) return;
    try {
      const ct = res.headers()['content-type'] || '';
      // GraphQL 有時是 text/plain；JSON 直接吃
      if (!/json|text\/plain|graphql|event-stream/.test(ct)) return;
      const text = await res.text();
      await log({ t: 'response', url, status: res.status(), ct, body: text.slice(0, 4000) });
      console.log('[RES]', res.status(), ct, url);
    } catch {}
  });

  console.log('👉 請在視窗裡點「Daily 排行榜」、切換分頁或滾動一下以觸發載入。');
  console.log('   每一筆命中的請求與回應會寫到 network-log.ndjson。');
})();
