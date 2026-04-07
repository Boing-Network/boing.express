# Boing Design System — Express (Aqua Personal)

This document describes the **Boing Design System** as it applies to **boing.express**: one shared foundation plus three site-specific variants, with this repo implementing the **Aqua Personal** variant. It is the single reference for tokens, typography, components, and layout when building or updating the Express UI.

---

## Overview

The Boing Design System is **one foundational theme with three variants** — one per official Boing property. All three share the same structural and brand rules; each variant applies a distinct accent palette, background character, and component personality suited to its product.

- **Reference assets:** External design theme files (e.g. `boing-design-themes/express/index.html`, `finance/index.html`, `network/index.html`) and PDFs: *Boing Design System — Site Variants*, *design_strategy.md*, *audit_notes.md*.
- **This repo:** Implements only the **Express** variant. Tokens and base styles live in `src/index.css`; component patterns follow Aqua Personal (glassmorphism, warm teal-cyan, Orbitron + Inter).

---

## Three variants (one per Boing property)

| Site | Variant name | Personality | Primary accent(s) |
|------|----------------|-------------|--------------------|
| **boing.express** | **Aqua Personal** | Personal · Secure · Approachable · Trustworthy | #00e8c8 warm teal-cyan |
| **boing.finance** | **Deep Trade** | Professional · Data-driven · Dynamic · Powerful | #00e5ff electric cyan + #00ff88 profit green |
| **boing.network** | **Cosmic Foundation** | Authoritative · Technical · Epic · Foundational | #7c3aed deep violet + #06b6d4 cosmic cyan |

- **Express (this app):** Wallet and explorer; warmer, trust-forward palette; underwater caustics; security badges prominent.
- **Finance:** DeFi platform; data-forward; grid background; green/red for P&L; JetBrains Mono for numbers; ticker, charts, swap widget.
- **Network:** L1 protocol site; cosmic/nebula feel; violet primary; roadmap/ecosystem/status systems; largest hero; developer-focused.

Shared across all three: dark base (boing-black, boing-navy), Orbitron + Inter, glassmorphism cards, section structure (eyebrow → title → subtitle), six pillars, tagline, and breakpoints (1024px, 640px). Only **accent palette** and **background character** (caustics vs grid vs nebula) differ by variant.

---

## Shared foundation (all Boing sites)

- **Visual theme:** Aquatic–space (deep sea + cosmic depth).
- **Typography:** Display = Orbitron (700–900); Body = Inter (300–700); Monospace = JetBrains Mono where needed.
- **Background system:** Base gradient → structural layer (grid/nebula/caustics) → star field → shooting stars → atmospheric glow.
- **Cards:** Glassmorphism (backdrop blur, semi-transparent background, 1px accent border, hover brighten).
- **Tagline:** “Authentic. Decentralized. Optimal. Quality-Assured.”
- **Six pillars:** Security, Scalability, Decentralization, Authenticity, Transparency, Quality Assurance.

---

## Express variant: Aqua Personal

**Personality:** Personal · Secure · Approachable · Trustworthy.

**Accent palette:**

| Token | Value | Role |
|-------|--------|------|
| `--express-primary` | #00e8c8 | Primary CTA, active states, borders |
| `--express-secondary` | #00b4d8 | Secondary elements, gradients |
| `--express-accent` | #48cae4 | Highlights, hover |
| `--express-warm` | #0096c7 | Deeper trust-blue contrast |
| `--express-soft` | #90e0ef | Soft pastel accents |
| `--trust-green` | #2dd4bf | Security / “safe” indicators |
| `--shield-gold` | #fbbf24 | Premium / security badges |

**Background character:** Underwater caustics, warm teal-cyan shooting stars, calm “deep ocean at night” feel.

**Breakpoints (design system standard):**

- `> 1024px` — Full desktop.
- `≤ 1024px` — Reduced columns, optional sidebar collapse.
- `≤ 640px` — Single column, compact nav (e.g. hide nav links).

---

## Page color variants (data-page)

The app sets `data-page` on the main content wrapper from the current route so accents can shift subtly per section:

| Route | data-page | Accent feel |
|-------|-----------|-------------|
| `/` | landing | Default Aqua Personal (warm teal-cyan) |
| `/wallet/*` | wallet | Trust-forward (teal-green `--trust-green`) |
| `/docs`, `/docs/*` | docs | Cooler cyan (`--express-secondary`) |
| `/privacy`, `/support`, `/terms` | legal | Same as docs |

Overrides in `src/index.css` adjust `--express-primary`, `--express-primary-glow`, `--card-border`, and `--express-primary-dashed` so nav, buttons, and cards pick up the variant.

## Design tokens in code (Express only)

This codebase implements **only the Aqua Personal (Express) variant**. Finance and Network each have their own token sets (e.g. `--finance-primary`, `--network-primary`) in their respective repos; they are not mixed here. All Express tokens are defined in `src/index.css` under `:root`. Key groups:

- **Backgrounds:** `--boing-black`, `--boing-navy`, `--boing-navy-mid`, `--boing-navy-light`, `--card-bg`, `--glass-bg`, `--nav-bg`.
- **Text:** `--text-primary`, `--text-secondary`, `--text-muted`, `--text-accent`.
- **Express accents:** `--express-primary` through `--express-soft`, `--trust-green`, `--shield-gold`.
- **Borders & glass:** `--card-border`, `--card-border-hover`, `--nav-border`, `--glass-border`.
- **Shadows & glow:** `--shadow-teal`, `--shadow-card`, `--express-primary-glow`.
- **Typography:** `--font-display` (Orbitron), `--font-body` (Inter), `--font-mono` (JetBrains Mono).
- **Radius:** `--radius-sm` (8px), `--radius-md` (14px), `--radius-lg` (20px), `--radius-xl` (28px), `--radius-pill` (999px).

