const SHEET_NAME_CONTESTANTS = 'contestants';
const SHEET_NAME_VOTES = 'votes';

const NUM_RANK_COLS = 16;
const COL_VOTES_VOTE_ID = 0;
const COL_VOTES_VOTER_NAME = 1;
const COL_VOTES_DATE = 2;
const COL_VOTES_DEVICE_ID = 3;
const COL_VOTES_RANK_START = 4;
const COL_VOTES_COMMENTS = COL_VOTES_RANK_START + NUM_RANK_COLS;
const VOTES_ROW_WIDTH = COL_VOTES_COMMENTS + 1;

function getSS_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name) {
  const sheet = getSS_().getSheetByName(name);
  if (!sheet) throw new Error('Missing "' + name + '" tab');
  return sheet;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function colIndex_(header, name, sheetLabel) {
  const i = header.indexOf(name);
  if (i === -1) {
    throw new Error('Expected a column named "' + name + '" in the "' + sheetLabel + '" tab but did not find one. Header row was: [' + header.join(', ') + ']');
  }
  return i;
}

function getRemainingRoster_() {
  const sheet = getSheet_(SHEET_NAME_CONTESTANTS);
  const data = sheet.getDataRange().getValues();
  const header = data.shift();
  const idx = {
    id: colIndex_(header, 'contestant_id', SHEET_NAME_CONTESTANTS),
    name: colIndex_(header, 'name', SHEET_NAME_CONTESTANTS),
    partner: colIndex_(header, 'partner_name', SHEET_NAME_CONTESTANTS)
  };
  return data
    .filter(function (row) { return row[idx.name]; })
    .filter(function (row) { return String(row[idx.id]).trim() !== '0'; })
    .map(function (row) {
      return {
        name: String(row[idx.name]).trim(),
        partner: String(row[idx.partner] || '').trim()
      };
    });
}

function doGet(e) {
  try {
    return jsonOut_({ contestants: getRemainingRoster_() });
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}

function dayKey_(date) {
  const tz = getSS_().getSpreadsheetTimeZone();
  return Utilities.formatDate(date, tz, 'yyyy-MM-dd');
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return jsonOut_({ success: false, error: 'Server is busy, please try again in a moment.' });
  }

  try {
    const payload = JSON.parse(e.postData.contents);
    const voterName = String(payload.name || '').trim();
    const deviceId = String(payload.deviceId || '').trim();
    const comment = String(payload.comment || '').trim().slice(0, 1000);
    const rankings = payload.rankings;

    if (!voterName) return jsonOut_({ success: false, error: 'Name is required.' });
    if (!deviceId) {
      return jsonOut_({ success: false, error: 'Missing device id — please reload the page and try again.' });
    }
    if (!Array.isArray(rankings) || rankings.length === 0) {
      return jsonOut_({ success: false, error: 'Rankings are required.' });
    }
    if (rankings.length > NUM_RANK_COLS) {
      return jsonOut_({ success: false, error: 'Too many ranked contestants (max ' + NUM_RANK_COLS + ').' });
    }

    const numRemaining = getRemainingRoster_().length;
    if (rankings.length !== numRemaining) {
      return jsonOut_({
        success: false,
        error: 'Expected ' + numRemaining + ' ranked contestants (that\'s how many are still in the running), got ' +
          rankings.length + '. Please refresh the page and try again.'
      });
    }

    const votesSheet = getSheet_(SHEET_NAME_VOTES);
    const now = new Date();
    const today = dayKey_(now);

    const votesData = votesSheet.getDataRange().getValues();
    let existingRowIndex = -1;
    let existingVoteId = null;
    for (let i = 1; i < votesData.length; i++) {
      const rowDate = votesData[i][COL_VOTES_DATE];
      if (String(votesData[i][COL_VOTES_DEVICE_ID]).trim() === deviceId &&
        rowDate instanceof Date && dayKey_(rowDate) === today) {
        existingRowIndex = i + 1;
        existingVoteId = votesData[i][COL_VOTES_VOTE_ID];
        break;
      }
    }

    const rowArr = new Array(VOTES_ROW_WIDTH).fill('');
    rowArr[COL_VOTES_VOTER_NAME] = voterName;
    rowArr[COL_VOTES_DATE] = now;
    rowArr[COL_VOTES_DEVICE_ID] = deviceId;
    rankings.forEach(function (contestantName, i) { rowArr[COL_VOTES_RANK_START + i] = contestantName; });
    rowArr[COL_VOTES_COMMENTS] = comment;

    let voteId, updated;
    if (existingRowIndex > -1) {
      voteId = existingVoteId;
      updated = true;
      rowArr[COL_VOTES_VOTE_ID] = voteId;
      votesSheet.getRange(existingRowIndex, 1, 1, VOTES_ROW_WIDTH).setValues([rowArr]);
    } else {
      voteId = 'V-' + Utilities.getUuid().split('-')[0];
      updated = false;
      rowArr[COL_VOTES_VOTE_ID] = voteId;
      votesSheet.appendRow(rowArr);
    }

    return jsonOut_({ success: true, updated: updated, voteId: voteId });
  } catch (err) {
    return jsonOut_({ success: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
