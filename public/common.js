/* global window, document, io, localStorage */
'use strict';

/** A stable per-browser id so a refresh returns you to your own token. */
function sessionId(scope) {
  const key = `snl:session:${scope}`;
  let value = null;
  try { value = localStorage.getItem(key); } catch (_) { /* private mode */ }
  if (!value) {
    value = `${scope}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    try { localStorage.setItem(key, value); } catch (_) { /* ignore */ }
  }
  return value;
}

function remember(key, value) {
  try {
    if (value === null) localStorage.removeItem(`snl:${key}`);
    else localStorage.setItem(`snl:${key}`, value);
  } catch (_) { /* ignore */ }
}

function recall(key) {
  try { return localStorage.getItem(`snl:${key}`); } catch (_) { return null; }
}

/* ------------------------------------------------------------------ toasts */

function toast(message, level = 'info') {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.appendChild(host);
  }
  const node = document.createElement('div');
  node.className = `toast ${level === 'error' ? 'error' : ''}`;
  node.textContent = message;
  node.setAttribute('role', 'status');
  host.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity 200ms ease';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 220);
  }, 4200);
}

/* -------------------------------------------------------------------- dice */

const PIPS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function renderDice(node, value) {
  node.innerHTML = '';
  const on = new Set(PIPS[value] || []);
  for (let i = 0; i < 9; i += 1) {
    const pip = document.createElement('i');
    pip.className = `pip ${on.has(i) ? '' : 'off'}`;
    node.appendChild(pip);
  }
  node.setAttribute('aria-label', value ? `Dice shows ${value}` : 'Dice not rolled yet');
}

function tumbleDice(node, finalValue) {
  node.classList.remove('rolling');
  void node.offsetWidth;
  node.classList.add('rolling');
  let ticks = 0;
  const spin = setInterval(() => {
    renderDice(node, 1 + Math.floor(Math.random() * 6));
    ticks += 1;
    if (ticks > 5) {
      clearInterval(spin);
      renderDice(node, finalValue);
    }
  }, 90);
  setTimeout(() => node.classList.remove('rolling'), 660);
}

/* --------------------------------------------------------------------- misc */

function clockTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function duration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function renderLog(list, entries) {
  list.innerHTML = '';
  if (!entries.length) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="t"></span><span>Nothing has happened yet.</span>';
    list.appendChild(li);
    return;
  }
  entries.forEach((e) => {
    const li = document.createElement('li');
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = clockTime(e.t);
    const body = document.createElement('span');
    body.className = `k-${e.kind}`;
    body.textContent = e.text;
    li.append(t, body);
    list.appendChild(li);
  });
}

const STATUS_TEXT = {
  lobby: 'Waiting in the lobby',
  running: 'In play',
  paused: 'Paused',
  finished: 'Finished',
};

window.SNL = {
  sessionId, remember, recall, toast, renderDice, tumbleDice,
  clockTime, duration, renderLog, STATUS_TEXT,
};
