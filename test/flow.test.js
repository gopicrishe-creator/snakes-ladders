'use strict';

/**
 * Run with: npm test
 * Part 1 exercises the engine directly (deterministic, forces every branch).
 * Part 2 boots the real server and plays a game over websockets.
 */

const assert = require('assert');
const G = require('../src/game');
const { SNAKES, LADDERS } = require('../src/board');
const { POOL } = require('../src/questions');

let pass = 0;
function ok(label) { pass += 1; console.log(`  \u2713 ${label}`); }

/* ---------------------------------------------------------------- part one */

function room() {
  const r = G.createRoom(() => false);
  G.addPlayer(r, 'Ana', 's1');
  G.addPlayer(r, 'Bo', 's2');
  G.addPlayer(r, 'Cy', 's3');
  return r;
}

console.log('\nEngine');

{
  const r = G.createRoom(() => false);
  assert.match(r.code, /^SL-\d{4}$/);
  ok('room codes look like SL-1234');
}

{
  const r = G.createRoom(() => false);
  for (let i = 0; i < 5; i += 1) assert.ok(G.addPlayer(r, `P${i}`, `s${i}`).ok);
  const sixth = G.addPlayer(r, 'P5', 's5');
  assert.strictEqual(sixth.ok, false);
  ok('the sixth player is turned away');
}

{
  const r = G.createRoom(() => false);
  G.addPlayer(r, 'Ana', 's1');
  assert.strictEqual(G.addPlayer(r, 'ana', 's9').ok, false);
  ok('duplicate names are rejected');
}

{
  const r = G.createRoom(() => false);
  G.addPlayer(r, 'Ana', 's1');
  const again = G.addPlayer(r, 'Ana', 's1');
  assert.ok(again.ok && again.rejoined && r.players.length === 1);
  ok('the same session rejoins its own token');
}

{
  const r = G.createRoom(() => false);
  G.addPlayer(r, 'Solo', 's1');
  assert.strictEqual(G.startGame(r).ok, false);
  ok('one player cannot start a game');
}

{
  const r = room();
  assert.strictEqual(G.rollDice(r, r.players[0].id).ok, false);
  ok('nobody rolls before the host starts');
}

{
  const r = room();
  G.startGame(r);
  assert.strictEqual(G.rollDice(r, r.players[1].id).ok, false);
  ok('rolling out of turn is refused');
}

{
  const r = room();
  G.startGame(r);
  const me = r.players[0].id;
  G.rollDice(r, me);
  // Second roll in the same beat must be rejected whatever the phase became.
  assert.strictEqual(G.rollDice(r, me).ok, false);
  ok('a double-click cannot roll twice');
}

{
  // Snake: put the player one below a snake head and force the dice.
  const head = Number(Object.keys(SNAKES)[0]);
  const r = room();
  G.startGame(r);
  r.players[0].position = head - 1;
  const orig = require('crypto').randomInt;
  require('crypto').randomInt = () => 1;
  G.rollDice(r, r.players[0].id);
  require('crypto').randomInt = orig;
  assert.strictEqual(r.players[0].position, SNAKES[head]);
  assert.strictEqual(r.players[0].snakesHit, 1);
  assert.strictEqual(r.phase, 'idle');
  ok('a snake slides you down with no question');
}

{
  const foot = Number(Object.keys(LADDERS)[0]);
  const r = room();
  G.startGame(r);
  r.players[0].position = foot - 1;
  const crypto = require('crypto');
  const orig = crypto.randomInt;
  crypto.randomInt = (a) => a;
  G.rollDice(r, r.players[0].id);
  crypto.randomInt = orig;

  assert.strictEqual(r.phase, 'awaiting_answer');
  assert.strictEqual(r.players[0].position, foot, 'waits at the ladder foot');
  assert.ok(r.pending.question.text.length > 10);
  assert.strictEqual(G.rollDice(r, r.players[0].id).ok, false, 'board is locked');
  assert.strictEqual(G.submitAnswer(r, r.players[1].id).ok, false, 'not your question');

  assert.ok(G.submitAnswer(r, r.players[0].id).ok);
  assert.strictEqual(r.players[0].position, LADDERS[foot]);
  assert.strictEqual(r.players[0].questionsAnswered, 1);
  assert.strictEqual(r.phase, 'idle');
  ok('a ladder holds you until you answer, then lifts you');
}

