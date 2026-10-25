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
  append(...cs: FakeNode[]) {
    this.children.push(...cs);
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