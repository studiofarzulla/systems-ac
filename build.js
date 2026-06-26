#!/usr/bin/env node
// build.js — ASCRI static site generator
// Zero npm dependencies. Uses only fs and path.
//
// REPOSITIONED (Jun 2026): systems.ac no longer HOSTS papers. It is the
// ASCRI research-PROGRAMME landing surface and links OUT to the canonical
// host (dissensus.ai). The paper generator now emits OUTBOUND LINK CARDS,
// not full landing pages. No Highwire / Dublin Core / JSON-LD scholarly
// metadata is emitted, so Google Scholar stops indexing systems.ac as a
// publisher. Old paper URLs are 301'd to the canonical host via _redirects.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SITE_URL = 'https://systems.ac';
const SITE_TITLE = 'ASCRI';
const SITE_DESCRIPTION = 'Adversarial Systems & Complexity Research Initiative';
const OPERATOR = 'Dissensus';

// Canonical host that actually publishes the papers.
const CANON_HOST = 'https://dissensus.ai';
const CANON_PAPERS = `${CANON_HOST}/papers`;     // per-paper pages: /papers/<id>
const CANON_RESEARCH = `${CANON_HOST}/research`; // publications listing
const PDF_BASE = CANON_PAPERS;                    // PDFs live on the canonical host

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'papers.json');

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
const { papers, tags, statuses, programs } = data;

// Papers shown as cards (hidden ones are retired/subsumed — still redirected).
const visiblePapers = papers.filter(p => !p.hidden);

// CSS cache-busting hash (first 8 chars of MD5)
const cssPath = path.join(PUBLIC, 'css', 'ascri.css');
const CSS_HASH = crypto.createHash('md5').update(fs.readFileSync(cssPath)).digest('hex').slice(0, 8);

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDateRFC822(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toUTCString();
}

function year(dateStr) {
  return dateStr.substring(0, 4);
}

function statusClass(status) {
  return `status--${status}`;
}

function statusLabel(status) {
  return statuses[status] || status;
}

function programTitle(programKey) {
  const p = programs[programKey];
  return p ? p.title : programKey;
}

function programIndex(programKey) {
  const p = programs[programKey];
  return p ? p.index : '';
}

function romanToArabic(roman) {
  const map = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7 };
  return map[roman] || 0;
}

function programmeNumber(programKey) {
  const p = programs[programKey];
  return p ? romanToArabic(p.index) : 0;
}

// DOI-style local paper URL (legacy; now only used to build redirects).
function paperUrl(paper) {
  const num = programmeNumber(paper.program);
  return `/${num}/${paper.wpNumber}`;
}

function programmeUrl(programKey) {
  const num = programmeNumber(programKey);
  return `/${num}`;
}

// Canonical destination on dissensus.ai for this paper (clean URL).
function canonicalPaperUrl(paper) {
  return `${CANON_PAPERS}/${paper.id}`;
}

// Where a (possibly retired) paper's old systems.ac URL should 301 to.
// Subsumed papers redirect to the surviving paper via redirectId. A few retired
// papers have no canonical page on the host, so they 301 to the publications listing
// (avoids redirect-to-404). Data-driven via redirectTo:'research'; hardcoded set is a safety net.
const REDIRECT_TO_RESEARCH = new Set(['trident', 'preservation-principle']);
const REDIRECT_SUBSUMED = { 'consciousness-nominalization': 'consciousness-monograph' };
function canonicalRedirectUrl(paper) {
  if (paper.redirectTo === 'research' || REDIRECT_TO_RESEARCH.has(paper.id)) return CANON_RESEARCH;
  return `${CANON_PAPERS}/${REDIRECT_SUBSUMED[paper.id] || paper.redirectId || paper.id}`;
}

// Human-friendly label for a DOI, recognising arXiv / Zenodo / SSRN DOIs.
function describeDoi(doi) {
  if (/^10\.48550\/arXiv\./i.test(doi)) return `arXiv:${doi.replace(/^10\.48550\/arXiv\./i, '')}`;
  if (/^10\.5281\/zenodo\./i.test(doi)) return `Zenodo ${doi}`;
  if (/^10\.2139\/ssrn\./i.test(doi)) return `SSRN ${doi.replace(/^10\.2139\/ssrn\./i, '')}`;
  return `DOI ${doi}`;
}

