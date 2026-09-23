# DWTS Fan Vote

A fan voting site for Dancing With the Stars. People rank the Season 35 cast from favorite to least favorite by dragging the cards around, and the votes go into a Google Sheet. The site is on GitHub Pages and the "backend" is a Google Apps Script attached to the sheet.

Each device gets one vote per day. If you vote again the same day it replaces your earlier vote instead of adding a new one.

## The sheet

The sheet has two tabs and the script expects them to already exist.

**contestants** - `contestant_id | name | partner_name`

This is the roster. When someone gets eliminated I set their `contestant_id` to `0` and they disappear from the site on the next page load. Nothing in the code has to change.

**votes** - `vote_id | voter_name | date | device_id | 1 | 2 | ... | 16 | comments`

One row per device per day. Columns `1` through `16` hold contestant names in the order that person ranked them, so column `1` is their favorite. Once people get voted off, the extra columns on the end just stay blank.

The script writes to `votes` by column position and doesn't read the header row, so the columns have to be in exactly that order. If I ever move them I need to update the `COL_VOTES_*` constants at the top of `Code.gs`. `contestants` is looked up by header name, so the column order there doesn't matter.

## Files

- `index.html` - the page: name box, the ranking list, an optional comment, and the submit button
- `style.css` - styling
- `app.js` - the frontend logic
- `apps-script/Code.gs` - the Apps Script. It isn't used from this repo, it's a copy of what I pasted into the sheet so it's in version control.
- `images/` - contestant photos, named after the contestant (`Harry Shum Jr.` -> `Harry_Shum_Jr.jpg`)

## app.js

**Setup**

- `WEB_APP_URL` - the Apps Script `/exec` URL
- `getOrCreateDeviceId()` - returns a random ID saved in localStorage, making one the first time. This is what keeps it to one vote per day. It's not a real device ID (browsers don't give you one), so clearing your data or using incognito gets you a new one. Good enough to stop people double tapping, not good enough to stop someone who's trying.

**Helpers**

- `$(sel, root)` - shorthand for `querySelector`
- `initials(name)` - first letter of the first two words. "Tyler Cameron" -> "TC"
- `colorForName(name)` - hashes the name into a hue so each person always gets the same color for their initials block
- `byName(name)` - looks up a contestant object by name
- `photoPathForName(name)` - turns a name into its image path. Spaces become underscores and a trailing period is dropped.
- `setStatus(el, message, kind)` - sets the message under the submit button and adds an `error` or `success` class for the color
- `safeParse(str)` - `JSON.parse` that returns null instead of throwing

**Ranking list**

- `shuffledOrder(names)` - Fisher-Yates shuffle. First-time visitors get a random starting order so whoever is first in the sheet isn't always at the top.
- `avatarEl(person)` - makes the photo div. It also loads the image in the background and if that 404s it swaps to the colored initials block, so there's never a broken image.
- `renderRankingList()` - rebuilds the whole list from `order`: photo, name, "with [partner]", and the rank number, with a pointerdown listener on each card for dragging.

**Drag to reorder**

You have to press and hold a card for a moment (130ms) to pick it up. If your finger moves more than 10px before that, it counts as a scroll instead. Without that you couldn't scroll the page on a phone because every touch landed on a card. It uses pointer events so mouse and touch go through the same code.

- `onCardPointerDown(ev)` - starts the hold timer and remembers where the press started
- `onPendingPointerMove(ev)` - if you move too far before the timer fires, it cancels the drag and scrolls the page by hand instead
- `onPendingPointerEnd()` / `cleanupPending()` - cancel the timer and remove the listeners
- `engageDrag(li, pointerId, x, y)` - picks the card up. It leaves a same-size placeholder where the card was, switches the card to `position: fixed` so it follows your finger, and starts the auto-scroll loop
- `onDragPointerMove(ev)` - moves the card with the pointer
- `updatePlaceholderPosition()` - moves the placeholder to whatever spot the card's center is over, so the other cards slide out of the way
- `autoScrollStep()` - runs every frame while dragging. When you're within 90px of the top or bottom of the screen it scrolls, and it scrolls faster the closer you get to the edge. Without this you couldn't drag something from last place to first on a phone.
- `onDragPointerEnd(ev)` - drops the card where the placeholder is, reads the new order from the DOM, and re-renders

**Loading and voting**

- `loadContestants()` - GETs the roster. If you've voted before and the same people are still in, it reuses your last ranking so you're just adjusting it. If someone new shows up they get shuffled onto the end, and if the saved ranking doesn't match anymore you get a fresh shuffle.
- `prefillVoterInfo()` - fills in your name from last time and shows the "you've already voted" banner if you have
- `submitVote(ev)` - checks you entered a name, then POSTs `{ name, comment, rankings, deviceId }`. It's sent as `text/plain` even though it's JSON, because JSON triggers a CORS preflight that Apps Script can't handle. On success it saves your name and ranking to localStorage and shows whether it was a new vote or an update.

The `DOMContentLoaded` handler at the bottom wires everything up and replaces the browser's default "Please fill out this field" message.

## Code.gs

- `getSS_()` / `getSheet_(name)` - get the spreadsheet or a tab, and throw if the tab is missing
- `jsonOut_(obj)` - wraps an object as a JSON response
- `colIndex_(header, name, sheetLabel)` - finds a column by header name and throws an error with the whole header row in it if it can't.
- `getRemainingRoster_()` - reads `contestants`, skips blank rows and anyone with id 0, and returns `{ name, partner }` for everyone still in
- `doGet(e)` - returns the roster. This is what the site loads.
- `dayKey_(date)` - formats a date as `yyyy-MM-dd` in the sheet's timezone. That's what "same day" is checked against.
- `doPost(e)` - takes a vote. It:
  1. Grabs a script lock (waits up to 30s) so two votes at the same moment can't both append.
  2. Checks there's a name, a device ID, and that the number of ranked names matches how many contestants are still in. If I eliminated someone while you had the page open, it tells you to refresh.
  3. Looks for a row from the same device ID dated today.
  4. If there is one it overwrites that row and keeps the same `vote_id`. If not it appends a new row with a new `vote_id` (`V-` plus part of a UUID).
  5. Returns `{ success, updated, voteId }`.

## Setup

1. Open the sheet, go to Extensions > Apps Script, and paste in `apps-script/Code.gs`.
2. Deploy > New deployment > Web app. Execute as Me, access Anyone. Copy the `/exec` URL.
3. Put that URL in `WEB_APP_URL` at the top of `app.js`.
4. Push to GitHub and turn on Pages (Settings > Pages, main branch, root).

Every time I change `Code.gs` I have to do Deploy > Manage deployments > edit > New version. Just saving doesn't update the live one.

To check results I use `COUNTIF` on the position columns in the `votes` tab. There's no results page on the site on purpose.

## Known issues

- One vote per day is per browser, not per person. See `getOrCreateDeviceId()`.
- "Today" means a calendar day in the sheet's timezone, not 24 hours since your last vote.
- The script doesn't check that the names it gets are real contestants. The site only ever sends real names, but someone could send a request by hand with anything in it.
- If the `votes` columns get rearranged, votes land in the wrong columns without any error.
- It only has room for 16 contestants. More than that means adding columns and changing `NUM_RANK_COLS`.
