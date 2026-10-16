import { qrSvgPath } from '../boing/qr';

/** QR colours: dark navy background, cyan modules (scanners and jsQR read inverted codes). */
export const QR_BG = '#04111f';
export const QR_FG = '#22e5ff';
export const QR_PAD = 2;
export const DEFAULT_QR_LOGO = '/assets/qr-mascot.webp';

/**
 * Every wallet QR: level H, Boing mascot centred on a dark rounded backing at ≤20% of the code width.
 * `data-value` carries the encoded text for tests.
 */
export function AddressQr(props: { value: string; className?: string; logoSrc?: string; testId?: string }) {
  const { d, size, logo } = qrSvgPath(props.value);
  const pad = QR_PAD;
  return (
    <svg
      className={props.className}
      viewBox={`${-pad} ${-pad} ${size + pad * 2} ${size + pad * 2}`}
      role="img"
      aria-label={`QR code for ${props.value}`}
      data-testid={props.testId ?? 'receive-qr'}
      data-value={props.value}
      data-logo-modules={logo?.w ?? 0}
      data-size={size}
    >
      <rect x={-pad} y={-pad} width={size + pad * 2} height={size + pad * 2} fill={QR_BG} />
      <path d={d} fill={QR_FG} shapeRendering="crispEdges" />
      {logo && logo.w > 0 && (
        <g data-testid="qr-logo">
          <rect x={logo.x} y={logo.y} width={logo.w} height={logo.w} rx={logo.w * 0.22} fill="#020a14" stroke={QR_FG} strokeWidth={0.18} />
          <image
            href={props.logoSrc ?? DEFAULT_QR_LOGO}
            x={logo.x + logo.w * 0.1}
            y={logo.y + logo.w * 0.1}
            width={logo.w * 0.8}
            height={logo.w * 0.8}
            preserveAspectRatio="xMidYMid meet"
          />
        </g>
      )}
    </svg>
  );
}
