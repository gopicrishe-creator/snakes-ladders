'use strict';

const crypto = require('crypto');
const { SNAKES, LADDERS, FINAL_SQUARE, MAX_PLAYERS, PLAYER_COLORS } = require('./board');
const { POOL, FALLBACK_QUESTION } = require('./questions');

/**
 * The game engine. Every function here takes a room and mutates it, returning
 * either { ok: true } or { ok: false, error }. The engine is the only thing
 * allowed to change positions, turns, dice results or question assignments --
 * the browser sends intents ("I want to roll"), never outcomes.
 *
 * Room lifecycle: lobby -> running <-> paused -> finished
 * Turn phases:    idle -> awaiting_answer -> idle   (ladder detour)
 *
 * House rule for the finish: you must land exactly on 100. An overshoot
 * forfeits the move. This is stated in the UI so nobody is surprised.
 */

const LOG_LIMIT = 400;

function id(n = 8) {
  return crypto.randomBytes(16).toString('base64url').slice(0, n);
}

function makeCode() {
  const digits = crypto.randomInt(1000, 10000);
  return `SL-${digits}`;
}

function createRoom(codeExists) {
  let code = makeCode();
  let guard = 0;
  while (codeExists(code) && guard++ < 50) code = makeCode();
  return {
    code,
    adminSession: null,
    status: 'lobby',
    phase: 'idle',
    players: [],
    turnIndex: 0,
    turnNumber: 0,
    winnerId: null,
    pending: null, // { playerId, landedOn, ladderTo, question, assignedAt }
    log: [],
    seq: 0,
    lastAction: null,
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    pausedMs: 0,
    pausedAt: null,
    warnings: [],
  };
}

function logEvent(room, kind, text) {
  room.log.push({ id: id(6), t: Date.now(), turn: room.turnNumber, kind, text });
  if (room.log.length > LOG_LIMIT) room.log.splice(0, room.log.length - LOG_LIMIT);
}

function setAction(room, action) {
  room.seq += 1;
  room.lastAction = { seq: room.seq, at: Date.now(), ...action };
}

function findPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId) || null;
}

function findBySession(room, sessionId) {
  return room.players.find((p) => p.sessionId === sessionId) || null;
}

function activePlayer(room) {
  return room.players[room.turnIndex] || null;
}

/* ------------------------------------------------------------------ joining */

function addPlayer(room, name, sessionId) {
  const clean = String(name || '').trim().slice(0, 18);
  if (!clean) return { ok: false, error: 'Enter a name so the group knows who you are.' };

  const existing = findBySession(room, sessionId);
  if (existing) {
    existing.connected = true;
    logEvent(room, 'join', `${existing.name} reconnected.`);
    return { ok: true, player: existing, rejoined: true };
  }

  if (room.players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, error: 'That name is taken in this room. Try another.' };
  }
  if (room.players.length >= MAX_PLAYERS) {
    return { ok: false, error: `This room is full (${MAX_PLAYERS} players).` };
  }
  if (room.status !== 'lobby') {
    return { ok: false, error: 'This game already started. Ask the host to reset it.' };
  }

  const player = {
    id: id(8),
    sessionId,
    name: clean,
    color: PLAYER_COLORS[room.players.length].key,
    hex: PLAYER_COLORS[room.players.length].hex,
    position: 0,
    lastRoll: null,
    connected: true,
    laddersHit: 0,
    snakesHit: 0,
    questionsAnswered: 0,
    usedQuestionIds: [],
    history: [], // { questionId, set, text, landedOn, ladderTo, assignedAt, answeredAt }
    joinedAt: Date.now(),
  };
  room.players.push(player);
  logEvent(room, 'join', `${player.name} joined as ${player.color}.`);
  setAction(room, { kind: 'join', playerId: player.id });
  return { ok: true, player };
}

function removePlayerIfWaiting(room, playerId) {
  if (room.status !== 'lobby') return { ok: false, error: 'Cannot remove players mid-game.' };
  const i = room.players.findIndex((p) => p.id === playerId);
  if (i === -1) return { ok: false, error: 'No such player.' };
  const [gone] = room.players.splice(i, 1);
  // Re-issue colours so they stay in join order.
  room.players.forEach((p, idx) => {
    p.color = PLAYER_COLORS[idx].key;
    p.hex = PLAYER_COLORS[idx].hex;
  });
  logEvent(room, 'admin', `${gone.name} was removed from the room.`);
  return { ok: true };
}

