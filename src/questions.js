'use strict';

/**
 * Question pools. A player is always served an unused SET 1 question first;
 * SET 2 only opens up once that player has exhausted SET 1. The player never
 * sees the pool and never picks a question.
 */

const SET_1 = [
  'What\u2019s one rule you try to live by?',
  'What\u2019s the best piece of advice you\u2019ve ever been given?',
  'What\u2019s something you\u2019ve learned the hard way?',
  'If you could repeat one day from your life, which one would you choose?',
  'What does success mean to you?',
  'Who has had the biggest influence on your life?',
  'What\u2019s something people usually get wrong about you?',
  'What is the most embarrassing thing you believed as a child that you are now embarrassed to admit?',
  'What is the cringiest thing you did in middle school that still haunts you?',
  'Did you ever have a really embarrassing nickname? What was it?',
  'What is the most awkward thing you\u2019ve done while trying to impress a crush?',
  'What is the most childish or "uncool" hobby you have that you actually really enjoy?',
  'What is the silliest thing you are afraid of?',
  'What\u2019s a trend you tried to pull off in the past that looks absolutely terrible in photos now?',
  'If you could instantly become an expert in something, what would it be?',
  'What\u2019s something on your desk that cheers you up during the day?',
];

const SET_2 = [
  'What\u2019s a compliment someone gave you that you still think about?',
  'What\u2019s the most useless piece of trivia your brain refuses to let go of?',
  'What\u2019s a piece of technology you refuse to replace, even though you probably should?',
  'What\u2019s the strangest job or side gig you\u2019ve ever had?',
  'What\u2019s a food combination you genuinely love that other people find offensive?',
  'What\u2019s the last thing that made you laugh out loud when you were completely alone?',
  'What\u2019s a small win from this year that nobody congratulated you for?',
  'What\u2019s something you\u2019re weirdly competitive about?',
  'What\u2019s the longest you\u2019ve ever kept a habit going, and what finally ended it?',
  'What\u2019s an opinion you\u2019ll defend forever, knowing full well it does not matter at all?',
];

/** Shown only when a player has genuinely exhausted both sets. */
const FALLBACK_QUESTION = {
  id: 'FREE',
  set: 0,
  text: 'Both question sets are used up for you \u2014 tell the group anything you like about yourself.',
};

const POOL = [
  ...SET_1.map((text, i) => ({ id: `S1-${i + 1}`, set: 1, text })),
  ...SET_2.map((text, i) => ({ id: `S2-${i + 1}`, set: 2, text })),
];

const BY_ID = new Map(POOL.map((q) => [q.id, q]));

module.exports = { SET_1, SET_2, POOL, BY_ID, FALLBACK_QUESTION };
