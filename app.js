// =====================================================================
// DWTS Fan Vote — frontend
//
// Talks to a Google Apps Script web app (see apps-script/Code.gs) that
// reads/writes a Google Sheet. Paste your deployment's /exec URL below.
// =====================================================================

const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzYfeM811zuRMOyuszAIxGH642aPqreFIeCLJNkKV3WvjH40LszHE-0DMGle62jT9rTvA/exec';

const LS_KEY_DEVICE_ID = 'dwts_device_id';
const LS_KEY_NAME = 'dwts_voter_name';
const LS_KEY_RANKING = 'dwts_last_ranking';
const LS_KEY_HAS_VOTED = 'dwts_has_voted';

// A random id persisted in this browser's localStorage — not a real
// hardware/device identifier (the web has no access to one). It's stored
// per-origin, so clearing site data, using a private window, or voting
// from a different browser/device all produce a new id. Good enough to
// stop casual duplicate taps; not fraud-proof.
function getOrCreateDeviceId() {
  let id = localStorage.getItem(LS_KEY_DEVICE_ID);
  if (id) return id;
  id = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'dev-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  localStorage.setItem(LS_KEY_DEVICE_ID, id);
  return id;
}

let contestants = [];   // [{id, name, partner, photo}]
let order = [];         // array of names, current ranking order (index 0 = 1st place)

// ---------- small utils ----------

