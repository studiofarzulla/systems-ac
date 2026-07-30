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

// Formspree form ID for the /submit surfaces. MF: create a form at formspree.io for
// systems.ac and paste its ID here (the part after /f/). While this is null the
// submission sections render a documented email route instead of a form, so nothing
// half-wired ships either way.
const SUBMISSIONS_FORM_ID = null;
const SUBMISSIONS_EMAIL = 'research@dissensus.ai';

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'papers.json');

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
const { papers, tags, statuses, programs } = data;

// Optional data files — the site builds without them, just without those pages.
function loadOptional(name) {
  const p = path.join(ROOT, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

const libraryData = loadOptional('library.json');
const notesData = loadOptional('notes.json');
const scopeData = loadOptional('scope.json');
const submitData = loadOptional('submit.json');

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

  <!-- Fonts: self-hosted woff2 subsets, @font-face declared in ascri.css.
       No third-party font CDN — design-system rule, and it keeps visitor
       IPs away from Google. -->

  <!-- Favicon -->
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">

  <!-- CSS: shared design system + ASCRI supplement -->
  <link rel="stylesheet" href="/css/system.css">
  <link rel="stylesheet" href="/css/ascri.css?v=${CSS_HASH}">

  <!-- Theme: dark default, light via [data-theme="light"], persisted (fz-theme) -->
  <script>
  (function(){var t=localStorage.getItem('fz-theme')||'dark';if(t==='light')document.documentElement.setAttribute('data-theme','light');})();
  </script>

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
    { href: '/scope', label: 'Scope', key: 'scope' },
    { href: '/programmes/', label: 'Programmes', key: 'programmes' },
    { href: '/library/', label: 'Library', key: 'library' },
    { href: '/notes/', label: 'Notes', key: 'notes' },
    { href: CANON_RESEARCH, label: 'Publications &rarr;', key: 'publications', external: true, hideSm: true },
    { href: '/submit', label: 'Submit', key: 'submit' },
    { href: '/about', label: 'About', key: 'about', hideSm: true },
  ];

  const linksHtml = links
    .map(l => {
      const cls = l.hideSm ? ' class="hide-sm"' : '';
      const active = l.key === activePage ? ' aria-current="page"' : '';
      const ext = l.external ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${l.href}"${cls}${active}${ext}>${l.label}</a>`;
    })
    .join('\n      ');

  return `<nav class="nav" role="navigation" aria-label="Main navigation">
    <a href="/" class="nav__brand">${SITE_TITLE}</a>
    <button class="nav__burger" aria-label="Menu" aria-expanded="false" aria-controls="nav-menu" onclick="toggleNav(this)"><span></span><span></span><span></span></button>
    <div class="nav__links" id="nav-menu">
      ${linksHtml}
      <button class="toggle" onclick="toggleTheme()" aria-label="Toggle theme">&#9680; theme</button>
    </div>
  </nav>`;
}

function getFooterHtml() {
  return `<footer class="footer">
    <div class="container" style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:1rem;">
      <span>&copy; 2026 ${SITE_TITLE} &middot; Operated by <a href="${CANON_HOST}">${OPERATOR}</a></span>
      <span>
        <a href="/framework">Framework</a> &middot;
        <a href="/scope">Scope</a> &middot;
        <a href="/programmes/">Programmes</a> &middot;
        <a href="/library/">Library</a> &middot;
        <a href="/notes/">Notes</a> &middot;
        <a href="${CANON_RESEARCH}" target="_blank" rel="noopener">Publications &rarr;</a> &middot;
        <a href="/submit">Submit</a> &middot;
        <a href="/people">People</a> &middot;
        <a href="/about">About</a> &middot;
        <a href="/contact">Contact</a> &middot;
        <a href="https://www.linkedin.com/company/dissensus-ai/" target="_blank" rel="noopener">LinkedIn</a> &middot;
        <a href="https://github.com/dissensus-ai" target="_blank" rel="noopener">GitHub</a> &middot;
        <a href="/feed.xml">RSS</a>
      </span>
    </div>
  </footer>`;
}

