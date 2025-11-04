# Word Blitz Automation Scripts

Browser automation utilities built with **Playwright** to capture **Word Blitz** data from Facebook Gaming.

---

## Requirements

- **Node.js 18+**  
  (Playwright 1.56 requires modern Node features and `async/await` support)
- Install dependencies once:
  ```bash
  npm install
  ```

- Install Chromium browser binaries for Playwright:

  ```bash
  npx playwright install chromium
  ```
- A **Facebook account** that can log in to Word Blitz.
  The scripts reuse saved Playwright storage state instead of re-authenticating every time.

> 💡 **Note:**
> The repository currently contains:
>
> * `scrape_daliy_board.mjs`
> * `scrape_event_board.mjs`
>   These filenames are intentionally preserved and correspond to the “daily board” and “event rank/board” tools referenced below.

---

## 🚀 Script Usage

### `login.mjs`

Stores a reusable Facebook session for the scraping scripts.

**Steps:**

1. Run:

   ```bash
   node login.mjs
   ```
2. A non-headless Chromium window opens on [https://www.facebook.com](https://www.facebook.com).
3. Complete the login manually in the browser.
4. Return to the terminal and press **Enter** when prompted.
5. The script writes `storage_state.json` (or whatever file you change to, ex: `storage_state2.json`) with your authenticated session and closes the browser.

Re-run this script whenever the saved session expires.

---

### `scrape_daliy_board.mjs` (Daily Board Capture)

Exports **Word Blitz** daily boards and solved word lists to `daily_details.json`.

**Steps:**

1. Ensure `storage_state2.json` contains a valid session
   (you can copy `storage_state.json` or create a second login profile).
2. Run:

   ```bash
   node scrape_daliy_board.mjs
   ```
3. The script opens Word Blitz in Chromium, loads the game iframe, and waits in a loop:

   * After you finish or open the daily game manually, press **Enter** in the terminal.
4. It clicks **“All words”**, captures the word list and board layout, and appends a record to `daily_details.json`.
5. Leave it running to capture additional boards; press **Ctrl + C** to stop.

Each saved entry includes:

* ISO date
* Word count
* Board tiles (letters plus bonus tags)
* Captured word list

---

### `scrape_daily_rank.mjs`

Scrapes the daily leaderboards into `daily_scores.csv`.

**Steps:**

1. Make sure `storage_state.json` exists from `login.mjs`.
2. Run:

   ```bash
   node scrape_daily_rank.mjs
   ```
3. The script:

   * Opens Word Blitz
   * Iterates over every “Daily Game” card
   * Clicks through each leaderboard and extracts:

     * Player rank
     * Name
     * Score
     * Avatar URL
     * Hashed player ID
   * Detects the associated daily date when possible (or marks as unknown)
   * Merges results into `daily_scores.csv`, updating existing rows with latest scores
   * Closes the browser automatically when done

> ⚙️ **Special Handling:**
> Rows tied to `PLAYER_DISCARD_ID` are skipped.

---

### `scrape_event_board.mjs` (Event Rank Capture)

Collects multi-day event boards into `event_details.json`.

**Steps:**

1. Ensure `storage_state2.json` is valid (same as the daily board script).
2. Run:

   ```bash
   node scrape_event_board.mjs
   ```
3. For each of the past **seven days (oldest → newest)**, the script prompts you to navigate the event UI manually:

   * Move the in-browser UI to the requested day
   * Close any pop-up ads
   * Press **Enter** in the terminal to continue
4. It clicks **“All words”**, captures the board layout (letters, bonuses, active tiles), and saves the word list.
5. After the seventh day:

   * Saves one JSON record containing the event name (`blitz round`) and an array of captured boards
   * Keeps the browser open for verification (close manually when finished)

Example output:

```json
{
  "eventName": "blitz round",
  "boards": [
    {
      "date": "2025-11-04",
      "wordCount": 126,
      "board": [...],
      "words": [...]
    }
  ]
}
```

The output file provides a structured history of boards and word counts for the tracked event week.


