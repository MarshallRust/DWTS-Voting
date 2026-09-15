# DWTS Fan Vote

A voting site for Dancing With the Stars fan rankings. Static frontend
(GitHub Pages) + your own Google Sheet as the database, connected by a
small Google Apps Script API.

Contestants are the current **Season 35** cast, read live from your Sheet
so you can edit names/partners any time without touching code.

## How it works

**The Sheet's structure is yours — this project doesn't create or design
it.** Two tabs:

- **`contestants`** — `contestant_id | name | partner_name`. The roster.
  Setting a contestant's `contestant_id` to `0` marks them as removed —
  they stop showing up on the voting site, and they no longer count
  toward how many rank slots a vote needs to fill. This is the only
  table the script ever reads on a normal page load.
- **`votes`** — `vote_id | voter_name | date | device_id | 1 | 2 | ... |
  16 | comments`. One row per device *per day*. Columns `1`–`16` hold the
  **name** of whichever contestant that voter ranked in that position —
  column `1` is their favorite, and so on, up to however many
  contestants are still in the running (any columns beyond that are left
  blank). Voting again later the same day updates that same row in
  place; voting on a new day adds a new row, so the full history of
  everyone's votes stays in the sheet.

The Apps Script (`apps-script/Code.gs`) does exactly two reads and
nothing else, on every vote:

1. Reads `contestants` to count how many are still in the running
   (`contestant_id != 0`), and rejects the vote if the number of ranked
   names sent doesn't match that count.
2. Reads `votes` to check whether this device already has a row dated
   today. If so, that row is overwritten in place (same `vote_id`, new
   date/positions/comments). If not, a new row with a new `vote_id` is
   appended.

That's it — no other lookups, no separate voter table, no name-to-id
mapping. `GET` (loading the site) does one read of `contestants` to show
who's still eligible to vote for.

**Eliminations are entirely your call, done directly in the Sheet.** You
zero out a `contestant_id` when someone's out; the site picks that up on
the very next page load, live, with no schedule needed in the code for
that part. If you set up a Sunday-midnight Apps Script trigger yourself
as a reminder to make that edit, it doesn't call anything in this file —
it's just a cron for you, not for the script.

`index.html` / `style.css` / `app.js` are the static site — press and
hold a card to drag it and rank contestants, add an optional comment,
and submit. There's no public results page: voters just see a
confirmation that their vote was recorded (or updated, if they'd already
voted today); you check standings by looking at your own Sheet.

### Why rankings are sent as names, not ids

Since the `votes` tab's position columns store each contestant's *name*
directly (not their id), the site just sends whatever order it's
currently showing — no id lookup needed on either end.

### Column layout in `votes` is fixed by position

Because `Code.gs` doesn't read `votes`' header row before writing to it,
it writes to fixed column positions instead, matching the order you
gave:

```
1: vote_id   2: voter_name   3: date   4: device_id
5–20: position "1" through "16"
21: comments
```

If your actual columns are ordered differently than this, votes will
still get written — just into the wrong columns, silently, since nothing
reads the header back to catch a mismatch. Double check your column
order matches before going live. If you ever reorder these columns,
update the `COL_*` constants near the top of `Code.gs` to match.

`contestants` is the exception: since it's the table this script reads
(both for the site's roster and to count how many are still in the
running), it looks columns up by header text (`contestant_id`, `name`,
`partner_name`), so it's more forgiving of column order there — but
still expects those exact header names.

## Photos

There's no `PhotoURL` column in your sheet, so photos are handled
entirely on the frontend: the site derives each contestant's image path
straight from their name, matching the `images/` folder that ships with
this project — e.g. `"Harry Shum Jr."` → `images/Harry_Shum_Jr.jpg`
(spaces become underscores, a trailing period is dropped). If a name
doesn't match a file in `images/`, the site falls back to a colored
initials block automatically — no error, no broken image.

To add or change a photo, just drop a same-named file into `images/`
following that pattern. Renaming a contestant in the `contestants` tab
means renaming their photo file to match, or they'll fall back to
initials.

Each ranking card shows the photo large and full-width, so a portrait-ish
image (taller than wide) will look best.

## Setup

