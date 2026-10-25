import { useEffect, useState } from 'react';
import { explorerBaseFor, resolveExplorerBase } from '../boing/explorerLinks';

/** Explorer base URL for the selected network (configured, else the node's `end_user.explorer_url`); '' when none. */
export function useExplorerBase(config: { explorerUrl?: string; rpcUrl: string }): string {
  const configured = resolveExplorerBase(config.explorerUrl, null);
  const [fromNode, setFromNode] = useState<string | null>(null);
  useEffect(() => {
    if (configured) return;
    let live = true;
    void explorerBaseFor(config).then((b) => {
      if (live) setFromNode(b);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, config.rpcUrl]);
  return configured ?? fromNode ?? '';
}