{
  // Exhaust set 1 for one player and confirm set 2 opens, then the fallback.
  const r = room();
  G.startGame(r);
  const p = r.players[0];
  const drawn = [];

  /** Forces this player onto a ladder and returns the question they drew. */
  function drawOnce(target) {
    const foot = Number(Object.keys(LADDERS)[0]);
    target.position = foot - 1;
    r.phase = 'idle';
    r.status = 'running';
    r.turnIndex = r.players.indexOf(target);
    const crypto = require('crypto');
    const orig = crypto.randomInt;
    crypto.randomInt = (a) => a;
    G.rollDice(r, target.id);
    crypto.randomInt = orig;
    const got = r.pending.question;
    G.submitAnswer(r, target.id);
    return got;
  }

  for (let i = 0; i < 26; i += 1) drawn.push(drawOnce(p));
  const ids = drawn.map((q) => q.id);
  const set1 = ids.filter((i) => i.startsWith('S1-'));
  const set2 = ids.filter((i) => i.startsWith('S2-'));
  const free = ids.filter((i) => i === 'FREE');

  assert.strictEqual(new Set(set1).size, 16, 'all 16 set-1 questions used exactly once');
  assert.strictEqual(new Set(set2).size, 10, 'all 10 set-2 questions used exactly once');
  assert.strictEqual(ids.slice(0, 16).every((i) => i.startsWith('S1-')), true, 'set 1 drains first');
  assert.strictEqual(free.length, 0, '26 draws exactly empties both sets');
  ok('set 1 drains before set 2, with no repeats for that player');

  // 27th draw must hit the graceful fallback and warn the host.
  p.position = Number(Object.keys(LADDERS)[0]) - 1;
  r.phase = 'idle'; r.turnIndex = 0; r.status = 'running';
  const crypto = require('crypto');
  const orig = crypto.randomInt;
  crypto.randomInt = (a) => a;
  G.rollDice(r, p.id);
  crypto.randomInt = orig;
  assert.strictEqual(r.pending.question.id, 'FREE');
  assert.ok(r.warnings.length >= 1);
  ok('exhausting both sets warns the host instead of repeating');

  // Another player is unaffected by player one's history.
  assert.strictEqual(r.players[1].usedQuestionIds.length, 0);
  ok('question history is per player, not global');
}

{
  const r = room();
  G.startGame(r);
  r.players[0].position = 98;
  const crypto = require('crypto');
  const orig = crypto.randomInt;
  crypto.randomInt = () => 5; // would be 103
  G.rollDice(r, r.players[0].id);
  crypto.randomInt = orig;
  assert.strictEqual(r.players[0].position, 98, 'overshoot forfeits the move');
  assert.strictEqual(r.status, 'running');
  ok('you need an exact roll to finish');
}

{
  const r = room();
  G.startGame(r);
  r.players[0].position = 97;
  const crypto = require('crypto');
  const orig = crypto.randomInt;
  crypto.randomInt = () => 3;
  G.rollDice(r, r.players[0].id);
  crypto.randomInt = orig;
  assert.strictEqual(r.winnerId, r.players[0].id);
  assert.strictEqual(r.status, 'finished');
  assert.strictEqual(G.rollDice(r, r.players[1].id).ok, false);
  ok('landing on 100 wins and stops the game');
}

{
  const r = room();
  G.startGame(r);
  G.pauseGame(r);
  assert.strictEqual(G.rollDice(r, r.players[0].id).ok, false);
  assert.ok(G.resumeGame(r).ok);
  assert.ok(G.rollDice(r, r.players[0].id).ok);
  ok('pause blocks rolls, resume restores them');
}