### 1. Paste the script into your existing Sheet

1. Open your Google Sheet (the one with `contestants` and `votes` already
   in it).
2. Open **Extensions > Apps Script**.
3. Delete the placeholder code in `Code.gs` and paste in the full contents
   of this project's `apps-script/Code.gs`.
4. Save the script (there's no setup function to run — your tabs already
   exist).

### 2. Deploy the API

1. In the Apps Script editor: **Deploy > New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**, authorize it (it's your own script acting on your own
   Sheet), then copy the **Web app URL** (ends in `/exec`).

Whenever you edit `Code.gs` later, you must **Deploy > Manage
deployments > pencil icon > New version** — saving the script alone does
not update the live API.

### 3. Point the site at your API

Open `app.js` and replace:

```js
const WEB_APP_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
```

with your `/exec` URL from step 2.

### 4. (Optional) Set up your own weekly reminder

If you want a nudge to go zero out eliminated contestants after Sunday's
results: in the Apps Script editor, **Triggers** (clock icon) > **Add
Trigger** > choose any function, event source "Time-driven," and a
weekly timer for Sunday. This is entirely for your own reminder — nothing
in `Code.gs` needs a trigger to work correctly.

### 5. Publish to GitHub Pages

1. Create a new GitHub repo (public, or private on a paid plan that
   supports Pages).
2. Push `index.html`, `style.css`, `app.js`, **and the `images/` folder**
   to the repo root, keeping `images/` as a subfolder alongside
   `index.html`. The `apps-script/` folder and this README are just
   references for you and don't need to be in the deployed site, though
   it's fine to leave them in the repo.
3. In the repo, go to **Settings > Pages**, set **Source** to your main
   branch (root), and save.
4. GitHub gives you a URL like `https://<username>.github.io/<repo>/` —
   that's your live voting site.

```bash
git init
git add .
git commit -m "DWTS fan vote site"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### 6. Try it

Open your GitHub Pages URL, submit a test vote, then check your Google
Sheet's `votes` tab to confirm it landed. Submit again the same day and
confirm it updates the same row instead of adding a second one.

## Checking results

The site never shows rankings to voters — that's entirely your Sheet to
build. `votes`' columns `1`–`16` hold contestant names directly, so a
`COUNTIF` per contestant per column (or a pivot table over the range)
gets you first-place counts, second-place counts, and so on, without
touching `Code.gs` at all.

## Editing contestants later

Edit the `contestants` tab directly:

- Set `contestant_id` to `0` to mark someone removed — they stop showing
  up on the voting page and no longer count toward how many rank slots a
  vote needs. Past votes that already named them in a position column
  aren't touched.
- The `votes` tab's `1`–`16` columns assume a season starting at 16
  contestants and only ever shrinking. If you ever need more than 16 to
  begin with, add more numbered columns and update `NUM_RANK_COLS` near
  the top of `Code.gs` to match.

## Known limitations

- **Vote integrity is soft, not hard — and device-based, not
  identity-based.** There's no login: the `device_id` is a random value
  the browser makes up and stores in `localStorage` the first time the
  page loads. It identifies *a browser*, not *a person*, and resets to a
  brand-new id if the voter clears their browser data, uses a private/
  incognito window, or votes from a different browser or device — so a
  motivated person can still vote more than once per day.
- **"Today" is a calendar day in your spreadsheet's timezone**, not a
  rolling 24 hours from someone's last vote. Check File > Settings in
  Google Sheets if the timezone looks off.
- **No validation that submitted contestant names are real or spelled
  correctly** — the script accepts whatever names the browser sends and
  writes them as-is. In practice this is fine because the site itself is
  the only thing generating that payload (it always sends real names
  from the roster it just displayed), but a hand-crafted request could
  write anything into those columns.
- **`votes` column order is fixed, not read from headers.** See "Column
  layout" above — if your actual sheet's columns are ordered differently
  than assumed, votes land in the wrong columns with no error.
- **CORS:** the frontend sends votes as `text/plain` (not
  `application/json`) specifically to dodge a CORS preflight that Apps
  Script doesn't handle — this is intentional, not a bug, and `Code.gs`
  parses the body as JSON regardless.