function getThemeScript() {
  return `<script>
function toggleTheme(){var h=document.documentElement;if(h.getAttribute('data-theme')==='light'){h.removeAttribute('data-theme');localStorage.setItem('fz-theme','dark');}else{h.setAttribute('data-theme','light');localStorage.setItem('fz-theme','light');}}
function toggleNav(btn){var m=document.getElementById('nav-menu');if(!m)return;var o=m.classList.toggle('is-open');btn.setAttribute('aria-expanded',o?'true':'false');}
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

function pillClass(status) {
  return status === 'under-review' ? 'pill pill--review' : 'pill pill--preprint';
}

function renderOutboundCard(paper) {
  const ids = identifierLabels(paper);
  const idHtml = ids.length
    ? `\n          <div class="card__ids">${ids.map(i => `<span class="card__id">${escapeHtml(i)}</span>`).join('')}</div>`
    : '';
  const venueHtml = (paper.status === 'under-review' && paper.journal)
    ? `\n            <span class="tag">${escapeHtml(paper.journal)}</span>`
    : '';
  const subtitleHtml = paper.subtitle
    ? `\n          <p class="card__authors">${escapeHtml(paper.subtitle)}</p>`
    : '';

  return `
        <a href="${canonicalPaperUrl(paper)}" class="card card--paper" target="_blank" rel="noopener">
          <div class="card__meta">
            <span class="${pillClass(paper.status)}">${escapeHtml(statusLabel(paper.status))}</span>${venueHtml}
            <span>${year(paper.date)}</span>
          </div>
          <h3>${escapeHtml(paper.title)}</h3>${subtitleHtml}
          <p class="card__authors">${escapeHtml(paper.authors.join(', '))}</p>${idHtml}
          <span class="card__readout">Read on dissensus.ai &rarr;</span>
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
  <main class="container" style="padding-block: var(--sp-16) var(--sp-24);">
    <a href="/programmes/" class="back-link">&larr; All programmes</a>
    <span class="kicker">Programme ${escapeHtml(prog.index)}</span>
    <h1>${escapeHtml(prog.title)}</h1>
    <hr class="rule">
    <p style="margin-bottom: var(--sp-8);">${escapeHtml(prog.description)}</p>
    <span class="index">${programPapers.length} paper${programPapers.length !== 1 ? 's' : ''} &middot; hosted on dissensus.ai</span>
    <div class="grid" style="margin-top: var(--sp-6);">
${cardsHtml}
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
        <a href="${programmeUrl(key)}" class="card">
          <span class="card__index">Programme ${escapeHtml(prog.index)}</span>
          <h3>${escapeHtml(prog.title)}</h3>
          <p>${escapeHtml(prog.description)}</p>
          <span class="card__count">${count} paper${count !== 1 ? 's' : ''}</span>
        </a>`;
  }

  const bodyContent = `
  <main>
    <header class="container hero">
      <span class="kicker">Research structure</span>
      <h1>Programmes</h1>
      <p>Five interlocking programmes, each applying the consent-friction framework to a different substrate, testing whether the formal machinery generalises. Full papers are published on <a href="${CANON_RESEARCH}" target="_blank" rel="noopener">dissensus.ai</a>.</p>
      <hr class="rule">
    </header>
    <section class="section container">
      <div class="grid">
${cardsHtml}
      </div>
    </section>
  </main>`;

  return wrapPage(headHtml, navHtml, bodyContent, getFooterHtml());
}

// ---------------------------------------------------------------------------
// Scope — what the research area is, its central claim, and what it is not
// ---------------------------------------------------------------------------

// Prose fields in the data files are escaped, then a deliberately tiny inline syntax is
// re-expanded: [text](url) links, *emphasis*, and `code`. Escaping first means content
// can never inject markup — only these three forms survive, and their contents stay escaped.
function renderInline(escaped) {
  return escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g,
      (_, label, href) => `<a href="${href}"${href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function renderParagraphs(text) {
  if (!text) return '';
  return String(text)
    .split(/\n\s*\n/)
    .map(p => `<p>${renderInline(escapeHtml(p.trim()))}</p>`)
    .join('\n        ');
}

function buildScopePage() {
  if (!scopeData) return null;
  const s = scopeData;

  const inList = (s.inScope || []).map(x => `<li>${renderInline(escapeHtml(x))}</li>`).join('\n            ');
  const outList = (s.outOfScope || [])
    .map(x => {
      const claim = typeof x === 'string' ? x : x.claim;
      const why = typeof x === 'string' ? null : x.why;
      return `<li>${renderInline(escapeHtml(claim))}${why ? ` <span style="color:var(--text-dim);opacity:.8;">&mdash; ${renderInline(escapeHtml(why))}</span>` : ''}</li>`;
    })
    .join('\n            ');

  const adjacent = (s.adjacentFields || [])
    .map(f => `
        <article class="adjacent">
          <h3>${escapeHtml(f.field)}</h3>
          <div class="adjacent__row">
            <span class="adjacent__k">What it does</span>
            <span class="adjacent__v">${renderInline(escapeHtml(f.whatItDoes || ''))}</span>
          </div>
          <div class="adjacent__row">
            <span class="adjacent__k">Where we differ</span>
            <span class="adjacent__v">${renderInline(escapeHtml(f.whereWeDiffer || ''))}</span>
          </div>
          <div class="adjacent__row">
            <span class="adjacent__k">Overlap</span>
            <span class="adjacent__v">${renderInline(escapeHtml(f.overlap || ''))}</span>
          </div>
        </article>`)
    .join('');

  const headHtml = getHeadHtml({
    title: 'Scope',
    description: s.metaDescription || 'What adversarial systems and complexity research is, its central claim, what falls inside and outside its scope, and how it differs from adjacent fields.',
    canonicalUrl: `${SITE_URL}/scope`,
  });

  const bodyContent = `
  <main>
    <header class="container hero">
      <span class="kicker">Definition &amp; scope</span>
      <h1>${escapeHtml(s.heading || 'What this research area is')}</h1>
      <hr class="rule">
      <div class="prose" style="max-width:var(--measure);">
        ${renderParagraphs(s.definition)}
      </div>
    </header>

    <section class="section container">
      <span class="index">01 &middot; The claim</span>
      <h2>${escapeHtml(s.thesisHeading || 'Central argument')}</h2>
      <div class="equation">
        <span class="equation__label">The claim, stated so it can fail</span>
        ${escapeHtml(s.thesis || '')}
      </div>
      <div class="prose" style="margin-top:var(--sp-6);">
        ${renderParagraphs(s.thesisElaboration)}
      </div>
      ${s.falsifiers && s.falsifiers.length ? `<h3 style="margin-top:var(--sp-8);">What would refute it</h3>
      <ul class="scope-list scope-list--out">
            ${s.falsifiers.map(f => `<li>${renderInline(escapeHtml(f))}</li>`).join('\n            ')}
      </ul>` : ''}
    </section>

    <section class="section container">
      <span class="index">02 &middot; Boundaries</span>
      <h2>In scope, and not</h2>
      <div class="scope-cols">
        <div>
          <span class="hero-meta__label">Questions we take</span>
          <ul class="scope-list scope-list--in">
            ${inList}
          </ul>
        </div>
        <div>
          <span class="hero-meta__label">Questions we do not</span>
          <ul class="scope-list scope-list--out">
            ${outList}
          </ul>
        </div>
      </div>
    </section>

    <section class="section container">
      <span class="index">03 &middot; Evidence</span>
      <h2>${escapeHtml(s.methodHeading || 'What counts as evidence here')}</h2>
      <div class="prose" style="max-width:var(--measure);">
        ${renderParagraphs(s.methodology)}
      </div>
    </section>

    <section class="section container">
      <span class="index">04 &middot; Neighbours</span>
      <h2>How this differs from adjacent fields</h2>
      <p>${escapeHtml(s.adjacentIntro || '')}</p>
      <div style="margin-top:var(--sp-8);">
${adjacent}
      </div>
    </section>

    <section class="section container">
      <span class="index">05 &middot; Disagree</span>
      <h2>Argue with this</h2>
      <p>The claim above is meant to be attackable. If you think the decomposition is wrong, the framework is redundant with something that already exists, or a result does not hold, we publish substantive critiques alongside the position they attack.</p>
      <p style="margin-top:var(--sp-4);"><a href="/submit#critique">Submit a critique &rarr;</a></p>
    </section>
  </main>`;

  return wrapPage(headHtml, getNavHtml('scope'), bodyContent, getFooterHtml());
}

// ---------------------------------------------------------------------------
// Library — annotated external work (other people's research)
// ---------------------------------------------------------------------------

function renderLibraryEntry(e) {
  const ids = [];
  if (e.identifier) ids.push(escapeHtml(e.identifier));
  if (e.citationCount) ids.push(`${escapeHtml(e.citationCount)} citations`);
  const idHtml = ids.length
    ? `\n          <div class="entry__ids">${ids.map(i => `<span>${i}</span>`).join('')}</div>`
    : '';

  return `
        <article class="entry" data-topic="${escapeHtml(e.topic || 'other')}">
          <div class="entry__meta">
            <span>${escapeHtml(e.year || '')}</span>
            <span>&middot;</span>
            <span>${escapeHtml(e.venue || '')}</span>
            ${e.topicLabel ? `<span class="tag">${escapeHtml(e.topicLabel)}</span>` : ''}
          </div>
          <h3 class="entry__title"><a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${escapeHtml(e.title)}</a></h3>
          <p class="entry__authors">${escapeHtml(e.authors || '')}</p>
          <div class="entry__note">${renderInline(escapeHtml(e.note || ''))}</div>${idHtml}
        </article>`;
}

function buildLibraryPage() {
  if (!libraryData) return null;
  const topics = libraryData.topics || {};
  const entries = libraryData.entries || [];

  // Group by topic, preserving the declared topic order.
  const order = Object.keys(topics).filter(t => entries.some(e => e.topic === t));
  const sectionsHtml = order
    .map((t, i) => {
      const items = entries.filter(e => e.topic === t);
      const meta = topics[t] || {};
      return `
    <section class="section container" id="${escapeHtml(t)}">
      <span class="index">${String(i + 1).padStart(2, '0')} &middot; ${escapeHtml(meta.label || t)}</span>
      <h2>${escapeHtml(meta.label || t)}</h2>
      ${meta.blurb ? `<p>${escapeHtml(meta.blurb)}</p>` : ''}
      <div style="margin-top:var(--sp-6);">
${items.map(renderLibraryEntry).join('')}
      </div>
    </section>`;
    })
    .join('');

  const headHtml = getHeadHtml({
    title: 'Library',
    description: 'Annotated external research relevant to adversarial systems and complexity — other people\'s work, with notes on why it matters here.',
    canonicalUrl: `${SITE_URL}/library/`,
  });

  const bodyContent = `
  <main>
    <header class="container hero">
      <span class="kicker">Reading</span>
      <h1>Library</h1>
      <hr class="rule">
      <p>Other people's work, annotated. Everything here is external research we think matters to anyone studying friction and adversarial dynamics in multi-agent systems. The note under each entry says why &mdash; an unannotated list would be no use to anyone.</p>
      <p style="margin-top:var(--sp-4);">Inclusion is not endorsement, and the selection is a working bibliography rather than a survey. If something obvious is missing, <a href="/submit#recommend">tell us</a>.</p>
      <div class="hero-meta">
        <div class="hero-meta__item">
          <span class="hero-meta__label">Entries</span>
          <span class="hero-meta__value">${entries.length}</span>
        </div>
        <div class="hero-meta__item">
          <span class="hero-meta__label">Topics</span>
          <span class="hero-meta__value">${order.length}</span>
        </div>
        <div class="hero-meta__item">
          <span class="hero-meta__label">Our own work</span>
          <span class="hero-meta__value"><a href="${CANON_RESEARCH}" target="_blank" rel="noopener">dissensus.ai &rarr;</a></span>
        </div>
      </div>
      <div class="chips">
        ${order.map(t => `<a class="chip" href="#${escapeHtml(t)}">${escapeHtml((topics[t] || {}).label || t)}</a>`).join('\n        ')}
      </div>
    </header>
${sectionsHtml}
  </main>`;

  return wrapPage(headHtml, getNavHtml('library'), bodyContent, getFooterHtml());
}

// ---------------------------------------------------------------------------
// Notes — the lab's informal writeups and reference material
// ---------------------------------------------------------------------------

function buildNotesIndexPage() {
  if (!notesData) return null;
  const notes = notesData.notes || [];

  const cards = notes
    .map(n => `
        <article class="note">
          <span class="note__kind">${escapeHtml(n.kind || 'Note')}</span>
          <h3><a href="/notes/${escapeHtml(n.id)}">${escapeHtml(n.title)}</a></h3>
          <p>${escapeHtml(n.summary || '')}</p>
          ${(n.caveats || []).length ? `<ul class="note__caveats">
            ${(n.caveats || []).slice(0, 2).map(c => `<li>${escapeHtml(c)}</li>`).join('\n            ')}
          </ul>` : ''}
          <div class="note__foot"><a href="/notes/${escapeHtml(n.id)}">Read &rarr;</a></div>
        </article>`)
    .join('');

  const headHtml = getHeadHtml({
    title: 'Notes',
    description: 'Working notes, reference material, and writeups from the initiative — published because someone else might find them useful, not as portfolio claims.',
    canonicalUrl: `${SITE_URL}/notes/`,
  });

  const bodyContent = `
  <main>
    <header class="container hero">
      <span class="kicker">Working material</span>
      <h1>Notes</h1>
      <hr class="rule">
      <p>Material that is not a paper. Some of it is speculative, some is a byproduct of work published elsewhere, some is reference material we needed and could not find. It is here because someone else might want it, not because it is finished.</p>
      <p style="margin-top:var(--sp-4);">Each note states plainly what it is and what it is not. Peer-reviewed work lives on <a href="${CANON_RESEARCH}" target="_blank" rel="noopener">dissensus.ai</a>.</p>
    </header>
    <section class="section container">
      <div class="note-list">
${cards}
      </div>
    </section>
  </main>`;

  return wrapPage(headHtml, getNavHtml('notes'), bodyContent, getFooterHtml());
}

function buildNotePage(n) {
  const bodyHtml = (n.sections || [])
    .map(sec => `
      <h3>${escapeHtml(sec.heading)}</h3>
      ${renderParagraphs(sec.body)}`)
    .join('\n');

  const claims = (n.keyClaims || []).length
    ? `
    <section class="section container">
      <span class="index">02 &middot; Claims</span>
      <h2>What it argues</h2>
      <ul class="scope-list scope-list--in">
        ${n.keyClaims.map(c => `<li>${renderInline(escapeHtml(c))}</li>`).join('\n        ')}
      </ul>
    </section>`
    : '';

  const caveats = (n.caveats || []).length
    ? `
    <section class="section container">
      <span class="index">03 &middot; Status</span>
      <h2>What this is not</h2>
      <ul class="standards">
        ${n.caveats.map(c => `<li>${renderInline(escapeHtml(c))}</li>`).join('\n        ')}
      </ul>
    </section>`
    : '';

  const ids = (n.identifiers || []).length
    ? `
    <section class="section container">
      <span class="index">04 &middot; Where to find it</span>
      <h2>Identifiers</h2>
      <div class="entry__ids" style="margin-top:var(--sp-4);">
        ${n.identifiers.map(i => (i.url
          ? `<a href="${escapeHtml(i.url)}" target="_blank" rel="noopener">${escapeHtml(i.label)}</a>`
          : `<span>${escapeHtml(i.label || i)}</span>`)).join('\n        ')}
      </div>
    </section>`
    : '';

  const headHtml = getHeadHtml({
    title: n.title,
    description: n.summary || '',
    canonicalUrl: `${SITE_URL}/notes/${n.id}`,
    ogType: 'article',
  });

  const bodyContent = `
  <main>
    <header class="container hero">
      <a href="/notes/" class="back-link">&larr; All notes</a>
      <span class="kicker">${escapeHtml(n.kind || 'Note')}</span>
      <h1>${escapeHtml(n.title)}</h1>
      <hr class="rule">
      <p>${escapeHtml(n.summary || '')}</p>
    </header>
    <section class="section container">
      <span class="index">01 &middot; Why it might be useful</span>
      <h2>Who this is for</h2>
      <div class="prose" style="max-width:var(--measure);">
        ${renderParagraphs(n.whyUseful)}
      </div>
      ${bodyHtml ? `<div class="prose" style="max-width:var(--measure);margin-top:var(--sp-8);">${bodyHtml}</div>` : ''}
    </section>${claims}${caveats}${ids}
    <section class="section container">
      <span class="index">05 &middot; Respond</span>
      <h2>Think this is wrong?</h2>
      <p>Notes are the part of the programme most likely to contain errors, because nothing here has been through review. If you can show a step does not follow, <a href="/submit#critique">say so</a> and we will publish it.</p>
    </section>
  </main>`;

  return wrapPage(headHtml, getNavHtml('notes'), bodyContent, getFooterHtml());
}

// ---------------------------------------------------------------------------
// Submit — three participation surfaces, form-backed when configured
// ---------------------------------------------------------------------------

function renderSubmitForm(surface) {
  const subject = `ASCRI submission — ${surface.title}`;
  if (!SUBMISSIONS_FORM_ID) {
    return `      <div class="btn-row" style="margin-top:var(--sp-6);">
        <a class="btn" href="mailto:${SUBMISSIONS_EMAIL}?subject=${encodeURIComponent(subject)}">Email ${SUBMISSIONS_EMAIL}</a>
      </div>
      <p class="form__hint" style="margin-top:var(--sp-3);">Include: ${escapeHtml(surface.emailChecklist || 'a link, and a sentence on why it belongs here.')}</p>`;
  }
  const fields = (surface.fields || [])
    .map(f => {
      const req = f.required ? ' required' : '';
      if (f.type === 'textarea') {
        return `        <label>${escapeHtml(f.label)}
          <textarea name="${escapeHtml(f.name)}"${req} placeholder="${escapeHtml(f.placeholder || '')}"></textarea>
        </label>`;
      }
      return `        <label>${escapeHtml(f.label)}
          <input type="${escapeHtml(f.type || 'text')}" name="${escapeHtml(f.name)}"${req} placeholder="${escapeHtml(f.placeholder || '')}">
        </label>`;
    })
    .join('\n');

  return `      <form class="form" action="https://formspree.io/f/${SUBMISSIONS_FORM_ID}" method="POST">
        <input type="hidden" name="_subject" value="${escapeHtml(subject)}">
        <input type="hidden" name="submission_type" value="${escapeHtml(surface.id)}">
        <div class="form__row">
          <label>Your name
            <input type="text" name="name" required>
          </label>
          <label>Email
            <input type="email" name="email" required>
          </label>
        </div>
        <label>Affiliation <span class="form__hint">(optional — independent is fine)</span>
          <input type="text" name="affiliation">
        </label>
${fields}
        <button type="submit" class="btn">Send</button>
      </form>`;
}

function buildSubmitPage() {
  if (!submitData) return null;
  const surfaces = submitData.surfaces || [];

  const sectionsHtml = surfaces
    .map((s, i) => `
    <section class="section container" id="${escapeHtml(s.id)}">
      <span class="index">${String(i + 1).padStart(2, '0')} &middot; ${escapeHtml(s.kicker || s.title)}</span>
      <h2>${escapeHtml(s.title)}</h2>
      <div class="prose" style="max-width:var(--measure);">
        ${renderParagraphs(s.body)}
      </div>
      ${(s.expectations || []).length ? `<ul class="scope-list scope-list--in" style="margin-top:var(--sp-6);">
        ${s.expectations.map(e => `<li>${renderInline(escapeHtml(e))}</li>`).join('\n        ')}
      </ul>` : ''}
${renderSubmitForm(s)}
    </section>`)
    .join('');

  const standards = (submitData.standards || []).length
    ? `
    <section class="section container" id="standards">
      <span class="index">${String(surfaces.length + 1).padStart(2, '0')} &middot; Standards</span>
      <h2>Editorial standards</h2>
      <ul class="standards">
        ${submitData.standards.map(s => `<li>${renderInline(escapeHtml(s))}</li>`).join('\n        ')}
      </ul>
      ${submitData.capacityNote ? `<div class="caveat">
        <span class="caveat__label">Capacity</span>
        ${renderParagraphs(submitData.capacityNote)}
      </div>` : ''}
    </section>`
    : '';

  const headHtml = getHeadHtml({
    title: 'Submit',
    description: 'Recommend work for the library, offer a piece for publication, or attack a position the initiative holds.',
    canonicalUrl: `${SITE_URL}/submit`,
  });

  const bodyContent = `
  <main>
    <header class="container hero">
      <span class="kicker">Participate</span>
      <h1>${escapeHtml(submitData.heading || 'Submit')}</h1>
      <hr class="rule">
      <div class="prose" style="max-width:var(--measure);">
        ${renderParagraphs(submitData.intro)}
      </div>
    </header>
${sectionsHtml}${standards}
  </main>`;

  return wrapPage(headHtml, getNavHtml('submit'), bodyContent, getFooterHtml());
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
  if (scopeData) staticPages.push({ loc: '/scope', priority: '0.9', changefreq: 'monthly' });
  if (libraryData) staticPages.push({ loc: '/library/', priority: '0.8', changefreq: 'weekly' });
  if (notesData) staticPages.push({ loc: '/notes/', priority: '0.7', changefreq: 'monthly' });
  if (submitData) staticPages.push({ loc: '/submit', priority: '0.6', changefreq: 'monthly' });

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

  for (const n of (notesData && notesData.notes) || []) {
    urls += `  <url>
    <loc>${SITE_URL}/notes/${n.id}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
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

  // --- Scope ---
  if (scopeData) {
    fs.writeFileSync(path.join(PUBLIC, 'scope.html'), buildScopePage(), 'utf-8');
    console.log('  Generated scope -> public/scope.html');
  } else {
    console.log('  (scope.json absent — /scope skipped)');
  }

  // --- Library (annotated external work) ---
  if (libraryData) {
    const libDir = path.join(PUBLIC, 'library');
    ensureDir(libDir);
    fs.writeFileSync(path.join(libDir, 'index.html'), buildLibraryPage(), 'utf-8');
    console.log(`  Generated library -> public/library/index.html (${(libraryData.entries || []).length} entries)`);
  } else {
    console.log('  (library.json absent — /library skipped)');
  }

  // --- Notes ---
  if (notesData) {
    const notesDir = path.join(PUBLIC, 'notes');
    ensureDir(notesDir);
    fs.writeFileSync(path.join(notesDir, 'index.html'), buildNotesIndexPage(), 'utf-8');
    const wanted = new Set(['index.html']);
    for (const n of notesData.notes || []) {
      fs.writeFileSync(path.join(notesDir, `${n.id}.html`), buildNotePage(n), 'utf-8');
      wanted.add(`${n.id}.html`);
    }
    // Prune pages for notes that have been removed from notes.json. Without this a
    // withdrawn note keeps its page and deploys, unlinked but publicly reachable.
    const orphans = fs.readdirSync(notesDir).filter(f => f.endsWith('.html') && !wanted.has(f));
    for (const f of orphans) fs.unlinkSync(path.join(notesDir, f));
    console.log(`  Generated notes -> public/notes/ (${(notesData.notes || []).length} notes`
      + `${orphans.length ? `, pruned ${orphans.length}: ${orphans.join(', ')}` : ''})`);
  } else {
    console.log('  (notes.json absent — /notes skipped)');
  }

  // --- Submit ---
  if (submitData) {
    fs.writeFileSync(path.join(PUBLIC, 'submit.html'), buildSubmitPage(), 'utf-8');
    console.log(`  Generated submit -> public/submit.html (form ${SUBMISSIONS_FORM_ID ? 'ACTIVE' : 'not configured — email route rendered'})`);
  } else {
    console.log('  (submit.json absent — /submit skipped)');
  }

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