// Identifier labels for a card, following the canonical link order:
// arXiv -> DOI -> Zenodo(concept) -> SSRN. Rendered as text (the live,
// clickable identifiers live on the canonical paper page).
function identifierLabels(paper) {
  const out = [];
  const seen = new Set();
  const add = (label) => { if (label && !seen.has(label)) { seen.add(label); out.push(label); } };

  if (paper.arxiv) add(`arXiv:${paper.arxiv}`);
  else if (paper.doi) add(describeDoi(paper.doi));
  else if (paper.zenodo) add(`Zenodo ${paper.zenodo}`);

  // Research Square preprint DOI (when present and not already the primary).
  if (paper.researchsquare) add(`Research Square ${paper.researchsquare}`);

  // Always offer the Zenodo concept DOI (de-duped against the primary above).
  if (paper.zenodo) add(`Zenodo ${paper.zenodo}`);

  // SSRN working-paper id (when not already surfaced via an SSRN DOI above).
  if (paper.ssrn) add(`SSRN ${paper.ssrn}`);

  // PhilPapers record id.
  if (paper.philpapers) add(`PhilPapers ${paper.philpapers}`);

  return out;
}

// Sort papers by date descending
function sortByDateDesc(a, b) {
  return new Date(b.date) - new Date(a.date);
}

// Group VISIBLE papers by programme
function groupByProgramme(paperList) {
  const grouped = {};
  for (const key of Object.keys(programs)) {
    grouped[key] = [];
  }
  for (const paper of paperList) {
    const key = paper.program;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(paper);
  }
  for (const key of Object.keys(grouped)) {
    grouped[key].sort(sortByDateDesc);
  }
  return grouped;
}

