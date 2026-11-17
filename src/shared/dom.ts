type Child = Node | string | number | null | undefined | false;
/** Children may be given in lists, and lists of lists (e.g. the result of a map). */
type Children = Child | Children[];
type PropValue = string | number | boolean | undefined | ((event: Event) => void);

/**
 * Creates a DOM element: `h('button', { class: 'action', onclick: go }, 'Go north')`.
 * Text children become text nodes, so story text can never inject HTML.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, PropValue> | null,
  ...children: Children[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') el.addEventListener(key.replace(/^on/, ''), value);
    else if (key === 'class') el.className = String(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of (children as unknown[]).flat(Infinity) as Child[]) {
    if (child !== null && child !== undefined && child !== false) el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/**
 * Story text to paragraphs. An empty line starts a new paragraph;
 * `**bold**` and `*italic*` are the only formatting.
 */
export function renderText(text: string): HTMLParagraphElement[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((block) => {
      const p = h('p');
      const pattern = /\*\*(.+?)\*\*|\*(.+?)\*/gs;
      let last = 0;
      for (const match of block.matchAll(pattern)) {
        p.append(block.slice(last, match.index));
        p.append(match[1] !== undefined ? h('strong', null, match[1]) : h('em', null, match[2]));
        last = match.index + match[0].length;
      }
      p.append(block.slice(last));
      return p;
    });
}

/** A modal dialog that removes itself when closed. Returns the element; call `.close()` to dismiss. */
export function openDialog(className: string, build: (dialog: HTMLDialogElement) => Child[]): HTMLDialogElement {
  const dialog = h('dialog', { class: className });
  dialog.append(h('div', { class: 'dialog-body' }, build(dialog)));
  dialog.addEventListener('close', () => dialog.remove());
  // Tapping the dark area around the dialog closes it.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/** Asks a yes/no question in a dialog. */
export function confirmDialog(question: string, yes: string, no: string): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    const dialog = openDialog('dialog', (d) => [
      h('p', null, question),
      h(
        'div',
        { class: 'dialog-buttons' },
        h('button', { class: 'action', onclick: () => d.close() }, no),
        h(
          'button',
          {
            class: 'action primary',
            onclick: () => {
              answer = true;
              d.close();
            },
          },
          yes,
        ),
      ),
    ]);
    dialog.addEventListener('close', () => resolve(answer));
  });
}
