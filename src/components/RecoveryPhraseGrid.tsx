/** Numbered recovery-phrase words (read-only, not selectable by default so it is not copied by accident). */
export function RecoveryPhraseGrid({ words, hidden = false }: { words: string[]; hidden?: boolean }) {
  return (
    <ol
      data-testid="wallet-phrase-words"
      aria-label="Recovery phrase"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: '0.4rem 0.75rem',
        listStyle: 'none',
        margin: '0.75rem 0',
        padding: 0,
        textAlign: 'left',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '0.95rem',
        userSelect: hidden ? 'none' : 'text',
      }}
    >
      {words.map((w, i) => (
        <li key={i} data-testid={`wallet-phrase-word-${i + 1}`}>
          <span style={{ opacity: 0.6, display: 'inline-block', width: '1.8em' }}>{i + 1}.</span>
          {hidden ? '••••' : w}
        </li>
      ))}
    </ol>
  );
}
