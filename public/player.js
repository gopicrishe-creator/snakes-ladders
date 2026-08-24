/* global window, document, io */
'use strict';

const { sessionId, remember, recall, toast, renderDice, tumbleDice, renderLog, STATUS_TEXT } = window.SNL;
const CFG = window.SNL_CONFIG;

const SESSION = sessionId('player');
const socket = io({ transports: ['websocket', 'polling'] });

const $ = (id) => document.getElementById(id);
const screens = { join: $('screen-join'), game: $('screen-game') };

let board = null;
let me = null;            // { playerId, name }
let latest = null;        // last state received
let seenSeq = 0;
let queue = Promise.resolve();
let modalKey = null;      // prevents the modal from re-animating on every state

/* --------------------------------------------------------------- connection */

function setConnChip(state) {
  const chip = $('chip-conn');
  const dot = chip.querySelector('.dot');
  dot.className = `dot ${state === 'live' ? 'live' : state === 'warn' ? 'warn' : 'off'}`;
  chip.lastChild.textContent = state === 'live' ? 'Live' : state === 'warn' ? 'Reconnecting' : 'Offline';
}

socket.on('connect', () => {
  setConnChip('live');
  const code = recall('player:code');
  const name = recall('player:name');
  if (code && name) socket.emit('player:join', { code, name, sessionId: SESSION });
});

socket.on('disconnect', () => setConnChip('warn'));
socket.on('connect_error', () => setConnChip('off'));

socket.on('notice', ({ level, message }) => toast(message, level));

socket.on('joined', (info) => {
  me = { playerId: info.playerId, name: info.name };
  remember('player:code', info.code);
  remember('player:name', info.name);
  screens.join.hidden = true;
  screens.game.hidden = false;
  $('chip-room').hidden = false;
  $('chip-status').hidden = false;
  $('chip-code').textContent = info.code;
  if (!board) {
    board = new window.SNLBoard($('board'), { tray: $('tray') });
  }
  if (info.rejoined) toast(`Welcome back, ${info.name}.`);
});

/* --------------------------------------------------------------------- join */

function submitJoin() {
  const code = $('in-code').value.trim().toUpperCase();
  const name = $('in-name').value.trim();
  if (!code) return toast('Enter the room code from your host.', 'error');
  if (!name) return toast('Enter the name your team will recognise.', 'error');
  return socket.emit('player:join', { code, name, sessionId: SESSION });
}

