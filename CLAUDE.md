# CLAUDE.md

Instructions for Claude Code when working in this repository.

## Project Overview

**Site:** systems.ac
**Entity:** ASCRI (Adversarial Systems & Complexity Research Initiative)
**Purpose:** Academic face of ASCRI — research programmes, papers with Google Scholar metadata, theoretical framework.

**Architecture:** Static HTML + Node.js build script. Hosted on Cloudflare Pages. Auto-deploys from GitHub on push.

## Relationship to Other Sites (June 2026 restructure)

- **systems.ac** = the ASCRI research **programme** landing. Does NOT host papers — paper cards link OUT to the canonical host. Theory + programmes are the focus.
- **dissensus.ai** = the lab/org AND the **canonical paper host** (`dissensus.ai/papers/<id>`, hosts the PDFs). systems.ac links to it.
- **farzulla.org** = Murad Farzulla's personal academic résumé site (no longer hosts papers).

## Design System

Two stylesheets: `css/system.css` (shared design system) then `css/ascri.css` (site layer,
cache-busted by build.js). **Dark default**, light via `data-theme="light"` (`fz-theme` in
localStorage) — note this is the *opposite* default from dissensus.ai, deliberately left alone.

⚠️ **`css/system.css` here is the older 7.7 KB copy** (identical to `_design-system/system.css`).
dissensus.ai's is 12.2 KB and has moved ahead — self-hosted fonts, hamburger nav, light default.
Do not blind-sync between them: syncing forward would flip this site's theme default.

**Fonts (resolved 30 Jul 2026):** self-hosted woff2 in `public/assets/fonts/`, `@font-face`
declared **in `ascri.css`, not `system.css`** — the site layer is the only file safe to touch
without dragging in dissensus's diverged system.css. The Google Fonts CDN links are gone from
both `getHeadHtml()` and the six hand-authored pages. No third-party font CDN; no visitor IPs
to Google.

Shipped weights = exactly what the CSS asks for: Inter 400/500/600/700 + 400 italic, IBM Plex
Mono 400/500/600. Note `h1–h4` use `font-weight: 650`, which resolves to the **700** face — if
you ever drop Inter 700, headings get lighter. Inter 300 was requested from the CDN but no rule
ever used it; not shipped.

⚠️ The CDN silently supplied **greek** and **latin-ext** subsets. The latin-only files do not,
so `inter-greek-{400,500,600,700}` and `inter-latin-ext-400` are shipped with `unicode-range`
guards — without them the notation (α σ ε η φ Λ Ψ) and names like "Tomáš Gavenčiak" drop to a
system font mid-sentence. **Adding a new Inter weight means adding its greek subset too.**
`→ ← ≥ ◐` were never in Google's Inter/Plex ranges either and still fall back — unchanged.

**Colors:** burgundy `#800020` accent (brand constant), tokens come from `system.css`.

## Site Structure

```
systems-ac/
├── papers.json          # Paper metadata (source of truth)
├── scope.json           # Definition, central claim, in/out of scope, adjacent fields
├── library.json         # Curated EXTERNAL work + annotations (other people's research)
├── notes.json           # The lab's informal writeups / reference material
├── submit.json          # Participation copy: recommend / publish / critique
├── build.js             # Generates ALL of: programme pages, scope, library, notes,
│                        # submit, sitemap, RSS, _redirects
├── wrangler.json        # Cloudflare Pages config
├── public/              # Served by Cloudflare Pages
│   ├── index.html       # Hand-authored homepage
│   ├── framework.html   # Theoretical framework (hand-authored)
│   ├── people.html · about.html · contact.html · 404.html   # hand-authored
│   ├── scope.html       # GENERATED from scope.json
│   ├── library/         # GENERATED from library.json
│   ├── notes/           # GENERATED from notes.json (index + one page per note)
│   ├── submit.html      # GENERATED from submit.json
│   ├── css/             # system.css + ascri.css
│   ├── assets/          # Favicons, logo
│   ├── 1/ .. 5/         # GENERATED programme pages
│   ├── programmes/      # GENERATED index
│   ├── sitemap.xml · feed.xml · _redirects   # GENERATED
```

The four new JSON files are **optional** — `build.js` skips the corresponding page and logs it
if one is missing, so the site always builds.

## Submissions

`SUBMISSIONS_FORM_ID` at the top of `build.js` is the Formspree form ID for `/submit`.
**While it is `null` the page renders a documented email route instead of a form** — deliberate,
so nothing half-wired ships. Set it to activate all three forms at once.

## Build Process

```bash
node build.js
# Generates papers/*, programmes/*, sitemap.xml, feed.xml
```

## Development

```bash
node build.js && python -m http.server 8000 --directory public
```

## Key Rules

- systems.ac NO LONGER HOSTS PAPERS. The generator emits outbound link cards → `dissensus.ai/papers/<id>`. Do NOT re-add `citation_*` / Dublin Core / JSON-LD ScholarlyArticle metadata (that caused Google Scholar to index systems.ac as a duplicate publisher).
- All retired paper URLs are 301'd in `public/_redirects` → keep those intact when editing.
- Don't edit programmes/*.html or the generated `1/`–`5/` pages directly (generated by build.js)
- Rebuild after editing papers.json
- Public status vocabulary: "Under Review" / "Preprint" only

## Navigation

```
ASCRI   Framework | Scope | Programmes | Library | Notes | Publications → | Submit | About
```

Hamburger below 880px (`.nav__burger` in `ascri.css`, `toggleNav()` in the inline theme script).
The nav is generated by `getNavHtml(activePage)` — add routes there, not in the HTML.

**Library vs Notes vs Publications** — keep these distinct, it is the whole point of the IA:
- **Library** = other people's work, annotated. Inclusion is not endorsement.
- **Notes** = our own informal/unreviewed material. Explicitly not portfolio claims.
- **Publications →** = the peer-reviewed/preprint corpus, hosted on dissensus.ai. Outbound only.

---

**Last Updated:** 30 July 2026
