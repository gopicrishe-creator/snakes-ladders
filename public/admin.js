/* global window, document, io */
'use strict';

const { sessionId, remember, recall, toast, renderLog, duration, clockTime, STATUS_TEXT } = window.SNL;
const CFG = window.SNL_CONFIG;

const SESSION = sessionId('admin');
const socket = io({ transports: ['websocket', 'polling'] });
const $ = (id) => document.getElementById(id);

let board = null;
let seenSeq = 0;
let queue = Promise.resolve();
let clockTimer = null;
let elapsedBase = 0;
let elapsedAt = 0;
let openHistory = new Set();

/* --------------------------------------------------------------- connection */

function setConnChip(state) {
  const chip = $('chip-conn');
  chip.querySelector('.dot').className = `dot ${state === 'live' ? 'live' : state === 'warn' ? 'warn' : 'off'}`;
  chip.lastChild.textContent = state === 'live' ? 'Live' : state === 'warn' ? 'Reconnecting' : 'Offline';
}

socket.on('connect', () => {
  setConnChip('live');
  const code = recall('admin:code');
  if (code) socket.emit('admin:attach', { code, sessionId: SESSION });
});
socket.on('disconnect', () => setConnChip('warn'));
socket.on('connect_error', () => setConnChip('off'));
socket.on('notice', ({ level, message }) => toast(message, level));

socket.on('joined', (info) => {
  remember('admin:code', info.code);
  $('screen-open').hidden = true;
  $('screen-dash').hidden = false;
  $('chip-room').hidden = false;
  $('chip-status').hidden = false;
  $('chip-code').textContent = info.code;
  $('join-url').textContent = `${window.location.host}/?code=${info.code}`;
  if (!board) board = new window.SNLBoard($('board'), { tray: $('tray') });
});

/* ------------------------------------------------------------------ opening */

$('btn-create').addEventListener('click', () => socket.emit('admin:create', { sessionId: SESSION }));
$('btn-attach').addEventListener('click', () => {
  const code = $('in-code').value.trim().toUpperCase();
  if (!code) return toast('Enter the code of the room you want back.', 'error');
  return socket.emit('admin:attach', { code, sessionId: SESSION });
});
$('in-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
$('in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-attach').click(); });

/* ----------------------------------------------------------------- controls */

const confirmable = {
  'c-reset': 'Reset the board? Everyone returns to the start and question history is cleared.',
  'c-end': 'End the game for everyone?',
};

const wiring = {
  'c-start': 'admin:start',
  'c-pause': 'admin:pause',
  'c-resume': 'admin:resume',
  'c-skip': 'admin:skipTurn',
  'c-force': 'admin:forceAnswer',
  'c-reset': 'admin:reset',
  'c-end': 'admin:end',
};

for (const [id, event] of Object.entries(wiring)) {
  $(id).addEventListener('click', () => {
    if (confirmable[id] && !window.confirm(confirmable[id])) return;
    socket.emit(event);
  });
}

/* -------------------------------------------------------------------- state */

socket.on('state', (state) => {
  if (!board) board = new window.SNLBoard($('board'), { tray: $('tray') });
  board.syncPlayers(state.players);

  const action = state.lastAction;
  const isNew = action && action.seq > seenSeq;
  if (isNew) seenSeq = action.seq;

  if (isNew) {
    queue = queue
      .then(() => board.play(action, state.players))
      .then(() => paint(state))
      .catch(() => paint(state));
  } else {
    board.snap(state.players);
    paint(state);
  }
});

