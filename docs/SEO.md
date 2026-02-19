# SEO for Boing Express

## Implemented

- **Meta tags:** Title, description, keywords, author, robots, canonical URL
- **Open Graph:** og:type, og:url, og:title, og:description, og:image, og:site_name, og:locale (for Facebook, LinkedIn, Discord, etc.)
- **Twitter Card:** summary_large_image with title, description, image, image alt
- **Structured data:** JSON-LD `WebSite` schema for rich results
- **robots.txt:** Allow all, Sitemap URL
- **sitemap.xml:** Main routes (/, /wallet, /docs, doc subpages) with priority and changefreq
- **Theme color:** theme-color and msapplication-TileColor for browser UI (#0f172a)
- **Icons:** favicon.svg and apple-touch-icon use aqua/teal (#22d3ee) to match navbar logo and brand

## Brand consistency (aqua/teal)

- **Favicon:** SVG uses stroke `#22d3ee` (accent-neon) so the tab/bookmark icon matches the site.
- **og-image:** When you add `public/og-image.png` (1200×630), use the same aqua/teal accent so link previews match the brand.

2. **Update sitemap lastmod:** When you make significant content changes, update the `<lastmod>` dates in `public/sitemap.xml` (or automate via a build step).

3. **Per-route meta (optional):** For unique titles/descriptions per route (e.g. /docs/security), you’d add something like `react-helmet-async` or similar and set meta in each page component. The current setup uses a single set of meta in `index.html`, which is fine for a small site.

4. **Submit to search engines:**
   - [Google Search Console](https://search.google.com/search-console): add property `https://boing.express`, submit sitemap URL.
   - [Bing Webmaster Tools](https://www.bing.com/webmasters): add site, submit sitemap.
   - Optional: [IndexNow](https://www.indexnow.org/) for faster indexing.

5. **Analytics (optional):** Add Google Analytics, Plausible, or similar and link from the same docs if you use them.
