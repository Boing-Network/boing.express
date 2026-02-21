# Boing Takeover Re-design — Step 1: Audit the Existing Codebase

**Date:** 2025-02-21  
**Project:** boing.express (Boing Express — Non-Custodial Wallet for Boing Network)

---

## 1. Global stylesheet

| Location | Purpose |
|----------|---------|
| **`src/index.css`** | **Primary global stylesheet.** Imported in `src/main.tsx` and applied to the whole app. Contains `:root` CSS custom properties (design tokens), base resets, `body`, `#root`, `button`, `input`, `textarea`, `a` styles, and keyframes (`fadeIn`, `fadeInUp`, `fadeInUpSoft`). This is where design tokens will be injected/refined. |

There is no `src/styles/globals.css`, `app/globals.css`, or `src/globals.css`; the single global entry is **`src/index.css`**.

---

## 2. Component library & structure

### 2.1 Components directory: `src/components/`

| Component | File(s) | Role |
|-----------|---------|------|
| **WalletNav** | `WalletNav.tsx`, `WalletNav.module.css` | Top nav: logo + links (Home, Docs, Wallet). Uses `SiteLogo` and React Router `Link`. |
| **SiteLogo** | `SiteLogo.tsx`, `SiteLogo.module.css` | Logo (SVG icon + “Boing Express” text). Can render as `Link` or `span`; uses `currentColor` for icon. |
| **AnimatedBackground** | `AnimatedBackground.tsx`, `AnimatedBackground.module.css` | Decorative background (gradients, orbs, grid). Used on landing. |
| **FullPage3DElements** | `FullPage3DElements.tsx`, `FullPage3DElements.module.css` | 3D/decorative elements for full-page layouts. |

There are **no** shared reusable components named `Button`, `Card`, or `Input`. Buttons, cards, and inputs are implemented **inline** in screens with local class names.

### 2.2 Button patterns (screens)

- **Landing** (`Landing.tsx`): `styles.ctaNav`, `styles.primary`, `styles.secondary`, `styles.card` (card used as clickable block).
- **Welcome** (`Welcome.tsx`): `styles.primary`, `styles.secondary`, `styles.textBtn`; used for create/import wallet flows.
- **Dashboard** (`Dashboard.tsx`): `styles.lockBtn`, `styles.logoutBtn`, `styles.copyBtn`, `styles.primary`, `styles.secondary`; form submit and actions.
- **Docs** (`DocsLayout.tsx`): nav-style links.
- **Terms / Privacy** (`Terms.tsx`, `Privacy.tsx`): `styles.nav` for back/home.

Shared pattern: `.primary` = gradient CTA; `.secondary` = outline; `.textBtn` = text-only. No shared `Button` component.

### 2.3 Card patterns

- **Landing**: `styles.card` — feature cards (icons + text).
- **Welcome**: `styles.card` — steps (create / import / choose).
- **Dashboard**: Card-like sections for balance and send form (class names in `Dashboard.module.css`).

Cards are layout blocks with borders and hover states defined per screen in CSS modules.

### 2.4 Input patterns

- **Welcome**: `styles.input` for mnemonic/password fields (create/import flows).
- **Dashboard**: `styles.input` for address and amount in send form.

No shared `Input` component; all are `<input>` with screen-level module classes.

### 2.5 Navigation

- **WalletNav** (`WalletNav.tsx`): App-wide top bar; `<nav>`, `SiteLogo`, links.
- **Landing**: `styles.nav` with CTA “Open wallet”.
- **Docs**: `DocsLayout.tsx` — `styles.nav` for doc navigation.
- **Legal (Terms/Privacy)**: `styles.nav` for back to home/docs.

---

## 3. Hardcoded colors — findings

Searched: `.css`, `.scss`, `.tsx`, `.jsx`, `.html` for hex (`#...`), `rgb(...)`, `rgba(...)`, `hsl(...)`, `hsla(...)`.

### 3.1 Summary by file

