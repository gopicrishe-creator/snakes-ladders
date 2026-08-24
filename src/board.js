'use strict';

/**
 * Board configuration. This module is the single source of truth for the board
 * and is served to the browser at /config.js so the client can never disagree
 * with the server about where a snake or ladder is.
 *
 * 11 snakes, 6 ladders — deliberately more snakes than ladders, so the game
 * runs long enough for most players to hit a ladder at least once.
 */

// head -> tail (you slide down)
const SNAKES = {
  19: 8,
  27: 6,
  31: 14,
  40: 21,
  54: 34,
  66: 45,
  74: 53,
  83: 58,
  87: 24,
  92: 51,
  98: 79,
};

// bottom -> top (you climb, after answering a question)
const LADDERS = {
  4: 25,
  13: 46,
  33: 49,
  42: 63,
  50: 69,
  62: 81,
};

const FINAL_SQUARE = 100;
const MAX_PLAYERS = 5;

/** Token identities, assigned in join order. */
const PLAYER_COLORS = [
  { key: 'brass', hex: '#E8A72C', label: 'Brass' },
  { key: 'coral', hex: '#E4573D', label: 'Coral' },
  { key: 'jade', hex: '#35A98A', label: 'Jade' },
  { key: 'cobalt', hex: '#6C8BE0', label: 'Cobalt' },
  { key: 'orchid', hex: '#C77DD6', label: 'Orchid' },
];

module.exports = { SNAKES, LADDERS, FINAL_SQUARE, MAX_PLAYERS, PLAYER_COLORS };