/* ------------------------------------------------------- admin game control */

function startGame(room) {
  if (room.status === 'running') return { ok: false, error: 'The game is already running.' };
  if (room.players.length < 2) return { ok: false, error: 'You need at least 2 players to start.' };
  room.status = 'running';
  room.phase = 'idle';
  room.turnIndex = 0;
  room.turnNumber = 1;
  room.startedAt = Date.now();
  room.pausedMs = 0;
  room.pausedAt = null;
  logEvent(room, 'admin', `Game started with ${room.players.length} players.`);
  logEvent(room, 'turn', `${activePlayer(room).name}'s turn.`);
  setAction(room, { kind: 'start' });
  return { ok: true };
}

function pauseGame(room) {
  if (room.status !== 'running') return { ok: false, error: 'Nothing to pause.' };
  room.status = 'paused';
  room.pausedAt = Date.now();
  logEvent(room, 'admin', 'Game paused.');
  setAction(room, { kind: 'pause' });
  return { ok: true };
}

function resumeGame(room) {
  if (room.status !== 'paused') return { ok: false, error: 'The game is not paused.' };
  room.status = 'running';
  room.pausedMs += Date.now() - (room.pausedAt || Date.now());
  room.pausedAt = null;
  logEvent(room, 'admin', 'Game resumed.');
  setAction(room, { kind: 'resume' });
  return { ok: true };
}

function endGame(room) {
  room.status = 'finished';
  room.phase = 'idle';
  room.pending = null;
  room.endedAt = Date.now();
  logEvent(room, 'admin', 'Game ended by the host.');
  setAction(room, { kind: 'end' });
  return { ok: true };
}

/** Keeps the same people in the room, clears the board and question history. */
function resetGame(room) {
  room.status = 'lobby';
  room.phase = 'idle';
  room.pending = null;
  room.winnerId = null;
  room.turnIndex = 0;
  room.turnNumber = 0;
  room.startedAt = null;
  room.endedAt = null;
  room.pausedMs = 0;
  room.pausedAt = null;
  room.warnings = [];
  room.players.forEach((p) => {
    p.position = 0;
    p.lastRoll = null;
    p.laddersHit = 0;
    p.snakesHit = 0;
    p.questionsAnswered = 0;
    p.usedQuestionIds = [];
    p.history = [];
  });
  logEvent(room, 'admin', 'Board reset. Everyone back to the start, question history cleared.');
  setAction(room, { kind: 'reset' });
  return { ok: true };
}

/* ----------------------------------------------------------- question logic */

/**
 * Randomly assigns a question this player has not seen in this session.
 * SET 1 is drained first, then SET 2 opens automatically. Randomisation is
 * per player, so two players can be asked the same question.
 */
function assignQuestion(room, player) {
  const unused = (set) => POOL.filter((q) => q.set === set && !player.usedQuestionIds.includes(q.id));
  let pool = unused(1);
  let openedSet2 = false;
  if (pool.length === 0) {
    pool = unused(2);
    openedSet2 = true;
  }
  if (pool.length === 0) {
    room.warnings.push({
      id: id(6),
      t: Date.now(),
      text: `${player.name} has used every question in both sets. They were given a free prompt instead.`,
    });
    logEvent(room, 'warning', `Question pool exhausted for ${player.name} — free prompt issued.`);
    return { ...FALLBACK_QUESTION };
  }
  const q = pool[crypto.randomInt(0, pool.length)];
  if (openedSet2 && !player.usedQuestionIds.some((qid) => qid.startsWith('S2-'))) {
    logEvent(room, 'question', `${player.name} finished Set 1 — now drawing from Set 2.`);
  }
  return q;
}

/* --------------------------------------------------------------- turn logic */

function advanceTurn(room) {
  room.phase = 'idle';
  room.pending = null;
  if (room.status === 'finished') return;

  const n = room.players.length;
  if (n === 0) return;

  // Skip players who have dropped off the call, but never loop forever.
  let next = room.turnIndex;
  for (let i = 1; i <= n; i += 1) {
    const candidate = (room.turnIndex + i) % n;
    next = candidate;
    if (room.players[candidate].connected) break;
  }
  room.turnIndex = next;
  room.turnNumber += 1;
  const p = activePlayer(room);
  logEvent(room, 'turn', `${p.name}'s turn.${p.connected ? '' : ' (disconnected — host can skip)'}`);
  setAction(room, { kind: 'turn', playerId: p.id });
}

