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

/**
 * A snake: a gradient ribbon with a lighter belly stripe and a dashed
 * highlight that flows head-to-tail, so the body reads as moving.
 */
function drawSnake(layer, defs, head, tail) {
  const a = centre(Number(head));
  const b = centre(Number(tail));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bend = Math.min(15, 4.5 + len * 0.17);

  const c1 = { x: a.x + dx * 0.28 + nx * bend, y: a.y + dy * 0.28 + ny * bend };
  const c2 = { x: a.x + dx * 0.72 - nx * bend, y: a.y + dy * 0.72 - ny * bend };
  const d = `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;

  const gid = `sg-${head}`;
  const grad = svg('linearGradient', {
    id: gid, gradientUnits: 'userSpaceOnUse',
    x1: a.x, y1: a.y, x2: b.x, y2: b.y,
  });
  grad.appendChild(svg('stop', { offset: '0%', 'stop-color': '#FF5F6D' }));
  grad.appendChild(svg('stop', { offset: '55%', 'stop-color': '#F0518F' }));
  grad.appendChild(svg('stop', { offset: '100%', 'stop-color': '#B341C8' }));
  defs.appendChild(grad);

  // Soft halo, then the body, then a belly stripe.
  layer.appendChild(svg('path', {
    d, fill: 'none', stroke: `url(#${gid})`, 'stroke-width': 4.6,
    'stroke-linecap': 'round', opacity: '0.22', class: 'snake-halo',
  }));
  layer.appendChild(svg('path', {
    d, fill: 'none', stroke: `url(#${gid})`, 'stroke-width': 2.3,
    'stroke-linecap': 'round',
  }));
  layer.appendChild(svg('path', {
    d, fill: 'none', stroke: 'rgba(255,255,255,0.34)', 'stroke-width': 0.7,
    'stroke-linecap': 'round',
  }));
  // The flowing highlight. Duration varies so the snakes never march in step.
  const flow = svg('path', {
    d, fill: 'none', stroke: 'rgba(255,255,255,0.85)', 'stroke-width': 0.9,
    'stroke-linecap': 'round', 'stroke-dasharray': '1.4 9', class: 'snake-flow',
  });
  flow.style.animationDuration = `${(2.6 + (Number(head) % 7) * 0.45).toFixed(2)}s`;
  layer.appendChild(flow);

  const ang = Math.atan2(c1.y - a.y, c1.x - a.x);
  const g = svg('g', { class: 'snake-head-g' });
  g.appendChild(svg('circle', { cx: a.x, cy: a.y, r: 2.35, fill: '#FF5F6D' }));
  g.appendChild(svg('circle', { cx: a.x, cy: a.y, r: 2.35, fill: 'none', stroke: 'rgba(255,255,255,0.5)', 'stroke-width': 0.35 }));
  const eye = 0.95;
  [1.05, -1.05].forEach((o) => {
    g.appendChild(svg('circle', {
      cx: a.x + Math.cos(ang + o) * eye, cy: a.y + Math.sin(ang + o) * eye,
      r: 0.46, fill: '#1A0710',
    }));
  });
  layer.appendChild(g);
}

/** A ladder: glowing glass rails with a light pulse travelling upward. */
function drawLadder(layer, defs, bottom, top) {
  const a = centre(Number(bottom));
  const b = centre(Number(top));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * 1.55;
  const ny = (dx / len) * 1.55;

  const gid = `lg-${bottom}`;
  const grad = svg('linearGradient', {
    id: gid, gradientUnits: 'userSpaceOnUse', x1: a.x, y1: a.y, x2: b.x, y2: b.y,
  });
  grad.appendChild(svg('stop', { offset: '0%', 'stop-color': '#38F5C8' }));
  grad.appendChild(svg('stop', { offset: '100%', 'stop-color': '#4FC3FF' }));
  defs.appendChild(grad);

  const rail = (sx, sy, cls, w, op) => {
    const l = svg('line', {
      x1: a.x + sx, y1: a.y + sy, x2: b.x + sx, y2: b.y + sy,
      stroke: `url(#${gid})`, 'stroke-width': w, 'stroke-linecap': 'round', opacity: op,
    });
    if (cls) l.setAttribute('class', cls);
    layer.appendChild(l);
    return l;
  };
  rail(nx, ny, 'ladder-halo', 2.6, '0.2');
  rail(-nx, -ny, 'ladder-halo', 2.6, '0.2');
  rail(nx, ny, null, 0.85, '1');
  rail(-nx, -ny, null, 0.85, '1');

  const rungs = Math.max(3, Math.round(len / 4.4));
  for (let i = 0; i <= rungs; i += 1) {
    const t = i / rungs;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    layer.appendChild(svg('line', {
      x1: px + nx, y1: py + ny, x2: px - nx, y2: py - ny,
      stroke: 'rgba(190,255,240,0.75)', 'stroke-width': 0.62, 'stroke-linecap': 'round',
    }));
  }

  // A short bright segment that climbs the ladder on a loop.
  const pulse = svg('line', {
    x1: a.x, y1: a.y, x2: b.x, y2: b.y,
    stroke: 'rgba(255,255,255,0.9)', 'stroke-width': 1.5, 'stroke-linecap': 'round',
    'stroke-dasharray': `4 ${Math.round(len)}`, class: 'ladder-pulse',
  });
  pulse.style.animationDuration = `${(2.8 + (Number(bottom) % 5) * 0.5).toFixed(2)}s`;
  layer.appendChild(pulse);
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
    const defs = svg('defs', {});
    overlay.appendChild(defs);
    for (const [b, t] of Object.entries(LADDERS)) drawLadder(overlay, defs, b, t);
    for (const [h, t] of Object.entries(SNAKES)) drawSnake(overlay, defs, h, t);
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
