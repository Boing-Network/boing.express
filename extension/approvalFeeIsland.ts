/**
 * Speed (priority tip) chooser for the dApp approval window: the same React component the web wallet uses,
 * mounted into the vanilla approval page. Reports the chosen tip back through `onTipChange`.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { FeeChooserState, LockedTip } from '../src/components/FeeChooser';
import type { TipPlan } from '../src/boing/tipPlan';

export function renderApprovalFeeIsland(el: HTMLElement, plan: TipPlan, onTipChange: (tip: bigint, valid: boolean) => void): void {
  const root = createRoot(el);
  if (plan.locked != null) {
    root.render(createElement(LockedTip, { tip: plan.locked, testId: 'approval-tip-locked' }));
    return;
  }
  root.render(createElement(FeeChooserState, { fee: plan.fee, onTipChange, testIdPrefix: 'approval-speed' }));
}