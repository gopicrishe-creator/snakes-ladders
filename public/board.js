/* global window, document */
'use strict';

/**
 * Board rendering. Geometry is in a 0-100 unit square so tiles, snakes and
 * tokens all agree regardless of the rendered pixel size.
 *
 * Numbering is boustrophedon (the ox-plough path): square 1 is bottom-left,
 * rows alternate direction. The tile shading follows that path so the route
 * from 1 to 100 is readable without tracing the numbers.
 */

// Wrapped in an IIFE: classic scripts share one global scope, so top-level
// declarations here would collide with the other files on the page.
(function () {
const CFG = window.SNL_CONFIG;
const SNAKES = CFG.snakes;
const LADDERS = CFG.ladders;
const SVG_NS = 'http://www.w3.org/2000/svg';

function centre(square) {
  const row = Math.floor((square - 1) / 10);          // 0 = bottom row
  let col = (square - 1) % 10;
  if (row % 2 === 1) col = 9 - col;
  return { x: col * 10 + 5, y: (9 - row) * 10 + 5 };
}

/** Squares in top-left-to-bottom-right visual order, for the CSS grid. */
function visualOrder() {
  const out = [];
  for (let r = 9; r >= 0; r -= 1) {
    const base = r * 10;
    const row = [];
    for (let c = 1; c <= 10; c += 1) row.push(base + c);
    if (r % 2 === 1) row.reverse();
    out.push(...row);
  }
  return out;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  return node;
}

/** A snake body: one wobbling cubic curve, a head, and eyes. */
function drawSnake(layer, head, tail) {
  const a = centre(Number(head));
  const b = centre(Number(tail));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bend = Math.min(14, 4 + len * 0.16);

  const c1 = { x: a.x + dx * 0.3 + nx * bend, y: a.y + dy * 0.3 + ny * bend };
  const c2 = { x: a.x + dx * 0.7 - nx * bend, y: a.y + dy * 0.7 - ny * bend };
  const d = `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;

  layer.appendChild(svg('path', {
    d, fill: 'none', stroke: '#8B2A1B', 'stroke-width': 3.1,
    'stroke-linecap': 'round', opacity: '0.55',
  }));
  layer.appendChild(svg('path', {
    d, fill: 'none', stroke: 'var(--coral)', 'stroke-width': 2.1,
    'stroke-linecap': 'round', opacity: '0.95',
  }));
  layer.appendChild(svg('path', {
    d, fill: 'none', stroke: '#F7C9BE', 'stroke-width': 0.55,
    'stroke-dasharray': '1.2 2.4', 'stroke-linecap': 'round', opacity: '0.7',
  }));

  // Head, oriented along the first control point.
  const ang = Math.atan2(c1.y - a.y, c1.x - a.x);
  layer.appendChild(svg('circle', { cx: a.x, cy: a.y, r: 2.1, fill: 'var(--coral)' }));
  const eye = 0.85;
  layer.appendChild(svg('circle', {
    cx: a.x + Math.cos(ang + 1.1) * eye, cy: a.y + Math.sin(ang + 1.1) * eye,
    r: 0.42, fill: '#2A0E08',
  }));
  layer.appendChild(svg('circle', {
    cx: a.x + Math.cos(ang - 1.1) * eye, cy: a.y + Math.sin(ang - 1.1) * eye,
    r: 0.42, fill: '#2A0E08',
  }));
}

/** A ladder: two rails plus evenly spaced rungs. */
function drawLadder(layer, bottom, top) {
  const a = centre(Number(bottom));
  const b = centre(Number(top));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * 1.5;
  const ny = (dx / len) * 1.5;

  const rail = (sx, sy) => layer.appendChild(svg('line', {
    x1: a.x + sx, y1: a.y + sy, x2: b.x + sx, y2: b.y + sy,
    stroke: 'var(--jade)', 'stroke-width': 0.85, 'stroke-linecap': 'round', opacity: '0.95',
  }));
  rail(nx, ny);
  rail(-nx, -ny);

  const rungs = Math.max(3, Math.round(len / 4.4));
  for (let i = 0; i <= rungs; i += 1) {
    const t = i / rungs;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    layer.appendChild(svg('line', {
      x1: px + nx, y1: py + ny, x2: px - nx, y2: py - ny,
      stroke: '#8FE0CB', 'stroke-width': 0.6, 'stroke-linecap': 'round', opacity: '0.8',
    }));
  }
}

class Board {
  /**
   * @param {HTMLElement} root  empty container
   * @param {{tray?: HTMLElement, compact?: boolean}} opts
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.tray = opts.tray || null;
    this.tokens = new Map(); // playerId -> element
    this.display = new Map(); // playerId -> square currently shown
    this.animating = false;
    this.build();
  }

  build() {
    this.root.classList.add('board');
    this.root.innerHTML = '';

    const tiles = el('div', 'tiles');
    for (const n of visualOrder()) {
      const row = Math.floor((n - 1) / 10);
      const col = (n - 1) % 10;
      const tile = el('div', 'tile');
      if ((row + col) % 2 === 0) tile.classList.add('alt');
      if (SNAKES[n] !== undefined) tile.classList.add('snake-head');
      if (LADDERS[n] !== undefined) tile.classList.add('ladder-foot');
      if (n === CFG.finalSquare) tile.classList.add('finish');

      tile.appendChild(el('span', 'num', String(n)));
      if (SNAKES[n] !== undefined) tile.appendChild(el('span', 'glyph', '\u{1F40D}'));
      else if (LADDERS[n] !== undefined) tile.appendChild(el('span', 'glyph', '\u{1FA9C}'));
      else if (n === CFG.finalSquare) tile.appendChild(el('span', 'glyph', '\u{1F3C1}'));
      tile.dataset.square = String(n);
      tiles.appendChild(tile);
    }
    this.root.appendChild(tiles);

    const overlay = svg('svg', {
      class: 'overlay', viewBox: '0 0 100 100', preserveAspectRatio: 'none',
      'aria-hidden': 'true',
    });
    for (const [b, t] of Object.entries(LADDERS)) drawLadder(overlay, b, t);
    for (const [h, t] of Object.entries(SNAKES)) drawSnake(overlay, h, t);
    this.root.appendChild(overlay);

    this.tokenLayer = el('div', 'tokens');
    this.root.appendChild(this.tokenLayer);
  }

  /** Creates/removes token elements to match the roster. */
  syncPlayers(players) {
    const seen = new Set();
    players.forEach((p) => {
      seen.add(p.id);
      let node = this.tokens.get(p.id);
      if (!node) {
        node = el('div', 'token', p.name.slice(0, 2).toUpperCase());
        node.title = p.name;
        this.tokens.set(p.id, node);
        this.tokenLayer.appendChild(node);
        this.display.set(p.id, p.position);
      }
      node.style.background = p.hex;
      node.classList.toggle('is-turn', !!p.isTurn);
      node.classList.toggle('offline', !p.connected);
    });
    for (const [id, node] of this.tokens) {
      if (!seen.has(id)) { node.remove(); this.tokens.delete(id); this.display.delete(id); }
    }
  }

  /** Positions every token from `this.display`, clustering shared squares. */
  paint(players) {
    const groups = new Map();
    players.forEach((p) => {
      const sq = this.display.get(p.id) ?? p.position;
      if (sq < 1) return;
      if (!groups.has(sq)) groups.set(sq, []);
      groups.get(sq).push(p.id);
    });

    players.forEach((p) => {
      const node = this.tokens.get(p.id);
      if (!node) return;
      const sq = this.display.get(p.id) ?? p.position;
      if (sq < 1) {
        node.style.display = 'none';
        return;
      }
      node.style.display = '';
      const peers = groups.get(sq) || [p.id];
      const i = peers.indexOf(p.id);
      const n = peers.length;
      // Fan out around the tile centre so nobody is fully hidden.
      const spread = n === 1 ? 0 : n === 2 ? 2.9 : 3.4;
      const angle = (i / Math.max(1, n)) * Math.PI * 2;
      const c = centre(sq);
      node.style.left = `${c.x + Math.cos(angle) * spread}%`;
      node.style.top = `${c.y + Math.sin(angle) * spread}%`;
      node.style.zIndex = String(2 + i);
    });

    if (this.tray) this.paintTray(players);
  }

  paintTray(players) {
    const waiting = players.filter((p) => (this.display.get(p.id) ?? p.position) < 1);
    const holder = this.tray.querySelector('.tray-tokens');
    const label = this.tray.querySelector('.tray-label');
    holder.innerHTML = '';
    waiting.forEach((p) => {
      const pin = el('span', 'pin', p.name.slice(0, 2).toUpperCase());
      pin.style.background = p.hex;
      pin.title = p.name;
      holder.appendChild(pin);
    });
    label.textContent = waiting.length
      ? `${waiting.length} still at the start`
      : 'Everyone is on the board';
  }

  set(playerId, square) {
    this.display.set(playerId, square);
  }

  /** Snap every token to the authoritative position (no animation). */
  snap(players) {
    players.forEach((p) => this.display.set(p.id, p.position));
    this.paint(players);
  }

  static wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Plays a server action, then settles on the authoritative positions.
   * Runs one action at a time so a burst of updates cannot interleave.
   */
  async play(action, players) {
    const node = action.playerId ? this.tokens.get(action.playerId) : null;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!node || reduced || !action.kind) {
      this.snap(players);
      return;
    }

    if (action.kind === 'roll') {
      if (action.outcome === 'overshoot') {
        node.classList.add('nudge');
        await Board.wait(440);
        node.classList.remove('nudge');
        this.snap(players);
        return;
      }
      // Walk square by square from `from` to `to`.
      for (let sq = action.from + 1; sq <= action.to; sq += 1) {
        this.set(action.playerId, sq);
        this.paint(players);
        await Board.wait(sq === action.to ? 220 : 165);
      }
      if (action.outcome === 'snake') {
        await Board.wait(220);
        node.classList.add('slide');
        this.set(action.playerId, action.slideTo);
        this.paint(players);
        await Board.wait(680);
        node.classList.remove('slide');
      }
      this.snap(players);
      return;
    }

    if (action.kind === 'climb') {
      node.classList.add('climb');
      this.set(action.playerId, action.to);
      this.paint(players);
      await Board.wait(680);
      node.classList.remove('climb');
      this.snap(players);
      return;
    }

    this.snap(players);
  }
}

window.SNLBoard = Board;
window.SNLCentre = centre;
}());
