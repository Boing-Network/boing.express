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

- **boing-express-mark.svg** — Vector mark (stone slab + engraved hex + teal→blue gradient core). Source for raster icon.
- **favicon.svg** (repo root `public/`) — Tab icon (simplified 32×32-style mark).
- **icon-only-transparent.png** — 512×512 PNG generated from `boing-express-mark.svg` (Sharp) for Apple touch and PNG favicon fallback.
- **logo-light-transparent.png** / **logo-dark-transparent.png** — Full wordmark logos for dark and light backgrounds (optional; app uses icon-only).
- **logo-boing-comic.png** — "BOING!" comic-style logo (optional alternate for hero).

### Pillars (six pillars of Boing Network)

- **pillar-*.svg** — Same assets as [boing.network](https://boing.network/) (`/assets/pillar-*.svg`). Used on the Landing hero pills and feature cards (security, scalability, decentralization in cards; all six in pills).

### Locations

- **Web app:** `public/assets/` (copied to `dist/` on build)
- **Extension:** `extension/assets/` (mirror for extension package)

---

## Fonts

**Comfortaa** (300–700) is the **only** UI typeface for the web app and extension surfaces:

- **Web app:** Loaded from Google Fonts via `@import` in `src/index.css` (weights 300, 400, 500, 600, 700).
- **Extension:** `extension/popup.css` and `extension/approval.css` use the same Google Fonts import; `popup.css` may also define `@font-face` rules pointing at optional `.ttf` files under `extension/fonts/` when those files are present in a given build.
