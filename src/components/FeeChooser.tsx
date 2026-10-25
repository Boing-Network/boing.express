import { useEffect, useId, useMemo, useState } from 'react';
import { DEFAULT_TIP_CHOICE, describeTipCost, resolveTip, tipPresets, type TipChoice, type TipPresetId } from '../boing/feeTips';
import { formatNative } from '../boing/nativeUnit';
import styles from './FeeChooser.module.css';

export type FeeChooserProps = {
  /** Estimated network fee in base units (18 decimals) without the tip; null while estimating or unknown. */
  fee: bigint | null;
  value: TipChoice;
  onChange: (next: TipChoice) => void;
  disabled?: boolean;
  /** data-testid prefix (default `fee-chooser`). */
  testIdPrefix?: string;
};

/**
 * Slow / Normal / Fast / Custom priority-tip chooser with a plain-language BOING cost line.
 * Native radio inputs, so arrow keys, focus order and screen readers work without extra scripting.
 */
export function FeeChooser(p: FeeChooserProps) {
  const uid = useId();
  const presets = useMemo(() => tipPresets(), []);
  const resolved = resolveTip(p.value);
  const tid = p.testIdPrefix ?? 'fee-chooser';
  const customActive = p.value.preset === 'custom';
  const hint = customActive ? 'Type your own tip in BOING. The base network fee still applies.' : presets.find((x) => x.id === p.value.preset)?.hint;
  const options: { id: TipPresetId | 'custom'; label: string }[] = [...presets.map((x) => ({ id: x.id, label: x.label })), { id: 'custom', label: 'Custom' }];
  const errId = `${uid}-err`;
  const sumId = `${uid}-sum`;

  return (
    <fieldset className={styles.group} disabled={p.disabled} data-testid={`${tid}`}>
      <legend className={styles.legend}>Speed (optional priority tip)</legend>
      <div className={styles.options} role="radiogroup" aria-label="Transaction speed" aria-describedby={sumId}>
        {options.map((o) => (
          <label key={o.id} className={styles.option}>
            <input
              type="radio"
              className={styles.radio}
              name={`${uid}-speed`}
              value={o.id}
              checked={p.value.preset === o.id}
              onChange={() => p.onChange({ ...p.value, preset: o.id })}
              data-testid={`${tid}-${o.id}`}
            />
            <span className={styles.pill}>{o.label}</span>
          </label>
        ))}
      </div>
      {hint && <p className={styles.hint}>{hint}</p>}
      {customActive && (
        <div className={styles.custom}>
          <label htmlFor={`${uid}-custom`} className={styles.customLabel}>
            Custom tip (BOING)
          </label>
          <input
            id={`${uid}-custom`}
            className={styles.customInput}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.001"
            value={p.value.customText}
            onChange={(e) => p.onChange({ ...p.value, customText: e.target.value })}
            aria-invalid={resolved.error ? true : undefined}
            aria-describedby={resolved.error ? errId : undefined}
            data-testid={`${tid}-custom-input`}
          />
          {resolved.error && (
            <p id={errId} className={styles.error} role="alert" data-testid={`${tid}-custom-error`}>
              {resolved.error}
            </p>
          )}
        </div>
      )}
      <p id={sumId} className={styles.summary} role="status" aria-live="polite" data-testid={`${tid}-summary`}>
        {describeTipCost(p.fee, resolved.tip)}
      </p>
    </fieldset>
  );
}

export type FeeChooserStateProps = Omit<FeeChooserProps, 'value' | 'onChange'> & {
  /** Called with the resolved tip (base units) and whether the current input is valid. */
  onTipChange: (tip: bigint, valid: boolean) => void;
  initial?: TipChoice;
};

/** Uncontrolled wrapper for non-React hosts (approval page) and simple hosts. */
export function FeeChooserState({ onTipChange, initial, ...rest }: FeeChooserStateProps) {
  const [choice, setChoice] = useState<TipChoice>(initial ?? DEFAULT_TIP_CHOICE);
  useEffect(() => {
    const r = resolveTip(choice);
    onTipChange(r.tip, !r.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice]);
  return <FeeChooser {...rest} value={choice} onChange={setChoice} />;
}

/** Read-only line for a tip the dApp already set (it wins over the chooser). */
export function LockedTip({ tip, testId }: { tip: bigint; testId?: string }) {
  return (
    <p className={styles.summary} role="status" data-testid={testId ?? 'fee-chooser-locked'}>
      This site set a priority tip of {formatNative(tip, 18, 8)} BOING. It is added on top of the network fee.
    </p>
  );
}