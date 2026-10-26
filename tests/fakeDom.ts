/** Tiny DOM stand-in for the node test environment (no jsdom): just enough for the banner / select helpers. */
export class FakeNode {
  children: FakeNode[] = [];
  textContent = '';
  value = '';
  classes = new Set<string>();
  listeners = new Map<string, Array<() => void>>();
  constructor(public tag: string) {}
  classList = {
    add: (c: string) => void this.classes.add(c),
    remove: (c: string) => void this.classes.delete(c),
    toggle: (c: string, force?: boolean) => {
      const on = force ?? !this.classes.has(c);
      if (on) this.classes.add(c);
      else this.classes.delete(c);
      return on;
    },
    contains: (c: string) => this.classes.has(c),
  };
  appendChild(c: FakeNode) {
    this.children.push(c);
    return c;
  }
  append(...cs: Array<FakeNode | string>) {
    for (const c of cs) {
      if (typeof c === 'string') {
        const t = new FakeNode('#text');
        t.textContent = c;
        this.children.push(t);
      } else this.children.push(c);
    }
  }
  attrs = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  /** Concatenated text of this node and its descendants (own 	extContent first). */
  get allText(): string {
    return this.textContent + this.children.map((c) => c.allText).join('');
  }
  replaceChildren() {
    this.children = [];
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}
export const fakeDoc = { createElement: (tag: string) => new FakeNode(tag) } as unknown as Pick<Document, 'createElement'>;