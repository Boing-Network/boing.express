/**
 * Keyboard model for an ARIA tablist (WAI-ARIA Authoring Practices): Left/Right move between tabs (wrapping),
 * Home/End jump to the ends. Returns the id to activate, or null when the key is not a tab-navigation key.
 */
export function nextTabId<T extends string>(ids: readonly T[], current: T, key: string): T | null {
  if (ids.length === 0) return null;
  const i = Math.max(0, ids.indexOf(current));
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return ids[(i + 1) % ids.length]!;
    case 'ArrowLeft':
    case 'ArrowUp':
      return ids[(i - 1 + ids.length) % ids.length]!;
    case 'Home':
      return ids[0]!;
    case 'End':
      return ids[ids.length - 1]!;
    default:
      return null;
  }
}