function paint(state) {
  const active = state.players.find((p) => p.id === state.currentPlayerId);

  $('chip-status').querySelector('.dot').className = `dot ${state.status === 'running' ? 'live' : state.status === 'paused' ? 'warn' : ''}`;
  $('chip-status-text').textContent = STATUS_TEXT[state.status] || state.status;

  $('s-status').textContent = STATUS_TEXT[state.status] || state.status;
  $('s-players').textContent = `${state.players.length}/${CFG.maxPlayers}`;
  $('s-turn').textContent = state.turnNumber || '—';
  $('s-current').textContent = state.status === 'running' && active ? active.name : '—';
  $('s-leader').textContent = state.leader || 'Nobody yet';

  startClock(state);

  // Controls reflect what is actually possible right now.
  $('c-start').disabled = state.status === 'running' || state.players.length < 2;
  $('c-pause').disabled = state.status !== 'running';
  $('c-resume').disabled = state.status !== 'paused';
  $('c-skip').disabled = state.status !== 'running' || !!state.pending;
  $('c-force').disabled = !state.pending;
  $('c-end').disabled = state.status === 'finished' || state.status === 'lobby';
  $('c-start').textContent = state.status === 'lobby' && state.turnNumber === 0 ? 'Start game' : 'Restart game';

  $('dice-line').textContent = active && active.lastRoll ? `Last roll ${active.lastRoll} by ${active.name}` : 'No rolls yet';

  // Player table
  const body = $('ptable');
  body.innerHTML = '';
  if (!state.players.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">Share the room code — nobody has joined yet.</td></tr>';
  }
  state.players.forEach((p) => {
    const tr = document.createElement('tr');
    if (p.isTurn) tr.classList.add('turn');

    let status = '<span class="pill wait">Waiting</span>';
    if (state.winnerId === p.id) status = '<span class="pill won">Winner</span>';
    else if (!p.connected) status = '<span class="pill off">Offline</span>';
    else if (state.pending && state.pending.playerId === p.id) status = '<span class="pill answer">Answering</span>';
    else if (p.isTurn) status = '<span class="pill turn">Their turn</span>';

    tr.innerHTML = `
      <td><span class="who"><span class="pin" style="background:${p.hex};width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-family:var(--mono);font-size:10px;font-weight:700;color:#0C2126">${escapeHtml(p.name.slice(0, 2).toUpperCase())}</span> ${escapeHtml(p.name)}</span></td>
      <td class="num">${p.position || '—'}</td>
      <td class="num">${p.lastRoll || '—'}</td>
      <td class="num">${p.laddersHit}</td>
      <td class="num">${p.snakesHit}</td>
      <td class="num">${p.questionsAnswered}</td>
      <td>${status}</td>`;
    body.appendChild(tr);
  });

  // Open question
  const pb = $('pending-box');
  if (state.pending && state.pending.question) {
    pb.className = 'panel-body';
    pb.innerHTML = `
      <div class="eyebrow">${escapeHtml(state.pending.playerName)} &middot; landed on ${state.pending.landedOn} &middot; ladder to ${state.pending.ladderTo}</div>
      <div style="font-family:var(--display);font-size:19px;font-weight:700;line-height:1.25;margin:8px 0 10px">${escapeHtml(state.pending.question.text)}</div>
      <span class="pill answer">Waiting for their answer</span>
      <span class="eyebrow" style="margin-left:8px">Set ${state.pending.question.set || '—'} &middot; ${state.pending.question.id}</span>`;
  } else {
    pb.className = 'empty';
    pb.textContent = 'No question is open right now.';
  }

  // Question history, one collapsible per player
  const qh = $('qhistory');
  const previouslyOpen = new Set(openHistory);
  qh.innerHTML = '';
  const anyone = state.players.some((p) => (p.history || []).length);
  if (!anyone) {
    qh.className = 'empty';
    qh.textContent = 'Questions appear here as players land on ladders.';
  } else {
    qh.className = '';
    state.players.forEach((p) => {
      const hist = p.history || [];
      const d = document.createElement('details');
      d.className = 'qhist';
      d.open = previouslyOpen.has(p.id);
      d.addEventListener('toggle', () => {
        if (d.open) openHistory.add(p.id); else openHistory.delete(p.id);
      });
      const items = hist.map((h) => `<li><b>${escapeHtml(h.text)}</b><br><span class="mono" style="font-size:11px">set ${h.set || '—'} · ${h.landedOn}→${h.ladderTo} · ${h.answeredAt ? `answered ${clockTime(h.answeredAt)}` : 'open'}</span></li>`).join('');
      d.innerHTML = `<summary><span class="pin" style="background:${p.hex};width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-family:var(--mono);font-size:9px;color:#0C2126">${escapeHtml(p.name.slice(0, 2).toUpperCase())}</span>${escapeHtml(p.name)}<span class="count">${hist.length} asked · ${p.questionsUsed || 0} used</span></summary><ol>${items || '<li>None yet.</li>'}</ol>`;
      qh.appendChild(d);
    });
  }

  // Warnings
  const warnPanel = $('panel-warnings');
  const warns = state.warnings || [];
  const logWarns = state.log.filter((e) => e.kind === 'warning').slice(0, 4);
  const all = [...warns.map((w) => w.text), ...logWarns.map((w) => w.text)];
  const unique = [...new Set(all)];
  warnPanel.hidden = unique.length === 0;
  $('warnings').innerHTML = unique.map((t) => `<li>&#9888; ${escapeHtml(t)}</li>`).join('');

  renderLog($('log'), state.log);
}

/* -------------------------------------------------------------------- clock */

function startClock(state) {
  elapsedBase = state.elapsedMs;
  elapsedAt = Date.now();
  const ticking = state.status === 'running';
  $('s-clock').textContent = duration(elapsedBase);
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  if (!ticking) return;
  clockTimer = setInterval(() => {
    $('s-clock').textContent = duration(elapsedBase + (Date.now() - elapsedAt));
  }, 1000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
