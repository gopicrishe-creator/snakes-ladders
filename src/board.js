'use strict';

/**
 * Board configuration. This module is the single source of truth for the board
 * and is served to the browser at /config.js so the client can never disagree
 * with the server about where a snake or ladder is.
 *
 * 10 snakes, 9 ladders. Still more snakes than ladders, but only just.
 *
 * The ladders are deliberately SHORT (13-18 squares). Every ladder is a
 * discussion question, and that conversation is the point of the exercise --
 * long ladders end the game before many questions get asked. Short ones keep
 * the game running at roughly the same length while roughly doubling how many
 * questions come up.
 */

// head -> tail (you slide down)
const SNAKES = {
  24: 2,
  33: 6,
  44: 15,
  54: 25,
  64: 38,
  73: 46,
  83: 56,
  87: 55,
  92: 67,
  96: 66,
};

// bottom -> top (you climb, after answering a question)
const LADDERS = {
  3: 22,
  8: 26,
  16: 35,
  21: 42,
  29: 48,
  36: 57,
  51: 72,
  63: 82,
  70: 91,
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