{
  const r = room();
  G.startGame(r);
  r.players[1].connected = false;
  const crypto = require('crypto');
  const orig = crypto.randomInt;
  crypto.randomInt = () => 2; // square 2 is an ordinary square
  G.rollDice(r, r.players[0].id);
  crypto.randomInt = orig;
  // Bo is offline, so the turn should have travelled to Cy.
  assert.strictEqual(G.activePlayer(r).name, 'Cy');
  ok('a disconnected player is skipped automatically');
}

{
  const r = room();
  G.startGame(r);
  r.players[0].position = 40;
  G.resetGame(r);
  assert.strictEqual(r.players[0].position, 0);
  assert.strictEqual(r.status, 'lobby');
  assert.strictEqual(r.players.length, 3, 'players stay in the room');
  ok('reset clears the board but keeps the room');
}

{
  const r = room();
  const view = G.viewFor(r, { role: 'player', playerId: r.players[0].id });
  assert.strictEqual(view.players[1].history, undefined);
  const adminView = G.viewFor(r, { role: 'admin', playerId: null });
  assert.ok(Array.isArray(adminView.players[1].history));
  ok('players cannot see other players\u2019 question history');
}

{
  const r = room();
  G.startGame(r);
  const foot = Number(Object.keys(LADDERS)[0]);
  r.players[0].position = foot - 1;
  const crypto = require('crypto');
  const orig = crypto.randomInt;
  crypto.randomInt = (a) => a;
  G.rollDice(r, r.players[0].id);
  crypto.randomInt = orig;
  const other = G.viewFor(r, { role: 'player', playerId: r.players[1].id });
  assert.strictEqual(other.pending.question, null, 'question text withheld');
  assert.strictEqual(other.pending.playerName, 'Ana', 'but they know who is up');
  ok('a question is only sent to the player it belongs to');
}

{
  assert.strictEqual(POOL.filter((q) => q.set === 1).length, 16);
  assert.strictEqual(POOL.filter((q) => q.set === 2).length, 10);
  assert.strictEqual(new Set(POOL.map((q) => q.text)).size, 26);
  assert.strictEqual(Object.keys(SNAKES).length, 11);
  assert.strictEqual(Object.keys(LADDERS).length, 6);
  const heads = Object.keys(SNAKES).map(Number);
  const feet = Object.keys(LADDERS).map(Number);
  assert.strictEqual(heads.some((h) => feet.includes(h)), false, 'no square is both');
  const tops = Object.values(LADDERS);
  assert.strictEqual(tops.some((t) => heads.includes(t)), false, 'no ladder drops you on a snake head');
  ok('board and question pools are well formed (11 snakes, 6 ladders, 26 questions)');
}

/* ---------------------------------------------------------------- part two */

process.env.PORT = '4599';
const { server, rooms } = require('../server');
const ioc = require('socket.io-client');
const URL = 'http://localhost:4599';

const once = (sock, event) => new Promise((res) => sock.once(event, res));

/** Remembers the most recent state so a wait can never miss one. */
const track = (sock) => {
  sock.latest = null;
  sock.on('state', (s) => { sock.latest = s; });
  return sock;
};

function waitState(sock, predicate, label = 'state') {
  if (sock.latest && predicate(sock.latest)) return Promise.resolve(sock.latest);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.off('state', handler);
      reject(new Error(`timed out waiting for ${label}`));
    }, 4000);
    function handler(s) {
      if (predicate(s)) {
        clearTimeout(timer);
        sock.off('state', handler);
        resolve(s);
      }
    }
    sock.on('state', handler);
  });
}

