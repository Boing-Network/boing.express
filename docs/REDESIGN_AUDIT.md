# Boing Takeover Redesign — Audit (Steps 1 & 8)

**Date:** 2025-02-21  
**Status:** Complete

---

## Step 1: Audit the existing codebase

### Global stylesheet

- **`src/index.css`** — Primary global stylesheet. Contains `:root` tokens, base resets, and keyframes. Single source for design tokens.

### Component structure (current)

- **WalletNav, SiteLogo, AnimatedBackground** — Core components. Buttons, cards, inputs are inline in screens with local class names.
- **FullPage3DElements** — Removed during cleanup (was orphaned).

### Hardcoded colors → tokens

All non-`:root` instances were replaced with CSS variables. Tokens in `:root` include `--glow-cyan-soft`, `--accent-cyan-subtle`, `--overlay-*`, etc.

### Fonts

- **Web app:** Comfortaa, Orbitron, JetBrains Mono from Google Fonts.
- **Extension:** Comfortaa from local TTF via `@font-face` in `extension/popup.css`.

---

## Step 8: Final audit & quality check

### Hardcoded colors — resolved

- All styling in `src/**` uses `var(--…)`. Raw values only in `:root`.
- **Excluded:** `index.html` (theme-color meta requires hex); `docs/screenshot-helper.html` and `extension/popup.css` (can be aligned later).

### Interactive states

- **Buttons:** Hover with translateY, box-shadow, transitions.
- **Links:** Accent color, hover glow.
- **Cards:** Border and shadow on hover.
- **Inputs:** Focus border and glow.
- **Reduced motion:** Respected site-wide.

### Background application

- **Landing:** Boing Background Engine (canvas), overlay with `var(--overlay-from)`, `var(--overlay-to)`.
- **App pages:** `var(--bg-primary)` and repeating `hex-grid.svg` (60×60px).

### Contrast (WCAG)

- Primary text `#F0FFFE` on `#0A0E1A` — AAA. Secondary passes AA.

### Rules enforced

- No new colors outside `:root`.
- Do not remove existing functionality.
- Preserve accessibility (WCAG AA).