function skipTurn(room, reason = 'Host skipped the turn.') {
  if (room.status !== 'running') return { ok: false, error: 'The game is not running.' };
  const p = activePlayer(room);
  if (!p) return { ok: false, error: 'Nobody to skip.' };
  logEvent(room, 'admin', `${p.name}'s turn skipped. ${reason}`);
  advanceTurn(room);
  return { ok: true };
}

/**
 * The one and only place a dice result is produced.
 */
function rollDice(room, playerId) {
  if (room.status === 'lobby') return { ok: false, error: 'The host has not started the game yet.' };
  if (room.status === 'paused') return { ok: false, error: 'The game is paused.' };
  if (room.status === 'finished') return { ok: false, error: 'This game is over.' };
  if (room.phase === 'awaiting_answer') {
    return { ok: false, error: 'A question is still open. Finish it first.' };
  }
  if (room.phase !== 'idle') return { ok: false, error: 'Hold on — the board is still moving.' };

  const player = activePlayer(room);
  if (!player || player.id !== playerId) return { ok: false, error: 'It is not your turn.' };

  // Lock immediately so a double-click or a laggy retry cannot roll twice.
  room.phase = 'rolling';

  const dice = crypto.randomInt(1, 7);
  player.lastRoll = dice;
  const from = player.position;
  const target = from + dice;

  if (target > FINAL_SQUARE) {
    logEvent(room, 'roll', `${player.name} rolled ${dice} — needs exactly ${FINAL_SQUARE - from} to finish, so the move is forfeited.`);
    setAction(room, { kind: 'roll', playerId: player.id, dice, from, to: from, outcome: 'overshoot' });
    advanceTurn(room);
    return { ok: true };
  }

  player.position = target;
  logEvent(room, 'roll', `${player.name} rolled ${dice} and moved ${from} → ${target}.`);

  if (target === FINAL_SQUARE) {
    room.winnerId = player.id;
    room.status = 'finished';
    room.phase = 'idle';
    room.endedAt = Date.now();
    logEvent(room, 'win', `${player.name} reached ${FINAL_SQUARE} and won the game.`);
    setAction(room, { kind: 'roll', playerId: player.id, dice, from, to: target, outcome: 'win' });
    return { ok: true };
  }

  const snakeTail = SNAKES[target];
  if (snakeTail !== undefined) {
    player.position = snakeTail;
    player.snakesHit += 1;
    logEvent(room, 'snake', `${player.name} hit a snake at ${target} and slid down to ${snakeTail}.`);
    setAction(room, {
      kind: 'roll', playerId: player.id, dice, from, to: target,
      outcome: 'snake', slideTo: snakeTail,
    });
    advanceTurn(room);
    return { ok: true };
  }

  const ladderTop = LADDERS[target];
  if (ladderTop !== undefined) {
    const question = assignQuestion(room, player);
    if (question.id !== 'FREE') player.usedQuestionIds.push(question.id);
    player.laddersHit += 1;
    room.phase = 'awaiting_answer';
    room.pending = {
      playerId: player.id,
      landedOn: target,
      ladderTo: ladderTop,
      question,
      assignedAt: Date.now(),
    };
    player.history.push({
      questionId: question.id,
      set: question.set,
      text: question.text,
      landedOn: target,
      ladderTo: ladderTop,
      assignedAt: Date.now(),
      answeredAt: null,
    });
    logEvent(room, 'ladder', `${player.name} landed on a ladder at ${target} (→ ${ladderTop}).`);
    logEvent(room, 'question', `Question assigned to ${player.name}: "${question.text}"`);
    setAction(room, {
      kind: 'roll', playerId: player.id, dice, from, to: target,
      outcome: 'ladder', ladderTo: ladderTop,
    });
    return { ok: true };
  }

  setAction(room, { kind: 'roll', playerId: player.id, dice, from, to: target, outcome: 'plain' });
  advanceTurn(room);
  return { ok: true };
}

/**
 * The player has answered out loud on the call and pressed the button.
 * `byAdmin` lets the host unblock a player who dropped off mid-question.
 */
