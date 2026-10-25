/** "View transaction" deep link to the explorer, shown after a send. Renders nothing when there is no explorer. */
export function ViewTxLink({ url, className }: { url: string | null | undefined; className?: string }) {
  if (!url) return null;
  return (
    <>
      {' \u00b7 '}
      <a href={url} target="_blank" rel="noopener noreferrer" className={className} data-testid="view-tx-link">
        View transaction
      </a>
    </>
  );
}