| File | Count (approx) | Notes |
|------|----------------|--------|
| `src/index.css` | Many in `:root` | Tokens already use hex/rgba; good place to centralize. |
| `src/screens/Landing.module.css` | 25+ | Heavy use of `#fff`, `#00E5CC`, `#00B4FF`, `rgba(10,14,26,…)`, `rgba(0,229,204,…)`, `rgba(0,180,255,…)`. |
| `src/components/AnimatedBackground.module.css` | 20+ | Same palette: `#00E5CC`, `#00B4FF`, `rgba(10,14,26,…)`, `rgba(0,229,204,…)`, `rgba(0,180,255,…)`, `rgba(80,120,200,…)`. |
| `src/components/AnimatedBackground.tsx` | 2 | `stroke="rgba(0,229,204,0.08)"` in SVG. |
| `src/components/FullPage3DElements.module.css` | 2 | `rgba(0, 229, 204, …)`, `rgba(0, 180, 255, …)` in filters. |
| `docs/boing-theme-reference.css` | 10+ | Reference tokens: `#00E5CC`, `#00B4FF`, `#0A0E1A`, `#F0FFFE`, `rgba(0,229,204,…)`. |
| `extension/popup.css` | 15+ | Full `:root` + component hex/rgba (e.g. `#fff`, `#0A0E1A`, `#00E5CC`, `#00B4FF`, `#f8fafc`, `#94a3b8`, etc.). |
| `src/screens/docs/Docs.module.css` | 1 | `rgba(10, 14, 26, 0.85)`. |
| `src/screens/Legal.module.css` | 1 | `rgba(10, 14, 26, 0.85)`. |
| `src/components/SiteLogo.module.css` | 5 | `rgba(0, 229, 204, …)` in shadows/filters. |
| `src/components/WalletNav.module.css` | 1 | `rgba(10, 14, 26, 0.85)`. |
| `src/screens/Welcome.module.css` | 4 | `rgba(0, 229, 204, …)`, `#fff`. |
| `src/screens/Dashboard.module.css` | 4 | `rgba(0, 229, 204, …)`, `#fff`. |
| `index.html` | 2 | `theme-color` and `msapplication-TileColor`: `#0A0E1A`. |
| `docs/screenshot-helper.html` | 10+ | Inline styles: `#1a1a2e`, `#94a3b8`, `#00E5CC`, `#1a2240`, `#f8fafc`, `#0A0E1A`, `rgba(…)`. |

### 3.2 Recurring raw values (to replace with tokens)

- **Background / surface:** `#0A0E1A`, `#0d1220`, `#12182999`, `#1a2240`, `rgba(10, 14, 26, 0.85)`.
- **Primary / accent:** `#00E5CC`, `#00B4FF`, `rgba(0, 229, 204, 0.08–0.5)`, `rgba(0, 180, 255, 0.12–0.25)`.
- **Text:** `#fff`, `#f8fafc`, `#94a3b8`, `#64748b`.
- **Semantic:** `#10b981` (success), `#ef4444` (danger).
- **Misc:** `#F0FFFE` (light bg in reference), `#1a1a2e` (screenshot-helper).

---

## 4. Font imports

### 4.1 Web app (boing.express)

| Method | Location | Detail |
|--------|----------|--------|
| **&lt;link&gt; in &lt;head&gt;** | `index.html` (lines 44–46) | Preconnect to `fonts.googleapis.com` and `fonts.gstatic.com`; stylesheet: `Comfortaa:wght@300;400;500;600;700`. |
| **CSS comment** | `src/index.css` (line 2) | Comment: “Typography: Comfortaa (Google Fonts)”. |
| **Usage** | `src/index.css` (`:root`) | `--font: 'Comfortaa', system-ui, sans-serif;` |

No `@import` of fonts in app CSS; fonts loaded via HTML only.

### 4.2 Extension (popup)

| Method | Location | Detail |
|--------|----------|--------|
| **@font-face** | `extension/popup.css` (lines 2–36) | Comfortaa 300, 400, 500, 600, 700 from local `fonts/Comfortaa-*.ttf` (no Google dependency in extension). |

Extension does not use a separate font config file; font stack is defined in `popup.css` only.

### 4.3 Summary

- **App:** Comfortaa from **Google Fonts** via `<link>` in `index.html`; no font config file.
- **Extension:** Comfortaa from **local TTF** via `@font-face` in `extension/popup.css`.

---

## 5. Next steps (for Step 2)

- Use **`src/index.css`** as the single place to inject/define the design token foundation (`:root`).
- Plan token names for: bg/surface, border, text, primary/secondary, accent/glow, success/danger, radii, font, motion.
- Replace hardcoded colors in **CSS modules** and **extension/popup.css** with `var(--…)` references.
- Replace inline colors in **TSX** (e.g. `AnimatedBackground.tsx` SVG) with tokens (e.g. CSS variables via style or class).
- Consider a small set of shared components (e.g. `Button`, `Card`, `Input`) that consume tokens, to be introduced during refactor (Step 5).
- Font strategy: keep Comfortaa; decide single source (Google vs self-hosted) and document in one place (e.g. design tokens or typography doc).

---

*End of Step 1 — Audit the Existing Codebase.*
