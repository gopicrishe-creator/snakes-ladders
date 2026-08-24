# Snakes & Ladders — team edition

A real-time multiplayer Snakes & Ladders game for a team activity run alongside a Google Meet call. Five players, one host. Landing on a ladder assigns the player a random discussion question, which they answer out loud on the call before they're allowed to climb.

## Run it

```bash
npm install
npm start
```

- Host dashboard: `http://localhost:3000/admin`
- Player join page: `http://localhost:3000/`

The host clicks **Create a new room**, gets a code like `SL-4821`, and shares either the code or the link shown in the dashboard header (`your-host/?code=SL-4821`) in the Meet chat. Players open the link, type a name, join. The host clicks **Start game** once everyone is in.

For a remote team you need the server reachable from everyone's browser. Two easy options:

```bash
# 1. Temporary tunnel from your own machine
npx localtunnel --port 3000        # or: ngrok http 3000

# 2. Deploy anywhere that runs Node and allows websockets
#    (Render, Railway, Fly.io, a small VPS). It listens on $PORT.
```

Run `npm test` to exercise the engine and play a full scripted game over websockets — 32 checks.

## How a turn works

1. The active player presses **Roll dice**. The client sends an intent; the server produces the number.
2. The token walks square by square. Everyone's screen and the host dashboard animate the same move.
3. **Snake** — the player slides down immediately. No question. Next player's turn.
4. **Ladder** — the board locks. That player gets a question modal; everyone else sees "over to \<name\>". They answer on the Meet, press **I answered — climb the ladder**, the token climbs, next player's turn.
5. You must land exactly on 100 to win. An overshoot forfeits the move (the token nudges and the turn passes).

## Question allocation

- **Set 1** is the 16 supplied questions. **Set 2** is 10 additional ones in the same register.
- A player never sees the same question twice in a session. History is kept **per player**, so two people can be asked the same thing.
- Set 1 drains completely for a given player before Set 2 opens for them, automatically. Nobody picks a question, requests another, or sees the pool.
- If a player somehow exhausts all 26, they get a free "tell us anything" prompt and the host dashboard raises a warning instead of the game silently repeating itself.

## Architecture

```
server.js          Express + Socket.IO. Rooms, socket auth, event validation, disk snapshots.
src/game.js        Pure game engine. The only code that may change a position, turn, dice
                   result or question assignment. Every mutation returns ok/error.
src/board.js       Snakes, ladders, colours. Served to the browser at /config.js so the
                   client cannot disagree with the server about the board.
src/questions.js   Set 1, Set 2, fallback prompt.
public/board.js    Board rendering: serpentine tile grid, SVG snakes and ladders, token
                   animation queue.
public/player.js   Player client.  public/admin.js  Host dashboard.
data/rooms.json    Snapshot so a server restart doesn't lose a game in progress.
```

**The server is the source of truth.** Clients send intents (`player:roll`, `player:answered`) and receive state. The browser never sends a dice value, a position, or a question. Each socket receives a filtered view: a player is sent only their own question text and never another player's question history.

Every state broadcast carries a monotonically increasing `lastAction`, and clients animate one action at a time through a promise queue — so latency, a duplicate event, or a mid-animation update can't leave tokens in the wrong place. The authoritative positions are snapped in after each animation.

### Validated server-side

Whose turn it is; whether the game is running, paused or finished; whether a roll is allowed; the dice value; the resulting position; snake and ladder movement; who owns an open question; whether that question was already used by that player; whether the ladder may be activated; and whether the caller is really the host. Rolling twice is blocked by a phase lock taken before the dice is generated, so a double-click or a retried request cannot move you twice.

## Edge cases handled

| Case | Behaviour |
| --- | --- |
| Player refreshes or closes the tab | A per-browser session id returns them to their own token, position and open question |
| Player disconnects | Marked offline on every screen; their turn is skipped automatically |
| Player drops with a question open | State survives; the modal is back on reconnect, or the host presses **Mark answered** |
| Two players roll at once | Phase lock plus turn check — the second gets "It is not your turn" |
| Duplicate/retried roll | Rejected; the phase is no longer `idle` |
| Host disconnects | Logged as a warning; the host reconnects with the room code from the same browser |
| Sixth player tries to join | Refused with a clear message |
| Joining after the start | Refused unless it's a reconnect of an existing player |
| Duplicate names | Refused |
| Both question sets exhausted | Free prompt + host warning, never a silent repeat |
| Roll past 100 | Move forfeited, turn passes |
| Two players on one square | Tokens fan out around the tile |
| Server restart | Rooms restored from `data/rooms.json`; everyone shows offline until they reconnect |

## Host controls

Start / restart, pause, resume, skip the current turn, mark an open question as answered (for a player who dropped off), reset the board, end the game. The host can't move a token or choose a question — no override exists, so there's nothing to press by accident.

The dashboard shows status, players in, turn number, who's playing, current leader, elapsed time, a per-player table (position, last roll, ladders, snakes, questions answered, status), the currently open question, per-player question history, and a full activity log. Everything updates live.

## House rules encoded

- Everyone starts off-board at 0. Any roll gets you on.
- 11 snakes, 6 ladders — deliberately more snakes, so games run long enough for most people to draw a question.
- No square is both a snake head and a ladder foot, and no ladder drops you onto a snake head.
- Exact roll required for 100.
- First to 100 wins; turns stop and a winner screen appears.