// Count VISIBLE papers per programme
function paperCountByProgramme() {
  const counts = {};
  for (const key of Object.keys(programs)) {
    counts[key] = 0;
  }
  for (const paper of visiblePapers) {
    if (counts[paper.program] !== undefined) {
      counts[paper.program]++;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Shared HTML fragments
// ---------------------------------------------------------------------------

function getHeadHtml(meta) {
  const title = meta.title ? `${escapeHtml(meta.title)} | ${SITE_TITLE}` : SITE_TITLE;
  const description = meta.description || SITE_DESCRIPTION;
  const canonicalUrl = meta.canonicalUrl || SITE_URL;
  const ogType = meta.ogType || 'website';
  const ogImage = meta.ogImage || `${SITE_URL}/assets/og-default.png`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${escapeHtml(description)}">

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">

  <!-- CSS -->
  <link rel="stylesheet" href="/css/ascri.css?v=${CSS_HASH}">
  <script>(function(){var t=localStorage.getItem('ascri-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t)})()</script>

  <!-- Canonical -->
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">

  <!-- RSS -->
  <link rel="alternate" type="application/rss+xml" title="${SITE_TITLE} Research Updates" href="${SITE_URL}/feed.xml">

  <!-- Open Graph -->
  <meta property="og:type" content="${ogType}">
  <meta property="og:title" content="${escapeHtml(meta.title || SITE_TITLE)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:site_name" content="${SITE_TITLE}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(meta.title || SITE_TITLE)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">
</head>`;
}

function getNavHtml(activePage) {
  const links = [
    { href: '/framework', label: 'Framework', key: 'framework' },
    { href: '/programmes/', label: 'Programmes', key: 'programmes' },
    { href: CANON_RESEARCH, label: 'Publications &rarr;', key: 'publications', external: true },
    { href: '/people', label: 'People', key: 'people' },
    { href: '/about', label: 'About', key: 'about' },
  ];

  const linksHtml = links
    .map(l => {
      const activeClass = l.key === activePage ? ' site-nav__link--active' : '';
      const ext = l.external ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${l.href}" class="site-nav__link${activeClass}"${ext}>${l.label}</a>`;
    })
    .join('\n        ');

  return `<nav class="site-nav" role="navigation" aria-label="Main navigation">
    <div class="site-nav__inner">
      <a href="/" class="site-nav__brand">${SITE_TITLE}</a>
      <div style="display:flex;align-items:center;">
        <div class="site-nav__links">
          ${linksHtml}
        </div>
        <button class="theme-toggle" onclick="toggleTheme()" aria-label="Toggle theme">
          <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        </button>
        <button class="site-nav__toggle" aria-label="Toggle menu" onclick="document.querySelector('.site-nav__links').classList.toggle('is-open')">
          <span></span><span></span><span></span>
        </button>
      </div>
    </div>
  </nav>`;
}

function getFooterHtml() {
  return `<footer class="site-footer">
    <div class="container container--wide">
      <div class="site-footer__inner">
        <div>
          <div class="site-footer__brand">${SITE_TITLE}</div>
          <div class="site-footer__copy">&copy; 2026 ${SITE_TITLE} &middot; Operated by <a href="${CANON_HOST}">${OPERATOR}</a></div>
        </div>
        <div class="site-footer__links">
          <a href="/framework">Framework</a>
          <a href="/programmes/">Programmes</a>
          <a href="${CANON_RESEARCH}" target="_blank" rel="noopener">Publications &rarr;</a>
          <a href="/people">People</a>
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
          <a href="/feed.xml">RSS</a>
        </div>
      </div>
    </div>
  </footer>`;
}

function getThemeScript() {
  return `<script>
(function(){var t=localStorage.getItem('ascri-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t)})();
function toggleTheme(){var h=document.documentElement,t=h.getAttribute('data-theme')==='dark'?'light':'dark';h.setAttribute('data-theme',t);localStorage.setItem('ascri-theme',t)}
</script>`;
}

function wrapPage(headHtml, navHtml, bodyContent, footerHtml) {
  return `${headHtml}
<body class="has-nav">
  <a href="#content" class="skip-link">Skip to content</a>
  ${navHtml}
  <div id="content">
  ${bodyContent}
  </div>
  ${footerHtml}
  ${getThemeScript()}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Outbound paper card
// ---------------------------------------------------------------------------

function renderOutboundCard(paper) {
  const ids = identifierLabels(paper);
  const idHtml = ids.length
    ? `\n          <div class="paper-card__ids">${ids.map(i => `<span class="paper-card__id">${escapeHtml(i)}</span>`).join('')}</div>`
    : '';
  const venueHtml = (paper.status === 'under-review' && paper.journal)
    ? `\n            <span class="tag">${escapeHtml(paper.journal)}</span>`
    : '';
  const subtitleHtml = paper.subtitle
    ? `\n          <p class="paper-card__subtitle">${escapeHtml(paper.subtitle)}</p>`
    : '';

  return `
        <a href="${canonicalPaperUrl(paper)}" class="paper-card paper-card--outbound" target="_blank" rel="noopener">
          <div class="paper-card__meta">
            <span class="status ${statusClass(paper.status)}">${escapeHtml(statusLabel(paper.status))}</span>${venueHtml}
            <span class="paper-card__date">${year(paper.date)}</span>
          </div>
          <h3 class="paper-card__title">${escapeHtml(paper.title)}</h3>${subtitleHtml}
          <p class="paper-card__authors">${escapeHtml(paper.authors.join(', '))}</p>${idHtml}
          <span class="paper-card__readout">Read on dissensus.ai &rarr;</span>
        </a>`;
}

// ---------------------------------------------------------------------------
// Programme pages (kept — now show OUTBOUND cards)
// ---------------------------------------------------------------------------

function buildProgrammePage(programKey) {
  const prog = programs[programKey];
  if (!prog) return null;

  const programPapers = visiblePapers
    .filter(p => p.program === programKey)
    .sort(sortByDateDesc);

  const headHtml = getHeadHtml({
    title: `Programme ${prog.index}: ${prog.title}`,
    description: prog.description,
    canonicalUrl: `${SITE_URL}${programmeUrl(programKey)}`,
  });

  const navHtml = getNavHtml('programmes');

  const cardsHtml = programPapers.map(renderOutboundCard).join('');

  const bodyContent = `
  <main class="programme-detail">
    <div class="container">
      <a href="/programmes/" class="paper-detail__back">&larr; All Programmes</a>

      <div class="programme-detail__header">
        <span class="programme-detail__index">Programme ${escapeHtml(prog.index)}</span>
        <h1 class="programme-detail__title">${escapeHtml(prog.title)}</h1>
        <p class="programme-detail__desc">${escapeHtml(prog.description)}</p>
      </div>

      <section>
        <span class="section-label">${programPapers.length} paper${programPapers.length !== 1 ? 's' : ''} &middot; hosted on dissensus.ai</span>
        <div class="featured-papers">
${cardsHtml}
        </div>
      </section>
    </div>
  </main>`;

  return wrapPage(headHtml, navHtml, bodyContent, getFooterHtml());
}

function buildProgrammesIndexPage() {
  const headHtml = getHeadHtml({
    title: 'Research Programmes',
    description: 'Five interlocking research programmes of the Adversarial Systems & Complexity Research Initiative.',
    canonicalUrl: `${SITE_URL}/programmes/`,
  });

  const navHtml = getNavHtml('programmes');

  const counts = paperCountByProgramme();

  let cardsHtml = '';
  for (const [key, prog] of Object.entries(programs)) {
    const count = counts[key] || 0;
    cardsHtml += `
        <a href="${programmeUrl(key)}" class="programme-card">
          <span class="programme-card__index">Programme ${escapeHtml(prog.index)}</span>
          <h3 class="programme-card__title">${escapeHtml(prog.title)}</h3>
          <p class="programme-card__desc">${escapeHtml(prog.description)}</p>
          <span class="programme-card__count">${count} paper${count !== 1 ? 's' : ''}</span>
        </a>`;
  }

  const bodyContent = `
  <main>
    <div class="container container--wide">
      <section class="hero" style="border-bottom: none; padding-bottom: 2rem;">
        <span class="hero__label">Research Structure</span>
        <h1 class="hero__title">Programmes</h1>
        <p class="hero__subtitle">Five interlocking programmes apply the consent-friction framework to a different substrate, testing whether the formal machinery generalizes. Full papers are published on <a href="${CANON_RESEARCH}" target="_blank" rel="noopener">dissensus.ai</a>.</p>
      </section>

      <div class="programme-grid">
${cardsHtml}
      </div>
    </div>
  </main>`;

  return wrapPage(headHtml, navHtml, bodyContent, getFooterHtml());
}

// ---------------------------------------------------------------------------
// Sitemap (static + programme pages only — no per-paper URLs)
// ---------------------------------------------------------------------------

function buildSitemap() {
  const staticPages = [
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/framework', priority: '0.9', changefreq: 'monthly' },
    { loc: '/programmes/', priority: '0.8', changefreq: 'monthly' },
    { loc: '/people', priority: '0.7', changefreq: 'monthly' },
    { loc: '/about', priority: '0.7', changefreq: 'monthly' },
    { loc: '/contact', priority: '0.5', changefreq: 'yearly' },
  ];

  const today = new Date().toISOString().split('T')[0];

  let urls = '';
  for (const page of staticPages) {
    urls += `  <url>
    <loc>${SITE_URL}${page.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>\n`;
  }

  for (const key of Object.keys(programs)) {
    urls += `  <url>
    <loc>${SITE_URL}${programmeUrl(key)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}</urlset>`;
}

// ---------------------------------------------------------------------------
// RSS Feed (announcements; item links point to the canonical host)
// ---------------------------------------------------------------------------

function buildRSSFeed() {
  const sortedPapers = [...visiblePapers].sort(sortByDateDesc);

  let items = '';
  for (const paper of sortedPapers) {
    const paperLink = canonicalPaperUrl(paper);
    const abstract = paper.abstract ? escapeXml(paper.abstract) : '';

    const descriptionParts = [];
    if (paper.subtitle) descriptionParts.push(escapeXml(paper.subtitle));
    if (paper.authors.length) descriptionParts.push(`By ${escapeXml(paper.authors.join(', '))}`);
    if (abstract) descriptionParts.push(abstract);
    const description = descriptionParts.join(' &mdash; ');

    items += `    <item>
      <title>${escapeXml(paper.title)}</title>
      <link>${paperLink}</link>
      <guid isPermaLink="true">${paperLink}</guid>
      <pubDate>${formatDateRFC822(paper.date)}</pubDate>
      <description>${description}</description>`;
    if (paper.tags) {
      for (const tag of paper.tags) {
        items += `\n      <category>${escapeXml(tags[tag] || tag)}</category>`;
      }
    }
    items += `\n    </item>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(SITE_TITLE)} — Research Updates</title>
    <link>${SITE_URL}</link>
    <description>${escapeXml(SITE_DESCRIPTION)} — papers published on dissensus.ai.</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
${items}  </channel>
</rss>`;
}

// ---------------------------------------------------------------------------
// _redirects — preserve every inbound paper URL, point it at the canonical host
// ---------------------------------------------------------------------------

function buildRedirects() {
  let out = '# systems.ac retired paper hosting — all paper URLs 301 to the canonical host (dissensus.ai).\n';
  out += '# These redirects preserve Google Scholar continuity and existing inbound links.\n\n';

  out += '# Papers index -> canonical publications listing\n';
  out += `/papers/ ${CANON_RESEARCH} 301\n`;
  out += `/papers/index.html ${CANON_RESEARCH} 301\n\n`;

  out += '# DOI-style paper URLs -> canonical paper pages\n';
  for (const paper of papers) {
    const from = paperUrl(paper);          // /{num}/{wpNumber}
    const to = canonicalRedirectUrl(paper);
    out += `${from} ${to} 301\n`;
    out += `${from}.html ${to} 301\n`;
  }

  out += '\n# Legacy slug URLs -> canonical paper pages\n';
  for (const paper of papers) {
    const to = canonicalRedirectUrl(paper);
    out += `/papers/${paper.id} ${to} 301\n`;
    out += `/papers/${paper.id}.html ${to} 301\n`;
  }

  out += '\n# Programme slug aliases -> DOI-style programme pages (still hosted here)\n';
  for (const key of Object.keys(programs)) {
    out += `/programmes/${key} ${programmeUrl(key)} 301\n`;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Main build
// ---------------------------------------------------------------------------

function build() {
  const start = Date.now();

  console.log(`Building ${SITE_TITLE} static site (outbound mode)...`);
  console.log(`  Visible papers: ${visiblePapers.length} (of ${papers.length})`);
  console.log(`  Programmes: ${Object.keys(programs).length}`);

  const papersDir = path.join(PUBLIC, 'papers');
  const programmesDir = path.join(PUBLIC, 'programmes');
  ensureDir(programmesDir);

  // Ensure DOI-style programme number directories (1/, 2/, ...)
  for (const key of Object.keys(programs)) {
    ensureDir(path.join(PUBLIC, String(programmeNumber(key))));
  }

  // Remove stale per-paper landing pages from /{num}/ dirs (keep index.html).
  let cleanedPaperPages = 0;
  for (const key of Object.keys(programs)) {
    const numDir = path.join(PUBLIC, String(programmeNumber(key)));
    if (!fs.existsSync(numDir)) continue;
    for (const f of fs.readdirSync(numDir)) {
      if (f !== 'index.html' && f.endsWith('.html')) {
        fs.unlinkSync(path.join(numDir, f));
        cleanedPaperPages++;
      }
    }
  }
  if (cleanedPaperPages) {
    console.log(`  Removed ${cleanedPaperPages} stale per-paper landing pages`);
  }

  // Retire the hosted papers index (now a 301 to dissensus.ai/research).
  const papersIndexPath = path.join(papersDir, 'index.html');
  if (fs.existsSync(papersIndexPath)) {
    fs.unlinkSync(papersIndexPath);
    console.log('  Removed hosted papers index (public/papers/index.html)');
  }

  // --- Programme pages (DOI-style: /{num}/index.html) ---
  let progCount = 0;
  for (const key of Object.keys(programs)) {
    const html = buildProgrammePage(key);
    if (html) {
      const outPath = path.join(PUBLIC, String(programmeNumber(key)), 'index.html');
      fs.writeFileSync(outPath, html, 'utf-8');
      progCount++;
    }
  }
  console.log(`  Generated ${progCount} programme pages -> public/{num}/index.html`);

  // --- Programmes index ---
  fs.writeFileSync(path.join(programmesDir, 'index.html'), buildProgrammesIndexPage(), 'utf-8');
  console.log('  Generated programmes index -> public/programmes/index.html');

  // --- Sitemap ---
  fs.writeFileSync(path.join(PUBLIC, 'sitemap.xml'), buildSitemap(), 'utf-8');
  console.log('  Generated sitemap -> public/sitemap.xml');

  // --- RSS Feed ---
  fs.writeFileSync(path.join(PUBLIC, 'feed.xml'), buildRSSFeed(), 'utf-8');
  console.log('  Generated RSS feed -> public/feed.xml');

  // --- _redirects ---
  fs.writeFileSync(path.join(PUBLIC, '_redirects'), buildRedirects(), 'utf-8');
  console.log(`  Generated _redirects (${papers.length} papers + ${Object.keys(programs).length} programme aliases)`);

  // --- Cache-bust CSS in hand-authored static pages ---
  const staticPages = ['index.html', 'framework.html', 'people.html', 'about.html', 'contact.html', '404.html'];
  let busted = 0;
  for (const page of staticPages) {
    const pagePath = path.join(PUBLIC, page);
    if (fs.existsSync(pagePath)) {
      let html = fs.readFileSync(pagePath, 'utf-8');
      html = html.replace(/ascri\.css(\?v=[a-f0-9]*)?"/g, `ascri.css?v=${CSS_HASH}"`);
      fs.writeFileSync(pagePath, html, 'utf-8');
      busted++;
    }
  }
  console.log(`  Cache-busted CSS (v=${CSS_HASH}) in ${busted} static pages`);

  console.log(`\nDone in ${Date.now() - start}ms.`);
}

build();
