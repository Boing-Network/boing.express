# Boing Design System — Express (Aqua Personal)

This document describes the design system used for **boing.express** and how it fits into the broader Boing ecosystem. It is the single reference for tokens, typography, components, and layout when building or updating the Express UI.

---

## Overview

The **Boing Design System** defines a shared visual language across three Boing properties (boing.express, boing.finance, boing.network), with each site using a **variant** tuned to its use case. Boing Express uses the **Aqua Personal** variant: personal, secure, approachable, and trustworthy.

- **Reference assets:** External design theme files (e.g. `boing-design-themes/express/index.html`) and PDFs: *Boing Design System — Site Variants*, *design_strategy.md*, *audit_notes.md*.
- **Implementation:** Tokens and base styles live in `src/index.css`. Component patterns follow the Aqua Personal theme (glassmorphism cards, teal-cyan accents, Orbitron + Inter).

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

## Design tokens in code

All Express tokens are defined in `src/index.css` under `:root`. Key groups:

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

## Maintenance

- When adding or changing global styles, prefer design tokens from `src/index.css` over hard-coded colors or spacing.
- For new sections, use the section-eyebrow / section-title / section-subtitle pattern.
- Keep the six pillars and tagline consistent with other Boing properties.
- For full Aqua Personal reference (all components, wallet preview, tokens showcase), see the external theme file: `express/index.html` in the boing-design-themes package.