function submitAnswer(room, playerId, byAdmin = false) {
  if (room.phase !== 'awaiting_answer' || !room.pending) {
    return { ok: false, error: 'There is no open question.' };
  }
  if (!byAdmin && room.pending.playerId !== playerId) {
    return { ok: false, error: 'This question belongs to another player.' };
  }
  if (room.status === 'paused') return { ok: false, error: 'The game is paused.' };

  const player = findPlayer(room, room.pending.playerId);
  const { landedOn, ladderTo, question } = room.pending;

  player.position = ladderTo;
  player.questionsAnswered += 1;
  const entry = player.history[player.history.length - 1];
  if (entry && entry.answeredAt === null) entry.answeredAt = Date.now();

  logEvent(
    room,
    'answer',
    `${player.name} answered${byAdmin ? ' (marked by host)' : ''} and climbed ${landedOn} → ${ladderTo}.`,
  );

  setAction(room, {
    kind: 'climb', playerId: player.id, from: landedOn, to: ladderTo, questionId: question.id,
  });

  if (ladderTo === FINAL_SQUARE) {
    room.winnerId = player.id;
    room.status = 'finished';
    room.phase = 'idle';
    room.pending = null;
    room.endedAt = Date.now();
    logEvent(room, 'win', `${player.name} reached ${FINAL_SQUARE} and won the game.`);
    return { ok: true };
  }

  advanceTurn(room);
  return { ok: true };
}

/* ------------------------------------------------------------------- views */

function leaderName(room) {
  if (room.players.length === 0) return null;
  const sorted = [...room.players].sort((a, b) => b.position - a.position);
  if (sorted[0].position === 0) return null;
  const tied = sorted.filter((p) => p.position === sorted[0].position);
  return tied.length > 1 ? `${tied.length}-way tie` : sorted[0].name;
}

function elapsedMs(room) {
  if (!room.startedAt) return 0;
  const end = room.endedAt || Date.now();
  const paused = room.pausedMs + (room.pausedAt ? Date.now() - room.pausedAt : 0);
  return Math.max(0, end - room.startedAt - paused);
}

/**
 * Builds the state a given viewer is allowed to see.
 * Players never receive another player's question text, and nobody but the
 * host receives question history. The pool is never sent to anyone.
 */
function viewFor(room, viewer) {
  const isAdmin = viewer.role === 'admin';
  const active = activePlayer(room);

  const players = room.players.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    hex: p.hex,
    position: p.position,
    lastRoll: p.lastRoll,
    connected: p.connected,
    laddersHit: p.laddersHit,
    snakesHit: p.snakesHit,
    questionsAnswered: p.questionsAnswered,
    isTurn: !!active && active.id === p.id && room.status === 'running',
    isYou: p.id === viewer.playerId,
    questionsUsed: isAdmin ? p.usedQuestionIds.length : undefined,
    history: isAdmin ? p.history : undefined,
  }));

  let pending = null;
  if (room.pending) {
    const owner = findPlayer(room, room.pending.playerId);
    const visible = isAdmin || room.pending.playerId === viewer.playerId;
    pending = {
      playerId: room.pending.playerId,
      playerName: owner ? owner.name : 'Player',
      landedOn: room.pending.landedOn,
      ladderTo: room.pending.ladderTo,
      isYours: room.pending.playerId === viewer.playerId,
      question: visible ? room.pending.question : null,
    };
  }

  return {
    code: room.code,
    status: room.status,
    phase: room.phase,
    turnNumber: room.turnNumber,
    currentPlayerId: active ? active.id : null,
    winnerId: room.winnerId,
    players,
    pending,
    seq: room.seq,
    lastAction: room.lastAction,
    elapsedMs: elapsedMs(room),
    leader: leaderName(room),
    connectedCount: room.players.filter((p) => p.connected).length,
    log: room.log.slice(-60).reverse(),
    warnings: isAdmin ? room.warnings.slice(-10) : [],
    you: viewer.playerId || null,
    role: viewer.role,
  };
}

module.exports = {
  createRoom,
  addPlayer,
  removePlayerIfWaiting,
  startGame,
  pauseGame,
  resumeGame,
  endGame,
  resetGame,
  rollDice,
  submitAnswer,
  skipTurn,
  advanceTurn,
  findPlayer,
  findBySession,
  activePlayer,
  viewFor,
  logEvent,
  setAction,
  elapsedMs,
};
