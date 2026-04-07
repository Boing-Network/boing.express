# Boing Express — Assets & Fonts

Inventory of design system assets and fonts used by the web app and extension.

---

## Assets

Official Boing Network design system assets. All are used in the web app.

### Backgrounds

- **hex-grid.svg** — Single hexagon outline (stroke `rgba(0, 229, 204, 0.06)`). Kept in `public/assets/` for reuse; the current app shell does not tile it—background is the engraved scene in `EngravingBackdrop`.

### Mascot (Boing Bot)

- **mascot-default.png** — Default pose. Used on Welcome create/import steps.
- **mascot-excited.png** — Excited pose. Used on Landing hero and Welcome choose step.
- **mascot-thinking.png** — Thinking pose. Used on Welcome unlock step.
- **mascot-winking.png** — Winking pose. Available for empty states or success moments.

### Branding

- **icon-only-transparent.png** — Boing icon (hexagonal orb + cyan ring). Used for SiteLogo (nav/header), Landing hero badge, and favicon/apple-touch-icon.
- **logo-light-transparent.png** / **logo-dark-transparent.png** — Full wordmark logos for dark and light backgrounds (optional; app uses icon-only).
- **logo-boing-comic.png** — "BOING!" comic-style logo (optional alternate for hero).

### Pillars (six pillars of Boing Network)

- **pillar-security.png** — Security. Used in Landing pills and "Non-custodial" feature card.
- **pillar-scalability.png** — Scalability. Used in Landing pills and "Web & extension" feature card.
- **pillar-decentralization.png** — Decentralization. Used in Landing pills and "Boing Network" feature card.
- **pillar-authenticity.png** — Authenticity. Used in Landing pills.
- **pillar-transparency.png** — Transparency. Used in Landing pills.
- **pillar-quality.png** — Quality Assurance. Used in Landing pills.

### Locations

- **Web app:** `public/assets/` (copied to `dist/` on build)
- **Extension:** `extension/assets/` (mirror for extension package)

---

## Fonts

**Comfortaa** .ttf files are loaded and used site-wide as the primary font (CSS family name: Contraa for compatibility):

- `Comfortaa-Light.ttf` (300)
- `Comfortaa-Regular.ttf` (400)
- `Comfortaa-Medium.ttf` (500)
- `Comfortaa-SemiBold.ttf` (600)
- `Comfortaa-Bold.ttf` (700)

**Locations:** `public/fonts/` (web app) and `extension/fonts/` (extension popup).