(async () => {
  console.log('\nLive server');
  await new Promise((r) => setTimeout(r, 300));

  const admin = track(ioc(URL, { transports: ['websocket'] }));
  await once(admin, 'connect');
  admin.emit('admin:create', { sessionId: 'host-test' });
  const created = await once(admin, 'joined');
  const code = created.code;
  ok(`host created room ${code}`);

  const a = track(ioc(URL, { transports: ['websocket'] }));
  const b = track(ioc(URL, { transports: ['websocket'] }));
  await Promise.all([once(a, 'connect'), once(b, 'connect')]);
  a.emit('player:join', { code, name: 'Ana', sessionId: 'pa' });
  b.emit('player:join', { code, name: 'Bo', sessionId: 'pb' });
  const [ja, jb] = await Promise.all([once(a, 'joined'), once(b, 'joined')]);
  ok('two players joined the same room');

  const adminSeesBoth = await waitState(admin, (s) => s.players.length === 2, 'both players');
  assert.strictEqual(adminSeesBoth.players.length, 2);
  ok('the host dashboard updated without a refresh');

  // Wrong room code is refused.
  const c = ioc(URL, { transports: ['websocket'] });
  await once(c, 'connect');
  c.emit('player:join', { code: 'SL-0000', name: 'Ghost', sessionId: 'pc' });
  const notice = await once(c, 'notice');
  assert.strictEqual(notice.level, 'error');
  ok('a bad room code is refused');

  // Non-host cannot drive the game.
  a.emit('admin:start');
  const denied = await once(a, 'notice');
  assert.match(denied.message, /host/i);
  ok('a player cannot start the game');

  admin.emit('admin:start');
  const started = await waitState(a, (s) => s.status === 'running', 'game start');
  assert.strictEqual(started.currentPlayerId, ja.playerId);
  ok('the host started the game and Ana is up');

  // Bo tries to roll out of turn.
  b.emit('player:roll');
  const refused = await once(b, 'notice');
  assert.match(refused.message, /not your turn/i);
  ok('the server refuses an out-of-turn roll');

  // Play until someone wins, answering questions as they come.
  const sockets = { [ja.playerId]: a, [jb.playerId]: b };
  let guard = 0;
  let final = null;

  while (guard++ < 400) {
    /* eslint-disable no-await-in-loop */
    const s = await new Promise((res) => {
      const h = (st) => { admin.off('state', h); res(st); };
      admin.on('state', h);
      setTimeout(() => { admin.off('state', h); res(null); }, 1500);
      const room = rooms.get(code);
      if (!room) return;
      if (room.pending) sockets[room.pending.playerId].emit('player:answered');
      else if (room.status === 'running') sockets[room.players[room.turnIndex].id].emit('player:roll');
    });
    if (s && s.status === 'finished') { final = s; break; }
    if (!s) break;
  }

  assert.ok(final, 'the game reached a conclusion');
  assert.ok(final.winnerId, 'there is a winner');
  const winner = final.players.find((p) => p.id === final.winnerId);
  assert.strictEqual(winner.position, 100);
  ok(`a full game played out over websockets — ${winner.name} won on turn ${final.turnNumber}`);

  const room = rooms.get(code);
  const everyHistory = room.players.flatMap((p) => p.usedQuestionIds);
  const perPlayerDupes = room.players.some(
    (p) => new Set(p.usedQuestionIds).size !== p.usedQuestionIds.length,
  );
  assert.strictEqual(perPlayerDupes, false);
  ok(`no player repeated a question (${everyHistory.length} questions asked in total)`);

  // Reconnect: same session id, new socket, same token.
  a.close();
  await new Promise((r) => setTimeout(r, 200));
  const a2 = track(ioc(URL, { transports: ['websocket'] }));
  await once(a2, 'connect');
  a2.emit('player:join', { code, name: 'Ana', sessionId: 'pa' });
  const rejoin = await once(a2, 'joined');
  assert.strictEqual(rejoin.playerId, ja.playerId);
  assert.strictEqual(rejoin.rejoined, true);
  ok('a refresh puts the player back on their own token');

  admin.emit('admin:reset');
  const reset = await waitState(admin, (s) => s.status === 'lobby', 'reset');
  assert.ok(reset.players.every((p) => p.position === 0));
  ok('host reset returned everyone to the start');

  [admin, a2, b, c].forEach((s) => s.close());
  server.close();
  console.log(`\n${pass} checks passed.\n`);
  process.exit(0);
})().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
