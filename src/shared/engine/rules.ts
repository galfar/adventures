import type { StrikeLog } from './state.ts';

/** Sides of the die used for fights. */
export const DIE_SIDES = 6;

/**
 * One blow in a fight: damage = die roll + attacker's attack - defender's defense.
 * The highest roll always hurts at least a little, so no fight can last forever.
 */
export function strike(roll: number, attack: number, defense: number): StrikeLog {
  let damage = Math.max(0, roll + attack - defense);
  if (roll === DIE_SIDES) damage = Math.max(1, damage);
  return { roll, attack, defense, damage };
}

/**
 * Small seeded random generator (mulberry32). The seed lives in the saved game, which
 * makes dice rolls repeatable in tests and stable across a browser reload.
 */
export function nextRandom(seed: number): { value: number; seed: number } {
  const next = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), next | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: next };
}
