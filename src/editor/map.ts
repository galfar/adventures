import { h } from '../shared/dom.ts';
import type { Page, PageId } from '../shared/format/types.ts';
import type { EditorContext } from './context.ts';
import { addAction, addPage, deletePage, findPage, GRID, NODE_HEIGHT, NODE_WIDTH, pageLinks, type Link } from './ops.ts';

/**
 * The map: pages are boxes, choices are arrows.
 *
 * Boxes are ordinary HTML elements and arrows are SVG, both inside one layer that is
 * moved and scaled for panning and zooming. The map is redrawn from the story after
 * every change; only a drag in progress is kept outside the story until it ends.
 */

const SVG = 'http://www.w3.org/2000/svg';
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
/** A press that moves less than this is a click, not a drag. */
const CLICK_SLOP = 5;

interface Point {
  x: number;
  y: number;
}

type Drag =
  | { kind: 'pan'; start: Point; view: Point; moved: boolean }
  | { kind: 'node'; id: PageId; start: Point; origin: Point; moved: boolean }
  | { kind: 'link'; from: PageId; start: Point; moved: boolean }
  | { kind: 'pinch'; distance: number; zoom: number };

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...children: (Node | string)[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  el.append(...children);
  return el;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const shorten = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

export class MapView {
  readonly element: HTMLElement;
  private readonly ctx: EditorContext;
  private readonly layer: HTMLElement;
  private readonly nodes: HTMLElement;
  private readonly edges: SVGGElement;
  private readonly rubber: SVGPathElement;
  private view = { x: 60, y: 60, k: 1 };
  private drag: Drag | undefined;
  /** Fingers or mouse buttons currently down, for pinch zooming. */
  private readonly pointers = new Map<number, Point>();
  /** Position of the page being dragged, until the drag ends. */
  private dragged: { id: PageId; pos: Point } | undefined;

  constructor(ctx: EditorContext) {
    this.ctx = ctx;
    const { t } = ctx;
    const marker = (kind: string) =>
      svg(
        'marker',
        { id: `arrow-${kind}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
        svg('path', { d: 'M0 0L10 5L0 10z', class: `arrow-head edge-${kind}` }),
      );
    this.edges = svg('g');
    this.rubber = svg('path', { class: 'rubber' });
    this.nodes = h('div', { class: 'map-nodes' });
    this.layer = h(
      'div',
      { class: 'map-layer' },
      svg('svg', { class: 'map-edges' }, svg('defs', {}, ...['action', 'jump', 'win', 'lose', 'flee'].map(marker)), this.edges, this.rubber),
      this.nodes,
    );
    const tool = (text: string, label: string, run: () => void) =>
      h('button', { class: 'tool', title: label, 'aria-label': label, onclick: run }, text);
    this.element = h(
      'div',
      { class: 'map', tabindex: 0 },
      this.layer,
      h(
        'div',
        { class: 'map-tools' },
        tool('＋', t('addPage'), () => this.addPageAt(this.toMap(this.centerOnScreen()), true)),
        tool('−', t('zoomOut'), () => this.zoomAt(this.centerOnScreen(), 1 / 1.25)),
        tool('+', t('zoomIn'), () => this.zoomAt(this.centerOnScreen(), 1.25)),
        tool('⤢', t('fit'), () => this.fit()),
      ),
    );

    const el = this.element;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e, true));
    el.addEventListener('dblclick', (e) => {
      if ((e.target as Element).closest('.node, .map-tools, .edge-label')) return;
      this.addPageAt(this.toMap({ x: e.clientX, y: e.clientY }), true);
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomAt({ x: e.clientX, y: e.clientY }, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    el.addEventListener('keydown', (e) => {
      const selected = this.ctx.selected;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected && e.target === el) {
        e.preventDefault();
        this.ctx.change((doc) => void deletePage(doc, selected));
      }
    });
  }

  /** Call once the map is on the page: restores the last view of this project, or shows everything. */
  start(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(this.viewKey()) ?? 'null') as typeof this.view | null;
      if (saved && [saved.x, saved.y, saved.k].every(Number.isFinite)) {
        this.view = { x: saved.x, y: saved.y, k: clamp(saved.k, MIN_ZOOM, MAX_ZOOM) };
        this.applyView();
        return;
      }
    } catch {
      // No saved view.
    }
    this.fit();
  }

  // ---- Drawing --------------------------------------------------------------------

  render(): void {
    const { ctx } = this;
    const story = ctx.story;
    const flagged = new Map<PageId, string>();
    for (const problem of ctx.problems) {
      if (problem.pageId && !flagged.has(problem.pageId)) flagged.set(problem.pageId, ctx.problemText(problem));
    }

    this.nodes.replaceChildren(
      ...story.pages.map((page) => {
        const pos = this.position(page);
        const hint = flagged.get(page.id);
        const classes = [
          'node',
          page.id === ctx.selected && 'selected',
          page.id === story.startPage && 'start',
          page.ending && `ending ending-${page.ending}`,
          !page.title && !page.text && 'empty',
        ];
        const node = h(
          'div',
          { class: classes.filter(Boolean).join(' '), 'data-id': page.id },
          h('div', { class: 'node-label' }, ctx.label(page)),
          h(
            'div',
            { class: 'node-badges' },
            page.id === story.startPage && h('span', { title: ctx.t('startBadge') }, '🚩'),
            page.image && h('span', null, '🖼️'),
            page.combat && h('span', null, '⚔️'),
            page.ending && h('span', null, page.ending === 'victory' ? '🏆' : page.ending === 'defeat' ? '💀' : '🔚'),
            hint && h('span', { class: 'node-hint', title: hint }, '⚠️'),
          ),
          h('div', { class: 'node-handle', title: ctx.t('connectHandle') }, '➜'),
        );
        node.style.left = `${pos.x}px`;
        node.style.top = `${pos.y}px`;
        return node;
      }),
    );
    this.renderEdges();
  }

  private renderEdges(): void {
    const { ctx } = this;
    const pages = new Map(ctx.story.pages.map((page) => [page.id, page]));
    const perPair = new Map<string, number>();
    const drawn: SVGElement[] = [];
    for (const page of ctx.story.pages) {
      for (const link of pageLinks(page)) {
        const target = pages.get(link.target);
        if (!target) continue; // A link to a deleted page: reported as a hint instead.
        const pair = `${page.id}>${target.id}`;
        const nth = perPair.get(pair) ?? 0;
        perPair.set(pair, nth + 1);
        drawn.push(...this.edge(page, target, link, nth));
      }
    }
    this.edges.replaceChildren(...drawn);
  }

  private edge(from: Page, to: Page, link: Link, nth: number): SVGElement[] {
    const a = this.position(from);
    const b = this.position(to);
    let d: string;
    let label: Point;
    if (from.id === to.id) {
      // A choice that leads back to its own page: a loop above the box.
      const rise = 46 + nth * 18;
      const x1 = a.x + NODE_WIDTH * 0.45;
      const x2 = a.x + NODE_WIDTH * 0.8;
      d = `M${x1} ${a.y} C${x1} ${a.y - rise} ${x2} ${a.y - rise} ${x2} ${a.y - 4}`;
      label = { x: (x1 + x2) / 2, y: a.y - rise * 0.75 - 6 };
    } else {
      // A gentle curve, bent to one side so that "there" and "back" arrows do not overlap.
      const c0 = { x: a.x + NODE_WIDTH / 2, y: a.y + NODE_HEIGHT / 2 };
      const c1 = { x: b.x + NODE_WIDTH / 2, y: b.y + NODE_HEIGHT / 2 };
      const length = Math.hypot(c1.x - c0.x, c1.y - c0.y) || 1;
      const bend = (18 + nth * 24) * 2;
      const control = {
        x: (c0.x + c1.x) / 2 - ((c1.y - c0.y) / length) * bend,
        y: (c0.y + c1.y) / 2 + ((c1.x - c0.x) / length) * bend,
      };
      const p0 = borderPoint(c0, control, 0);
      const p1 = borderPoint(c1, control, 5);
      d = `M${p0.x} ${p0.y} Q${control.x} ${control.y} ${p1.x} ${p1.y}`;
      // The text sits nearer the page the arrow starts from, so the texts of a
      // "there" arrow and a "back" arrow do not land on top of each other.
      const at = 0.32;
      const w0 = (1 - at) ** 2;
      const w1 = 2 * at * (1 - at);
      const w2 = at ** 2;
      label = { x: w0 * p0.x + w1 * control.x + w2 * p1.x, y: w0 * p0.y + w1 * control.y + w2 * p1.y };
    }

    const { t } = this.ctx;
    const text =
      link.kind === 'win'
        ? `⚔ ${t('edgeWin')}`
        : link.kind === 'lose'
          ? `⚔ ${t('edgeLose')}`
          : link.kind === 'flee'
            ? `⚔ ${t('edgeFlee')}`
            : shorten(link.label.trim() || '?', 24);
    const classes = `edge edge-${link.kind}${link.conditional ? ' conditional' : ''}`;
    const labelAttrs: Record<string, string | number> = { class: `edge-label edge-${link.kind}`, x: label.x, y: label.y + 4, 'data-page': from.id };
    if (link.actionId) labelAttrs['data-action'] = link.actionId;
    return [svg('path', { class: classes, d, 'marker-end': `url(#arrow-${link.kind})` }), svg('text', labelAttrs, text)];
  }

  private position(page: Page): Point {
    if (this.dragged?.id === page.id) return this.dragged.pos;
    return page.pos ?? { x: 0, y: 0 };
  }

  // ---- View: panning and zooming --------------------------------------------------

  private viewKey(): string {
    return `adventures.editor.view.${this.ctx.projectId}`;
  }

  private applyView(): void {
    const { x, y, k } = this.view;
    this.layer.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    // The dotted background moves with the map.
    this.element.style.backgroundPosition = `${x}px ${y}px`;
    this.element.style.backgroundSize = `${GRID * 2 * k}px ${GRID * 2 * k}px`;
    try {
      localStorage.setItem(this.viewKey(), JSON.stringify(this.view));
    } catch {
      // The view just will not be remembered.
    }
  }

  private centerOnScreen(): Point {
    const rect = this.element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  /** Screen point to map coordinates. */
  private toMap(screen: Point): Point {
    const rect = this.element.getBoundingClientRect();
    return { x: (screen.x - rect.left - this.view.x) / this.view.k, y: (screen.y - rect.top - this.view.y) / this.view.k };
  }

  private zoomAt(screen: Point, factor: number): void {
    const before = this.toMap(screen);
    const rect = this.element.getBoundingClientRect();
    this.view.k = clamp(this.view.k * factor, MIN_ZOOM, MAX_ZOOM);
    this.view.x = screen.x - rect.left - before.x * this.view.k;
    this.view.y = screen.y - rect.top - before.y * this.view.k;
    this.applyView();
  }

  /** Shows the whole story. */
  fit(): void {
    const rect = this.element.getBoundingClientRect();
    const positions = this.ctx.story.pages.map((page) => page.pos ?? { x: 0, y: 0 });
    if (positions.length === 0 || rect.width === 0) return;
    const left = Math.min(...positions.map((p) => p.x));
    const top = Math.min(...positions.map((p) => p.y));
    const width = Math.max(...positions.map((p) => p.x)) + NODE_WIDTH - left;
    const height = Math.max(...positions.map((p) => p.y)) + NODE_HEIGHT - top;
    const margin = 60;
    const k = clamp(Math.min((rect.width - 2 * margin) / width, (rect.height - 2 * margin) / height), MIN_ZOOM, 1);
    this.view = { k, x: (rect.width - width * k) / 2 - left * k, y: (rect.height - height * k) / 2 - top * k };
    this.applyView();
  }

  /** Moves the view so the given page is visible. */
  reveal(pageId: PageId): void {
    const page = findPage(this.ctx.story, pageId);
    const rect = this.element.getBoundingClientRect();
    if (!page?.pos || rect.width === 0) return;
    const { k } = this.view;
    const x = page.pos.x * k + this.view.x;
    const y = page.pos.y * k + this.view.y;
    if (x >= 20 && y >= 20 && x + NODE_WIDTH * k <= rect.width - 20 && y + NODE_HEIGHT * k <= rect.height - 20) return;
    this.view.x = rect.width / 2 - (page.pos.x + NODE_WIDTH / 2) * k;
    this.view.y = rect.height / 2 - (page.pos.y + NODE_HEIGHT / 2) * k;
    this.applyView();
  }

  // ---- Editing with the pointer ---------------------------------------------------

  private addPageAt(center: Point, select: boolean): void {
    let id: PageId | undefined;
    this.ctx.change((doc) => {
      id = addPage(doc, { x: center.x - NODE_WIDTH / 2, y: center.y - NODE_HEIGHT / 2 }).id;
    });
    if (select && id) this.ctx.select(id, { focus: 'text' });
  }

  private onDown(e: PointerEvent): void {
    const target = e.target as Element;
    if (target.closest('.map-tools') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.element.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };

    if (this.pointers.size === 2) {
      // A second finger: stop whatever the first one was doing and zoom instead.
      this.cancelDrag();
      const [p, q] = [...this.pointers.values()];
      this.drag = { kind: 'pinch', distance: Math.hypot(p!.x - q!.x, p!.y - q!.y) || 1, zoom: this.view.k };
      return;
    }
    const label = target.closest<SVGElement>('.edge-label');
    const node = target.closest<HTMLElement>('.node');
    if (label?.dataset.page) {
      const action = label.dataset.action;
      this.ctx.select(label.dataset.page, action ? { focus: `action-label:${action}` } : {});
    } else if (node?.dataset.id && target.closest('.node-handle')) {
      this.drag = { kind: 'link', from: node.dataset.id, start, moved: false };
    } else if (node?.dataset.id) {
      const page = findPage(this.ctx.story, node.dataset.id);
      this.drag = { kind: 'node', id: node.dataset.id, start, origin: { ...(page?.pos ?? { x: 0, y: 0 }) }, moved: false };
    } else {
      this.drag = { kind: 'pan', start, view: { x: this.view.x, y: this.view.y }, moved: false };
    }
  }

  private onMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const drag = this.drag;
    if (!drag) return;

    if (drag.kind === 'pinch') {
      const [p, q] = [...this.pointers.values()];
      if (!p || !q) return;
      const wanted = clamp((drag.zoom * Math.hypot(p.x - q.x, p.y - q.y)) / drag.distance, MIN_ZOOM, MAX_ZOOM);
      this.zoomAt({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, wanted / this.view.k);
      return;
    }
    const dx = e.clientX - drag.start.x;
    const dy = e.clientY - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    drag.moved = true;

    if (drag.kind === 'pan') {
      this.view.x = drag.view.x + dx;
      this.view.y = drag.view.y + dy;
      this.applyView();
    } else if (drag.kind === 'node') {
      const pos = { x: drag.origin.x + dx / this.view.k, y: drag.origin.y + dy / this.view.k };
      this.dragged = { id: drag.id, pos };
      const node = this.nodeElement(drag.id);
      if (node) {
        node.style.left = `${pos.x}px`;
        node.style.top = `${pos.y}px`;
        node.classList.add('dragging');
      }
      this.renderEdges();
    } else {
      const from = findPage(this.ctx.story, drag.from)?.pos ?? { x: 0, y: 0 };
      const to = this.toMap({ x: e.clientX, y: e.clientY });
      this.rubber.setAttribute('d', `M${from.x + NODE_WIDTH / 2} ${from.y + NODE_HEIGHT / 2} L${to.x} ${to.y}`);
      const over = this.nodeUnder(e);
      for (const node of this.nodes.children) node.classList.toggle('drop-target', node === over && over.dataset.id !== drag.from);
    }
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.element.hasPointerCapture(e.pointerId)) this.element.releasePointerCapture(e.pointerId);
    const drag = this.drag;
    if (!drag) return;
    if (drag.kind === 'pinch') {
      this.drag = undefined;
      return;
    }
    this.drag = undefined;
    if (cancelled) {
      this.cancelDrag();
      return;
    }
    const { ctx } = this;

    if (drag.kind === 'pan') {
      if (!drag.moved && ctx.selected) ctx.select(undefined);
    } else if (drag.kind === 'node') {
      const moved = this.dragged;
      this.dragged = undefined;
      if (!moved) {
        ctx.select(drag.id);
      } else {
        const snap = (value: number) => Math.round(value / GRID) * GRID;
        ctx.change((doc) => {
          const page = findPage(doc.story, drag.id);
          if (page) page.pos = { x: snap(moved.pos.x), y: snap(moved.pos.y) };
        });
      }
    } else {
      this.rubber.removeAttribute('d');
      const over = this.nodeUnder(e);
      const targetId = over?.dataset.id;
      if (!drag.moved || targetId === drag.from) {
        ctx.select(drag.from);
        this.render();
        return;
      }
      const drop = this.toMap({ x: e.clientX, y: e.clientY });
      let actionId: string | undefined;
      ctx.change((doc) => {
        // Dropped on a page: connect to it. Dropped on empty space: make a new page there.
        const target = targetId ?? addPage(doc, { x: drop.x - NODE_WIDTH / 2, y: drop.y - NODE_HEIGHT / 2 }).id;
        actionId = addAction(doc, drag.from, target)?.id;
      });
      // The author now only has to type what the choice says.
      ctx.select(drag.from, actionId ? { focus: `action-label:${actionId}` } : {});
    }
  }

  private cancelDrag(): void {
    this.drag = undefined;
    this.dragged = undefined;
    this.rubber.removeAttribute('d');
    this.render();
  }

  private nodeElement(id: PageId): HTMLElement | undefined {
    return [...this.nodes.children].find((node): node is HTMLElement => (node as HTMLElement).dataset.id === id);
  }

  private nodeUnder(e: PointerEvent): HTMLElement | undefined {
    return document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.node') ?? undefined;
  }
}

/**
 * The point where a line from the centre of a page box towards `towards` leaves the box,
 * pushed out by `gap` pixels (room for the arrow head).
 */
function borderPoint(center: Point, towards: Point, gap: number): Point {
  const dx = towards.x - center.x;
  const dy = towards.y - center.y;
  const scale = Math.min(
    dx === 0 ? Infinity : (NODE_WIDTH / 2 + gap) / Math.abs(dx),
    dy === 0 ? Infinity : (NODE_HEIGHT / 2 + gap) / Math.abs(dy),
    1,
  );
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}
