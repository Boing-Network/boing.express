# Boing Design System — Express

> 👋 **Everyday users:** the look is dark navy with one electric-blue accent, set in Comfortaa — the same family as boing.network.
> 🛠️ **Developers:** tokens live in `src/index.css`. Use them instead of hard-coded colors. Do not invent a new palette.
> 🛰️ **Operators:** n/a — visual system only.

Boing Express follows the shared Boing brand defined in [BRAND.md](https://github.com/Boing-Network/boing.network/blob/main/BRAND.md) (tagline *"Boing Network — Quality, enforced by the protocol"*, naming, tone, shared tokens). This page records how this repo applies it. If this page and `BRAND.md` disagree, `BRAND.md` wins.

> **Status:** public testnet. Mainnet is not live. Independent audits are not complete.

---

## Palette

The shared brand tokens are defined once in `src/index.css` under "Unified Boing tokens". Express keeps its older `--express-*` token names as aliases, so existing components keep working.

| Token | Value | Role |
|-------|-------|------|
| `--boing-navy-950` (`--boing-black`) | `#050A1A` | Page background |
| `--boing-navy-900` (`--boing-navy`) | `#0A1128` | Surfaces |
| `--boing-navy-800` (`--boing-navy-mid`) | `#101A38` | Cards, glass panels |
| `--boing-navy-700` (`--boing-navy-light`) | `#18244A` | Raised surfaces, hover |
| `--boing-accent` (`--express-primary`) | `#3B8CFF` | Primary actions, active states, links |
| `--boing-accent-soft` (`--express-accent`, `--express-soft`) | `#8DB8FF` | Highlights, hover |
| `--express-secondary` / `--express-warm` | `#2563EB` | Deeper blue for gradients |
| `--boing-text` (`--text-primary`) | `#F0F4F8` | Primary text |
| `--text-secondary` | `#94a3b8` | Secondary text |
| `--text-muted` | `#8b9bb3` | Hints and captions (passes WCAG AA) |
| `--boing-success` (`--trust-green`) | `#34D399` | Security and "safe" indicators |
| `--boing-warning` / `--shield-gold` | `#FBBF24` | Testnet label and caution badges |
| `--boing-danger` (`--danger`) | `#F87171` | Errors |

Borders and glass: `--card-border`, `--card-border-hover`, `--glass-bg`, `--nav-bg`. Glow: `--express-primary-glow`, `--shadow-teal` (the name is historical; the value is blue).

Check `src/index.css` for the exact current values before copying a hex into a doc or component.

## Typography and shape

- **Font:** Comfortaa (300–700) for display, body and code (`--font-display`, `--font-body`, `--font-mono`). The web app loads it through a Google Fonts `@import` in `src/index.css`. The extension does the same in `popup.css` and `approval.css`, with optional local `@font-face` files under `extension/fonts/`.
- **Radius:** `--radius-sm` 8px, `--radius-md` 14px, `--radius-lg` 20px, `--radius-xl` 28px, `--radius-pill` 999px.
- **Breakpoints:** above 1024px is full desktop. At 1024px and below, columns reduce. At 640px and below, the layout is a single column with compact navigation.

## Page accent variants (`data-page`)

The app sets `data-page` on the main content wrapper from the route, so the accent shifts slightly per section. Overrides live in `src/index.css`.

| Route | `data-page` | Accent |
|-------|-------------|--------|
| `/` | `landing` | Default (`#3B8CFF`) |
| `/wallet/*` | `wallet` | `--trust-green` |
| `/docs`, `/docs/*` | `docs` | `--express-secondary` (`#2563EB`) |
| `/privacy`, `/support`, `/terms` | `legal` | Same as docs |

The overrides change `--express-primary`, `--express-primary-glow`, `--express-primary-dashed`, `--card-border` and `--card-border-hover`.

## Components

- **Section headers:** `.section-eyebrow` (small uppercase label), `.section-title` (Comfortaa, `clamp(1.8rem, 3.5vw, 2.8rem)`), `.section-subtitle`.
- **Buttons:** `.btn-primary` (accent gradient, dark text), `.btn-secondary` (transparent with accent border). Hover lifts slightly with a shadow.
- **Cards:** glassmorphism (translucent `--glass-bg`, 1px `--card-border`, brighter border on hover).
- **Background:** the web shell uses `EngraveSceneBackdrop` (`src/components/EngravingBackdrop.tsx`): a stone slab with an engraved vein network and soft animated accents. Page shells (`.page-landing`, `.page-app`) sit transparently over it.
- **Pillar illustrations:** `public/assets/pillar-*.svg` (same files as boing.network).
- **Assets and mascot:** see [ASSETS_AND_FONTS.md](ASSETS_AND_FONTS.md).

## Accessibility

- **Focus:** visible focus ring in the accent color (`:focus-visible` in `src/index.css`).
- **Motion:** `prefers-reduced-motion: reduce` is respected; animations are disabled or minimal.
- **Contrast:** text meets WCAG AA (4.5:1) on every dark surface, enforced by `tests/a11yContrast.test.ts`. If you change a text or surface token, that test tells you whether it still passes.
- **Tabs (keyboard):** wallet section tabs and the Transfer asset switch are ARIA tablists with a roving tabindex. Left/Right wrap, Home/End jump (`src/components/tabNav.ts`).
- **Live regions:** loading and empty states use `role="status"` (`aria-busy` while loading); errors use `role="alert"`.

## Maintenance rules

- Take colors and spacing from the tokens in `src/index.css`. Raw values belong only in `:root` (exceptions: the `theme-color` meta in `index.html` and the ad-hoc `docs/screenshot-helper.html`).
- Do not remove existing functionality or weaken accessibility when restyling.
- Keep the tagline, naming and status wording consistent with `BRAND.md`.
- Update this page in the same PR when you change a token.
