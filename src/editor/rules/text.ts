import type { Condition, Effect, StatName, Value } from '../../shared/format/types.ts';
import type { Rule, RuleKind } from './convert.ts';

/**
 * A rule written out as short, Python-like text, for authors who like to read the whole
 * logic at once or copy it into notes. It is read-only: nothing parses this text back.
 * Things are shown by their names, not their ids; something that no longer exists is
 * shown as `?` plus its id.
 *
 * The words are English on purpose, like keywords in a programming language.
 */

export interface TextNames {
  item(id: string): string | undefined;
  page(id: string): string | undefined;
  action(id: string): string | undefined;
  counter(id: string): string | undefined;
  profession(id: string): string | undefined;
}

const INDENT = '    ';
const STATS: Record<StatName, string> = { hp: 'hp', maxHp: 'maxHp', attack: 'attack', defense: 'defense' };

export function ruleToText(rule: Rule, kind: RuleKind, names: TextNames): string {
  const writer = new Writer(names);
  if (kind === 'condition') return rule.when ? writer.condition(rule.when) : '';
  if (kind === 'effects') return writer.effects(rule.effects ?? [], 0).join('\n');
  const lines: string[] = [];
  if (rule.when) lines.push(`available if ${writer.condition(rule.when)}`);
  if (rule.effects?.length) lines.push('when picked:', ...writer.effects(rule.effects, 1));
  return lines.join('\n');
}

class Writer {
  private readonly names: TextNames;

  constructor(names: TextNames) {
    this.names = names;
  }

  /** A name in quotes, or `?id` when the thing was deleted. */
  private ref(lookup: (id: string) => string | undefined, id: string): string {
    const name = lookup(id);
    return name === undefined ? `?${id}` : JSON.stringify(name);
  }

  /** Counters read like variables: `gold`, or `"Gold coins"` when the name has spaces. */
  private counter(id: string): string {
    const name = this.names.counter(id);
    if (name === undefined) return `?${id}`;
    return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? name : JSON.stringify(name);
  }

  private value(value: Value): string {
    if (typeof value === 'number') return String(value);
    if ('stat' in value) return STATS[value.stat] ?? value.stat;
    if ('counter' in value) return this.counter(value.counter);
    if ('itemCount' in value) return `count(${this.ref(this.names.item, value.itemCount)})`;
    return '?';
  }

  condition(cond: Condition, parent?: 'and' | 'or' | 'not'): string {
    switch (cond.type) {
      case 'hasItem':
        return cond.count && cond.count !== 1
          ? `has(${this.ref(this.names.item, cond.item)}, ${cond.count})`
          : `has(${this.ref(this.names.item, cond.item)})`;
      case 'did':
        return `did(${this.ref(this.names.action, cond.action)})`;
      case 'visited':
        return `visited(${this.ref(this.names.page, cond.page)})`;
      case 'won':
        return `won(${this.ref(this.names.page, cond.page)})`;
      case 'profession':
        return `is(${this.ref(this.names.profession, cond.profession)})`;
      case 'compare':
        return `${this.value(cond.left)} ${cond.op === '=' ? '==' : cond.op} ${this.value(cond.right)}`;
      case 'and':
      case 'or': {
        const parts = (cond.type === 'and' ? cond.all : cond.any).map((part) => this.condition(part, cond.type));
        const text = parts.join(` ${cond.type} `);
        // Brackets only where "and" and "or" meet, or under "not".
        return parent && parent !== cond.type ? `(${text})` : text;
      }
      case 'not':
        return `not ${this.condition(cond.cond, 'not')}`;
      default:
        return `?${JSON.stringify(cond)}`;
    }
  }

  effects(effects: Effect[], depth: number): string[] {
    const pad = INDENT.repeat(depth);
    if (effects.length === 0) return [`${pad}pass`];
    return effects.flatMap((effect) => this.effect(effect).map((line) => pad + line));
  }

  /** One effect; nested lines come back already indented relative to it. */
  private effect(effect: Effect): string[] {
    const amount = (by: number) => (by < 0 ? `-= ${-by}` : `+= ${by}`);
    const nested = (effects: Effect[]) => this.effects(effects, 1);
    switch (effect.type) {
      case 'giveItem':
      case 'takeItem': {
        const verb = effect.type === 'giveItem' ? 'give' : 'take';
        const item = this.ref(this.names.item, effect.item);
        return [effect.count && effect.count !== 1 ? `${verb}(${item}, ${effect.count})` : `${verb}(${item})`];
      }
      case 'changeStat':
        return [`${STATS[effect.stat] ?? effect.stat} ${amount(effect.by)}`];
      case 'setStat':
        return [`${STATS[effect.stat] ?? effect.stat} = ${effect.to}`];
      case 'changeCounter':
        return [`${this.counter(effect.counter)} ${amount(effect.by)}`];
      case 'setCounter':
        return [`${this.counter(effect.counter)} = ${effect.to}`];
      case 'message':
        return [`say(${JSON.stringify(effect.text)})`];
      case 'goto':
        return [`goto(${this.ref(this.names.page, effect.page)})`];
      case 'if':
      case 'chance': {
        const head = effect.type === 'if' ? `if ${this.condition(effect.when)}:` : `chance(${effect.percent}%):`;
        const lines = [head, ...nested(effect.then)];
        if (effect.else?.length) lines.push('else:', ...nested(effect.else));
        return lines;
      }
      default:
        return [`# ? ${JSON.stringify(effect)}`];
    }
  }
}