function $(sel, root) { return (root || document).querySelector(sel); }

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 42%)`;
}

function byName(name) {
  return contestants.find(c => c.name === name) || { name, partner: '' };
}

// The sheet's roster has no PhotoURL column, so the image path is derived
// from the contestant's name to match the images/ folder's naming
// convention (spaces -> underscores, trailing period dropped), e.g.
// "Harry Shum Jr." -> "images/Harry_Shum_Jr.jpg".
function photoPathForName(name) {
  const file = name.trim().replace(/\.$/, '').replace(/\s+/g, '_');
  return 'images/' + file + '.jpg';
}

function setStatus(el, message, kind) {
  el.textContent = message;
  el.className = 'status-msg' + (kind ? ' ' + kind : '');
}

// ---------- ranking list ----------

function shuffledOrder(names) {
  const arr = names.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function avatarEl(person) {
  const div = document.createElement('div');
  div.className = 'avatar';
  div.style.backgroundImage = `url("${photoPathForName(person.name)}")`;
  // If that image 404s (a name that doesn't match a file in images/),
  // fall back to a colored initials block instead of a broken image.
  const probe = new Image();
  probe.onerror = () => {
    div.style.backgroundImage = '';
    div.style.background = colorForName(person.name);
    div.textContent = initials(person.name);
  };
  probe.src = photoPathForName(person.name);
  return div;
}

function renderRankingList() {
  const list = $('#ranking-list');
  list.innerHTML = '';

  order.forEach((name, i) => {
    const person = byName(name);
    const li = document.createElement('li');
    li.className = 'rank-item';
    li.dataset.name = name;

    const photoWrap = document.createElement('div');
    photoWrap.className = 'rank-photo-wrap';
    photoWrap.appendChild(avatarEl(person));

    const info = document.createElement('div');
    info.className = 'rank-info';
    info.innerHTML = `<div class="rank-name"></div><div class="rank-partner"></div>`;
    info.querySelector('.rank-name').textContent = person.name;
    info.querySelector('.rank-partner').textContent = person.partner ? 'with ' + person.partner : '';

    const badge = document.createElement('div');
    badge.className = 'rank-badge';
    badge.textContent = i + 1;

    li.appendChild(photoWrap);
    li.appendChild(info);
    li.appendChild(badge);

    li.addEventListener('pointerdown', onCardPointerDown);

    list.appendChild(li);
  });
}

// ---------- press-and-hold drag reordering (mouse + touch, whole card) ----------
//
// Press anywhere on a card and hold briefly (without much finger/mouse
// movement) to pick it up; move it up or down the list to reorder. A
// quick swipe instead of a hold is left alone so normal page scrolling
// still works when you touch a card without meaning to drag it.

const HOLD_MS = 130;
const MOVE_CANCEL_PX = 10;

let pending = null;   // waiting to see if this becomes a drag
let dragState = null; // an active drag
let autoScrollRAF = null;

function onCardPointerDown(ev) {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  if (dragState || pending) return;

  const li = ev.currentTarget;
  pending = {
    li,
    pointerId: ev.pointerId,
    startX: ev.clientX,
    startY: ev.clientY,
    lastY: ev.clientY,
    scrolling: false, // becomes true once we decide this is a swipe, not a hold
    timer: setTimeout(() => engageDrag(li, ev.pointerId, ev.clientX, ev.clientY), HOLD_MS)
  };

  window.addEventListener('pointermove', onPendingPointerMove);
  window.addEventListener('pointerup', onPendingPointerEnd);
  window.addEventListener('pointercancel', onPendingPointerEnd);
}

function onPendingPointerMove(ev) {
  if (!pending || ev.pointerId !== pending.pointerId) return;

  if (!pending.scrolling) {
    const dx = ev.clientX - pending.startX;
    const dy = ev.clientY - pending.startY;
    if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_PX) {
      clearTimeout(pending.timer);
      pending.scrolling = true;
    }
  }

  if (pending.scrolling) {
    window.scrollBy(0, pending.lastY - ev.clientY);
  }
  pending.lastY = ev.clientY;
}

function onPendingPointerEnd() {
  if (!pending) return;
  clearTimeout(pending.timer);
  cleanupPending();
}

function cleanupPending() {
  window.removeEventListener('pointermove', onPendingPointerMove);
  window.removeEventListener('pointerup', onPendingPointerEnd);
  window.removeEventListener('pointercancel', onPendingPointerEnd);
  pending = null;
}

function engageDrag(li, pointerId, clientX, clientY) {
  cleanupPending();

  const rect = li.getBoundingClientRect();
  const placeholder = document.createElement('li');
  placeholder.className = 'rank-placeholder';
  placeholder.style.height = rect.height + 'px';
  li.parentNode.insertBefore(placeholder, li);

  li.style.position = 'fixed';
  li.style.top = rect.top + 'px';
  li.style.left = rect.left + 'px';
  li.style.width = rect.width + 'px';
  li.style.zIndex = 1000;
  li.classList.add('dragging');
  document.body.appendChild(li);

  try { li.setPointerCapture(pointerId); } catch (e) {}

  dragState = {
    li, placeholder, pointerId,
    startClientY: clientY,
    startTop: rect.top,
    lastClientY: clientY
  };

  window.addEventListener('pointermove', onDragPointerMove);
  window.addEventListener('pointerup', onDragPointerEnd);
  window.addEventListener('pointercancel', onDragPointerEnd);

  if (!autoScrollRAF) autoScrollRAF = requestAnimationFrame(autoScrollStep);
}

function onDragPointerMove(ev) {
  if (!dragState || ev.pointerId !== dragState.pointerId) return;
  dragState.lastClientY = ev.clientY;
  const deltaY = ev.clientY - dragState.startClientY;
  dragState.li.style.top = (dragState.startTop + deltaY) + 'px';
  updatePlaceholderPosition();
}

function updatePlaceholderPosition() {
  if (!dragState) return;
  const { li, placeholder } = dragState;
  const liRect = li.getBoundingClientRect();
  const liCenterY = liRect.top + liRect.height / 2;

  const list = $('#ranking-list');
  const siblings = Array.from(list.children).filter(el => el !== placeholder);
  let target = null;
  for (const sib of siblings) {
    const sibRect = sib.getBoundingClientRect();
    if (liCenterY < sibRect.top + sibRect.height / 2) { target = sib; break; }
  }
  if (target) {
    if (target.previousSibling !== placeholder) list.insertBefore(placeholder, target);
  } else if (list.lastElementChild !== placeholder) {
    list.appendChild(placeholder);
  }
}

function autoScrollStep() {
  if (!dragState) { autoScrollRAF = null; return; }
  const y = dragState.lastClientY;
  const edge = 90;
  const maxSpeed = 16;
  if (y < edge) {
    window.scrollBy(0, -maxSpeed * (1 - y / edge));
    updatePlaceholderPosition();
  } else if (y > window.innerHeight - edge) {
    window.scrollBy(0, maxSpeed * (1 - (window.innerHeight - y) / edge));
    updatePlaceholderPosition();
  }
  autoScrollRAF = requestAnimationFrame(autoScrollStep);
}

function onDragPointerEnd(ev) {
  if (!dragState || ev.pointerId !== dragState.pointerId) return;
  const { li, placeholder } = dragState;

  window.removeEventListener('pointermove', onDragPointerMove);
  window.removeEventListener('pointerup', onDragPointerEnd);
  window.removeEventListener('pointercancel', onDragPointerEnd);

  li.style.position = '';
  li.style.top = '';
  li.style.left = '';
  li.style.width = '';
  li.style.zIndex = '';
  li.classList.remove('dragging');

  placeholder.parentNode.insertBefore(li, placeholder);
  placeholder.remove();

  const list = $('#ranking-list');
  order = Array.from(list.children).map(el => el.dataset.name);

  dragState = null;
  renderRankingList();
}

// ---------- load contestants ----------

async function loadContestants() {
  try {
    const res = await fetch(WEB_APP_URL, { method: 'GET' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    contestants = data.contestants || [];

    const savedRanking = safeParse(localStorage.getItem(LS_KEY_RANKING));
    const savedNames = Array.isArray(savedRanking) ? savedRanking.filter(n => contestants.some(c => c.name === n)) : [];
    const currentNames = contestants.map(c => c.name);
    const missing = currentNames.filter(n => !savedNames.includes(n));

    order = savedNames.length === currentNames.length
      ? savedNames
      : shuffledOrder(currentNames);
    if (missing.length && savedNames.length) order = order.concat(shuffledOrder(missing));

    $('#loading-msg').hidden = true;
    $('#ranking-list').hidden = false;
    renderRankingList();
  } catch (err) {
    $('#loading-msg').textContent = 'Could not load contestants. ' + err.message;
  }
}

function safeParse(str) {
  try { return JSON.parse(str); } catch (e) { return null; }
}

// ---------- vote submission ----------

function prefillVoterInfo() {
  const name = localStorage.getItem(LS_KEY_NAME);
  if (name) $('#voter-name').value = name;
  if (localStorage.getItem(LS_KEY_HAS_VOTED) === 'true') {
    $('#already-voted-banner').hidden = false;
    $('#already-voted-name').textContent = name || 'you';
  }
}

async function submitVote(ev) {
  ev.preventDefault();
  const statusEl = $('#submit-status');
  const submitBtn = $('#submit-btn');
  const name = $('#voter-name').value.trim();
  const comment = $('#voter-comment').value.trim();

  if (!name) {
    setStatus(statusEl, 'Please insert your name.', 'error');
    return;
  }
  if (WEB_APP_URL.indexOf('PASTE_YOUR') === 0) {
    setStatus(statusEl, 'Site not configured yet: add your Apps Script URL to app.js.', 'error');
    return;
  }

  submitBtn.disabled = true;
  setStatus(statusEl, 'Submitting…');

  // The sheet's "votes" tab stores each ranked contestant by NAME directly
  // in the position columns (not an id), so we just send `order` as-is.
  const payload = { name, comment, rankings: order, deviceId: getOrCreateDeviceId() };

  try {
    const res = await fetch(WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');

    localStorage.setItem(LS_KEY_NAME, name);
    localStorage.setItem(LS_KEY_RANKING, JSON.stringify(order));
    localStorage.setItem(LS_KEY_HAS_VOTED, 'true');

    setStatus(statusEl, data.updated ? "Today's vote was updated. Thanks!" : 'Vote submitted. Thanks!', 'success');
    $('#already-voted-banner').hidden = false;
    $('#already-voted-name').textContent = name;
  } catch (err) {
    setStatus(statusEl, 'Something went wrong: ' + err.message, 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

// ---------- init ----------

document.addEventListener('DOMContentLoaded', () => {
  prefillVoterInfo();
  loadContestants();
  $('#vote-form').addEventListener('submit', submitVote);

  // Custom text for the browser's native "required field" popup, instead
  // of the generic "Please fill out this field."
  const nameInput = $('#voter-name');
  nameInput.addEventListener('invalid', () => {
    nameInput.setCustomValidity('Please insert your name.');
  });
  nameInput.addEventListener('input', () => {
    nameInput.setCustomValidity('');
  });
});
