# SEO for Boing Express

## Implemented

- **Meta tags:** Title, description, keywords, author, robots, canonical URL
- **Open Graph:** og:type, og:url, og:title, og:description, og:image, og:site_name, og:locale (for Facebook, LinkedIn, Discord, etc.)
- **Twitter Card:** summary_large_image with title, description, image, image alt
- **Structured data:** JSON-LD `WebSite` schema for rich results
- **robots.txt:** Allow all, Sitemap URL
- **sitemap.xml:** Main routes (/, /wallet, /docs, doc subpages) with priority and changefreq
- **Theme color:** theme-color and msapplication-TileColor for browser UI
- **Icons:** favicon.svg, apple-touch-icon

## Recommended next steps

1. **Social image:** Add `public/og-image.png` (1200×630 px) for link previews. The meta tags already point to `https://boing.express/og-image.png`. Without it, some platforms may not show an image or may fall back to the favicon.

2. **Update sitemap lastmod:** When you make significant content changes, update the `<lastmod>` dates in `public/sitemap.xml` (or automate via a build step).

3. **Per-route meta (optional):** For unique titles/descriptions per route (e.g. /docs/security), you’d add something like `react-helmet-async` or similar and set meta in each page component. The current setup uses a single set of meta in `index.html`, which is fine for a small site.

4. **Submit to search engines:**
   - [Google Search Console](https://search.google.com/search-console): add property `https://boing.express`, submit sitemap URL.
   - [Bing Webmaster Tools](https://www.bing.com/webmasters): add site, submit sitemap.
   - Optional: [IndexNow](https://www.indexnow.org/) for faster indexing.

5. **Analytics (optional):** Add Google Analytics, Plausible, or similar and link from the same docs if you use them.
