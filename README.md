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

---

### `calculate_points.mjs`

Aggregates scores from `daily_scores.csv` and `event_rankings.json` into a JSON file grouped by month (`points.json` by default). Each month contains the full leaderboard, including medal counts (gold/silver/bronze), medal totals, avatar URLs, and the bonuses used by the site.

**Usage**

```bash
node calculate_points.mjs
# or limit to a single month / partial month
node calculate_points.mjs --month 2025-11 --through 2025-11-05 --output data/points.json
```

**Options**

- `--month YYYY-MM` (optional): limit scoring to a single month (defaults to every month present in the inputs).
- `--through YYYY-MM-DD` (optional, requires `--month`): only include days up to this date within the selected month.
- `--daily <path>` / `--event <path>`: override input files (`daily_scores.csv` / `event_rankings.json` by default).
- `--output <path>`: destination JSON (`points.json` by default).

**Scoring Rules Implemented**

- Daily placements: 1st = 19 pts, 2nd = 15, 3rd = 11, 4th-10th = 7 down to 1; Saturdays are doubled.
- Medal counts: gold/silver/bronze awarded for 1st/2nd/3rd in daily games only; medal totals are tracked per month.
- Medal set bonuses: the first five players each month to record at least one gold, silver, and bronze earn 50/40/30/20/10 pts.
- Longest Top-10 streak: every player tied for the longest consecutive-day streak within the month earns 25 pts.
- Event placements: ranks 1-15 earn 60 down to 4 pts (-4 per position).

The resulting JSON looks like:

```json
{
  "2025-10": [
    {
      "playerId": "abc",
      "name": "Player",
      "avatar": "https://…",
      "dailyPoints": 141,
      "eventPoints": 180,
      "goldCount": 3,
      "silverCount": 1,
      "bronzeCount": 0,
      "medalCount": 4,
      "medalBonus": 40,
      "streakBonus": 25,
      "totalPoints": 386,
      "longestTop10Streak": 8,
      "medalSetRank": 2,
      "medalSetCompletedOn": "2025-10-12"
    }
  ]
}
```


