/**
 * Fee-speed presets (slow / normal / fast + custom) for the optional priority tip, in plain BOING.
 *
 * The base network fee is fixed by the chain (micro-fee: ~21 000 gas, see boing_getNetworkFeePolicy). A priority tip is an
 * optional extra, paid in BOING base units (18 decimals), that moves a transaction ahead of untipped ones when blocks are
 * busy. Presets map onto the SDK's tip ladder so the wallet and SDK never drift. Fiat-agnostic: BOING amounts only.
 */
import { suggestPriorityTipLadder } from '@boing-network/boing-sdk';
import { BOING_BASE_DECIMALS, formatNative } from './nativeUnit';

export type TipPresetId = 'slow' | 'normal' | 'fast';

export interface TipPreset {
  id: TipPresetId;
  label: string;
  /** Tip in base units (18 decimals). */
  tip: bigint;
  hint: string;
}

/** What the user picked: a preset, or a typed custom amount (BOING). */
export interface TipChoice {
  preset: TipPresetId | 'custom';
  customText: string;
}

export const DEFAULT_TIP_CHOICE: TipChoice = { preset: 'slow', customText: '' };

/** Safety cap for a custom tip (1 BOING): a typo like "100" must not silently burn funds. */
export const MAX_CUSTOM_TIP = 10n ** BigInt(BOING_BASE_DECIMALS);

/** Slow = no tip (always valid, same as before tips existed); normal/fast reuse the SDK ladder's 2nd and 3rd rungs. */
export function tipPresets(): TipPreset[] {
  const ladder = suggestPriorityTipLadder();
  const rung = (i: number) => ladder[Math.min(i, ladder.length - 1)]?.tip ?? 0n;
  return [
    { id: 'slow', label: 'Slow', tip: 0n, hint: 'No tip. Fine when the network is quiet.' },
    { id: 'normal', label: 'Normal', tip: rung(1), hint: 'A small tip. Goes ahead of untipped transactions when blocks are busy.' },
    { id: 'fast', label: 'Fast', tip: rung(2), hint: 'A bigger tip, to be near the front of the line when blocks are busy.' },
  ];
}

export type CustomTipResult = { ok: true; tip: bigint } | { ok: false; error: string };

/** Parse a custom tip typed in BOING (up to 18 decimals). Empty is an error so the UI can prompt. */
export function parseCustomTip(text: string): CustomTipResult {
  const t = text.trim().replace(/,/g, '');
  if (t === '') return { ok: false, error: 'Enter a tip in BOING, or choose a preset.' };
  if (!/^\d*\.?\d*$/.test(t) || t === '.') return { ok: false, error: 'Tip must be a number like 0.001.' };
  const [whole, frac = ''] = t.split('.');
  if (frac.length > BOING_BASE_DECIMALS) return { ok: false, error: `Tip can have at most ${BOING_BASE_DECIMALS} decimal places.` };
  const tip = BigInt(whole || '0') * 10n ** BigInt(BOING_BASE_DECIMALS) + BigInt(frac.padEnd(BOING_BASE_DECIMALS, '0') || '0');
  if (tip > MAX_CUSTOM_TIP) return { ok: false, error: 'That tip is more than 1 BOING. Lower it to continue.' };
  return { ok: true, tip };
}

export type ResolvedTip = { tip: bigint; error?: string };

/** Turn the UI choice into the tip in base units; `error` is set only for an invalid custom amount (tip is then 0). */
export function resolveTip(choice: TipChoice): ResolvedTip {
  if (choice.preset === 'custom') {
    const r = parseCustomTip(choice.customText);
    return r.ok ? { tip: r.tip } : { tip: 0n, error: r.error };
  }
  return { tip: tipPresets().find((p) => p.id === choice.preset)?.tip ?? 0n };
}

function boing(v: bigint): string {
  return `${formatNative(v, BOING_BASE_DECIMALS, 8)} BOING`;
}

/**
 * Plain-language cost line. `fee` is the estimated network fee in base units (18 decimals) or null while estimating.
 * Fiat-agnostic on purpose: BOING only.
 */
export function describeTipCost(fee: bigint | null, tip: bigint): string {
  if (tip <= 0n) return fee == null ? 'No tip. Network fee is being estimated.' : `You pay about ${boing(fee)} in network fees. No tip.`;
  if (fee == null) return `You add a ${boing(tip)} tip on top of the network fee, which is being estimated.`;
  return `You pay about ${boing(fee)} in network fees plus a ${boing(tip)} tip: about ${boing(fee + tip)} in all.`;
}