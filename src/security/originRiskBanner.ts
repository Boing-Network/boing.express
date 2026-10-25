import type { OriginRisk } from './originRisk';

type ElementLike = Pick<HTMLElement, 'classList' | 'replaceChildren' | 'append'>;
type DocLike = Pick<Document, 'createElement'>;

/**
 * Fill the approval page's origin-risk banner (`#approval-risk`, `role="alert"`). Informs only; never blocks.
 * Text is always set via `textContent` (the origin and warnings are untrusted strings, never HTML).
 */
export function renderOriginRisk(doc: DocLike, el: ElementLike, risk: OriginRisk): void {
  if (risk.level === 'none') {
    el.replaceChildren();
    el.classList.add('hidden');
    return;
  }
  el.replaceChildren();
  const strong = doc.createElement('strong');
  strong.textContent = risk.level === 'danger' ? 'Be careful: this site looks risky' : 'Check this site before continuing';
  const ul = doc.createElement('ul');
  for (const w of risk.warnings) {
    const li = doc.createElement('li');
    li.textContent = w;
    ul.appendChild(li);
  }
  el.append(strong, ul);
  el.classList.toggle('risk-danger', risk.level === 'danger');
  el.classList.remove('hidden');
}