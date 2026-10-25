import { AUTO_LOCK_OPTIONS, autoLockLabel, normalizeAutoLockMinutes } from './autoLock';

type SelectLike = {
  value: string;
  appendChild(child: Node): unknown;
  addEventListener(type: 'change', listener: () => void): void;
};
type DocLike = Pick<Document, 'createElement'>;

/**
 * Populate the popup's auto-lock `<select>` with the policy options, select the stored value, and report changes
 * (normalized, so a tampered value falls back to the default). Returns nothing; the caller owns persistence.
 */
export function bindAutoLockSelect(doc: DocLike, sel: SelectLike, current: number, onChange: (minutes: number) => void): void {
  for (const m of AUTO_LOCK_OPTIONS) {
    const o = doc.createElement('option');
    o.value = String(m);
    o.textContent = autoLockLabel(m);
    sel.appendChild(o);
  }
  sel.value = String(current);
  sel.addEventListener('change', () => onChange(normalizeAutoLockMinutes(sel.value)));
}