Legacy tokens (e.g. `--accent-teal`, `--bg-card`) are aliased to these so existing components keep working.

---

## Section structure

Use this pattern for section headers:

- **Eyebrow:** `.section-eyebrow` — small label above the title (0.75rem, 700, uppercase, letter-spacing 0.15em, accent color).
- **Title:** `.section-title` — Orbitron, clamp(1.8rem, 3.5vw, 2.8rem), 700.
- **Subtitle:** `.section-subtitle` — 1.05rem, `--text-secondary`, max-width ~520px, centered.

Defined in `src/index.css` for use in any screen or layout.

---

## Buttons

- **Primary:** Teal-cyan gradient (`--express-primary` → `--express-warm`), dark text, pill or rounded.
- **Secondary:** Transparent + teal border (dashed or solid).
- **Ghost:** Semi-transparent background, subtle border.
- **Trust:** Teal-green gradient for security/trust actions (optional).

Use classes `.btn-primary`, `.btn-secondary`, `.btn-ghost` or `data-variant="primary"` / `"secondary"` on `<button>` where supported.

---

## Accessibility

- **Focus:** Interactive elements use a visible focus ring (accent color) — see `:focus-visible` in `src/index.css`.
- **Motion:** `prefers-reduced-motion: reduce` is respected; animations are disabled or minimal.
- **Contrast:** Primary text on dark backgrounds meets WCAG AA where applicable; check new combinations with the token palette.

---

## App background (global scene)

The web shell uses **`EngraveSceneBackdrop`** (`src/components/EngravingBackdrop.tsx`): a cool stone slab, engraved silver vein network (SVG), and soft animated neon accents—aligned with the Creator Treasury / Colosseum hackathon reference. It sits inside `pageWrap` in `App.tsx` so it grows with scroll height. There is **no canvas** or separate motion engine; `prefers-reduced-motion: reduce` tones down the neon layer animations in CSS.

## Maintenance

- When adding or changing global styles, prefer design tokens from `src/index.css` over hard-coded colors or spacing.
- For new sections, use the section-eyebrow / section-title / section-subtitle pattern.
- Keep the six pillars and tagline consistent with other Boing properties.
- For full Aqua Personal reference (all components, wallet preview, tokens showcase), see the external theme file: `express/index.html` in the boing-design-themes package.

---

## Compliance & assets (merged from design-system-compliance-and-assets.md)

**Reviewed against:** Boing_Network_Official_Visual_Design_System.pdf and related design docs.

### Implementation status

- **Colors, typography, components:** Aligned with Official Visual Design System. Tokens in `:root`; hex grid stroke 0.06; H1/H2/H3 type scale per spec.
- **Backgrounds:** Global engraved stone + vein + neon via `EngraveSceneBackdrop`. Page shells (`.page-landing`, `.page-app`) use a transparent background over that scene (no repeating hex grid in the shell).
- **Motion:** UI keyframes (float, glow pulse, fade-in-up); neon layer respects `prefers-reduced-motion`.

### Optional assets

- **Boing Bot mascot:** For landing, onboarding, empty states; see [ASSETS_AND_FONTS.md](ASSETS_AND_FONTS.md).
- **Pillar illustrations:** `public/assets/pillar-*.svg` (same files as boing.network); used in Landing pills and feature cards.

---

## Audit (2025-02-21)

Steps 1 & 8 of the Boing Takeover Redesign — audit and quality check.

### Global stylesheet

- **`src/index.css`** — Primary global stylesheet. Contains `:root` tokens, base resets, and keyframes. Single source for design tokens.

### Component structure

- **WalletNav, SiteLogo, EngraveSceneBackdrop** — Core shell components. Buttons, cards, inputs are inline in screens with local class names.
- **FullPage3DElements** — Removed during cleanup (was orphaned).

### Hardcoded colors → tokens

All non-`:root` instances were replaced with CSS variables. Tokens in `:root` include `--glow-cyan-soft`, `--accent-cyan-subtle`, `--overlay-*`, etc.

### Fonts

- **Web app:** Comfortaa, Orbitron, JetBrains Mono from Google Fonts.
- **Extension:** Comfortaa from local TTF via `@font-face` in `extension/popup.css`.

### Hardcoded colors — resolved

- All styling in `src/**` uses `var(--…)`. Raw values only in `:root`.
- **Excluded:** `index.html` (theme-color meta requires hex); `docs/screenshot-helper.html` and `extension/popup.css` (can be aligned later).

### Interactive states

- **Buttons:** Hover with translateY, box-shadow, transitions.
- **Links:** Accent color, hover glow.
- **Cards:** Border and shadow on hover.
- **Inputs:** Focus border and glow.
- **Reduced motion:** Respected site-wide.

### Contrast (WCAG)

- Primary text `#F0FFFE` on `#0A0E1A` — AAA. Secondary passes AA.

### Rules enforced

- No new colors outside `:root`.
- Do not remove existing functionality.
- Preserve accessibility (WCAG AA).