$('btn-join').addEventListener('click', submitJoin);
['in-code', 'in-name'].forEach((id) => {
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') submitJoin(); });
});
$('in-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });

// Prefill from ?code=SL-1234 so the host can share one link.
const fromUrl = new URLSearchParams(window.location.search).get('code');
if (fromUrl) $('in-code').value = fromUrl.toUpperCase();

/* ------------------------------------------------------------------ actions */

$('btn-roll').addEventListener('click', () => {
  $('btn-roll').disabled = true;   // optimistic lock; the server has the real one
  socket.emit('player:roll');
});

/* -------------------------------------------------------------------- state */

socket.on('state', (state) => {
  latest = state;
  if (!board) board = new window.SNLBoard($('board'), { tray: $('tray') });
  board.syncPlayers(state.players);

  const action = state.lastAction;
  const isNew = action && action.seq > seenSeq;
  if (isNew) seenSeq = action.seq;

  if (isNew && action.kind === 'roll' && typeof action.dice === 'number') {
    tumbleDice($('dice'), action.dice);
  }

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
  const mine = state.players.find((p) => p.isYou);

  // Header
  const chip = $('chip-status');
  chip.querySelector('.dot').className = `dot ${state.status === 'running' ? 'live' : state.status === 'paused' ? 'warn' : ''}`;
  $('chip-status-text').textContent = STATUS_TEXT[state.status] || state.status;

  // Turn card
  const isMyTurn = !!mine && mine.isTurn;
  $('turn-swatch').style.background = active ? active.hex : 'var(--edge)';
  if (state.status === 'lobby') {
    $('turn-label').textContent = 'Lobby';
    $('turn-name').textContent = `${state.players.length} of ${CFG.maxPlayers} here`;
  } else if (state.status === 'finished') {
    const winner = state.players.find((p) => p.id === state.winnerId);
    $('turn-label').textContent = 'Game over';
    $('turn-name').textContent = winner ? `${winner.name} won` : 'Ended by host';
  } else {
    $('turn-label').textContent = isMyTurn ? 'Your turn' : `Turn ${state.turnNumber}`;
    $('turn-name').textContent = active ? (isMyTurn ? 'Go ahead' : active.name) : '—';
  }

  if (mine && mine.lastRoll && !$('dice').classList.contains('rolling')) {
    renderDice($('dice'), active && active.lastRoll ? active.lastRoll : mine.lastRoll);
  } else if (!$('dice').innerHTML) {
    renderDice($('dice'), null);
  }

  // Roll button + the one line explaining why it is off
  const openQuestion = state.pending;
  let note = '';
  let canRoll = false;
  if (state.status === 'lobby') note = "Waiting for the host to start the game.";
  else if (state.status === 'paused') note = 'The host paused the game.';
  else if (state.status === 'finished') note = 'This game is finished.';
  else if (openQuestion && openQuestion.isYours) note = 'Answer your question to climb the ladder.';
  else if (openQuestion) note = `${openQuestion.playerName} is answering a question.`;
  else if (isMyTurn) { note = mine.position === 0 ? 'Roll to get onto the board.' : `You are on square ${mine.position}.`; canRoll = true; }
  else note = active ? `Waiting on ${active.name}.` : 'Waiting for the next turn.';

  $('roll-note').textContent = note;
  $('btn-roll').disabled = !canRoll || state.phase !== 'idle';
  $('btn-roll').textContent = mine && mine.position === CFG.finalSquare ? 'Finished' : 'Roll dice';

  // Roster
  const roster = $('roster');
  roster.innerHTML = '';
  $('count-label').textContent = `${state.players.length} / ${CFG.maxPlayers}`;
  state.players.forEach((p) => {
    const li = document.createElement('li');
    if (p.isTurn) li.classList.add('turn');
    const pin = document.createElement('span');
    pin.className = 'pin';
    pin.style.background = p.hex;
    pin.textContent = p.name.slice(0, 2).toUpperCase();
    const name = document.createElement('span');
    name.className = 'pname';
    name.innerHTML = `${p.name}${p.isYou ? ' <small style="display:inline;color:var(--brass)">you</small>' : ''}`
      + `<small>${p.connected ? '' : 'offline · '}${p.laddersHit} ladder${p.laddersHit === 1 ? '' : 's'} · ${p.snakesHit} snake${p.snakesHit === 1 ? '' : 's'}</small>`;
    const pos = document.createElement('span');
    pos.className = 'pos';
    pos.innerHTML = p.position === 0 ? '<small>start</small>' : String(p.position);
    li.append(pin, name, pos);
    roster.appendChild(li);
  });

  renderLog($('log'), state.log);
  renderModal(state);
}

/* -------------------------------------------------------------------- modal */

function renderModal(state) {
  const host = $('modal-host');

  if (state.status === 'finished' && state.winnerId) {
    const winner = state.players.find((p) => p.id === state.winnerId);
    const key = `win:${state.winnerId}`;
    if (modalKey === key) return;
    modalKey = key;
    host.innerHTML = `
      <div class="scrim">
        <div class="modal win">
          <div class="win-sweep"></div>
          <div class="body" style="text-align:center">
            <div class="trophy">&#127942;</div>
            <div class="eyebrow" style="margin-top:12px">Square 100</div>
            <div class="qtext">${winner ? escapeHtml(winner.name) : 'Someone'} takes the game</div>
            <p style="color:var(--chalk-dim);margin:0">${winner && winner.isYou ? 'Well rolled.' : 'Ask the host to reset the board for another round.'}</p>
          </div>
          <div class="foot"><button class="btn" id="btn-dismiss" style="width:100%">Back to the board</button></div>
        </div>
      </div>`;
    $('btn-dismiss').addEventListener('click', () => { host.innerHTML = ''; modalKey = 'dismissed'; });
    return;
  }

  const pending = state.pending;
  if (!pending) {
    if (modalKey && modalKey.startsWith('q:')) host.innerHTML = '';
    modalKey = null;
    return;
  }

  const key = `q:${pending.playerId}:${pending.landedOn}`;
  if (modalKey === key) return;
  modalKey = key;

  if (pending.isYours && pending.question) {
    host.innerHTML = `
      <div class="scrim">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="q-text">
          <div class="banner">&#129884; Ladder<span class="route">${pending.landedOn} &rarr; ${pending.ladderTo}</span></div>
          <div class="body">
            <div class="eyebrow">Your question${pending.question.set ? ` &middot; set ${pending.question.set}` : ''}</div>
            <div class="qtext" id="q-text">${escapeHtml(pending.question.text)}</div>
            <p class="instruction">Answer this out loud on the Google Meet. Nothing is typed here &mdash; your host is listening in.</p>
          </div>
          <div class="foot">
            <button class="btn btn-primary" id="btn-answered" style="width:100%">I answered &mdash; climb the ladder</button>
          </div>
        </div>
      </div>`;
    const btn = $('btn-answered');
    // Brief hold so nobody dismisses the question before reading it.
    btn.disabled = true;
    setTimeout(() => { btn.disabled = false; }, 900);
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Climbing…';
      socket.emit('player:answered');
    });
  } else {
    host.innerHTML = `
      <div class="scrim">
        <div class="modal watch">
          <div class="banner">&#129884; Ladder<span class="route">${pending.landedOn} &rarr; ${pending.ladderTo}</span></div>
          <div class="body">
            <div class="eyebrow">Over to</div>
            <div class="qtext">${escapeHtml(pending.playerName)}</div>
            <p class="instruction">They have a question on screen and are answering it on the call. The board unlocks when they're done.</p>
          </div>
        </div>
      </div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

renderDice($('dice'), null);
