#!/usr/bin/env node
// build.js — ASCRI static site generator
// Zero npm dependencies. Uses only fs and path.
// Reads papers.json, generates paper pages, programme pages, sitemap, RSS feed.

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SITE_URL = 'https://systems.ac';
const SITE_TITLE = 'ASCRI';
const SITE_DESCRIPTION = 'Adversarial Systems & Complexity Research Initiative';
const PUBLISHER = 'ASCRI';
const OPERATOR = 'Dissensus AI';
const PDF_BASE = 'https://farzulla.org/papers';

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'papers.json');

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
const { papers, tags, statuses, programs, categories } = data;

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

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatDateISO(dateStr) {
  return dateStr; // already YYYY-MM-DD
}

function formatDateSlash(dateStr) {
  // YYYY-MM-DD -> YYYY/MM/DD (for Highwire Press)
  return dateStr.replace(/-/g, '/');
}

function formatDateRFC822(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toUTCString();
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

function pdfUrl(paper) {
  if (!paper.pdf) return null;
  return `${PDF_BASE}/${paper.pdf}`;
}

function doiUrl(paper) {
  if (!paper.doi) return null;
  return `https://doi.org/${paper.doi}`;
}

function paperUrl(paper) {
  return `/papers/${paper.id}`;
}

function programmeUrl(programKey) {
  return `/programmes/${programKey}`;
}

function truncateAbstract(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen).replace(/\s+\S*$/, '') + '...';
}

// Sort papers by date descending
function sortByDateDesc(a, b) {
  return new Date(b.date) - new Date(a.date);
}

// Group papers by programme
function groupByProgramme(paperList) {
  const grouped = {};
  // Use programme order from programs object
  const programOrder = Object.keys(programs);
  for (const key of programOrder) {
    grouped[key] = [];
  }
  for (const paper of paperList) {
    const key = paper.program;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(paper);
  }
  // Sort within each group
  for (const key of Object.keys(grouped)) {
    grouped[key].sort(sortByDateDesc);
  }
  return grouped;
}

// Count papers per programme
function paperCountByProgramme() {
  const counts = {};
  for (const key of Object.keys(programs)) {
    counts[key] = 0;
  }
  for (const paper of papers) {
    if (counts[paper.program] !== undefined) {
      counts[paper.program]++;
    }
  }
  return counts;
}

// Generate BibTeX key: LastnameYear
function bibtexKey(paper) {
  const firstAuthor = paper.authors[0] || 'Unknown';
  const lastName = firstAuthor.split(' ').pop();
  const year = paper.date.substring(0, 4);
  const slug = paper.id.replace(/-/g, '_');
  return `${lastName.toLowerCase()}${year}_${slug}`;
}

// Generate BibTeX entry
function bibtexEntry(paper) {
  const key = bibtexKey(paper);
  const year = paper.date.substring(0, 4);
  const authors = paper.authors.join(' and ');
  let bib = `@article{${key},\n`;
  bib += `  title     = {${paper.title}},\n`;
  bib += `  author    = {${authors}},\n`;
  bib += `  year      = {${year}},\n`;
  bib += `  publisher = {${PUBLISHER}},\n`;
  if (paper.doi) {
    bib += `  doi       = {${paper.doi}},\n`;
  }
  if (paper.pdf) {
    bib += `  url       = {${pdfUrl(paper)}},\n`;
  }
  bib += `  note      = {${statusLabel(paper.status)}}\n`;
  bib += `}`;
  return bib;
}

// Generate suggested citation string
function suggestedCitation(paper) {
  const year = paper.date.substring(0, 4);
  const authors = paper.authors.join(', ');
  let cite = `${authors} (${year}). "${paper.title}."`;
  if (paper.subtitle) {
    cite += ` ${paper.subtitle}.`;
  }
  cite += ` ${PUBLISHER}.`;
  if (paper.doi) {
    cite += ` doi:${paper.doi}`;
  }
  return cite;
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

  let head = `<!DOCTYPE html>
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
  <link rel="stylesheet" href="/css/ascri.css">

  <!-- Canonical -->
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">

  <!-- RSS -->
  <link rel="alternate" type="application/rss+xml" title="${SITE_TITLE} Papers" href="${SITE_URL}/feed.xml">

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
`;

  // Scholar metadata (paper pages only)
  if (meta.paper) {
    const paper = meta.paper;
    head += `
  <!-- Highwire Press / Google Scholar -->
  <meta name="citation_title" content="${escapeHtml(paper.title)}">
`;
    for (const author of paper.authors) {
      head += `  <meta name="citation_author" content="${escapeHtml(author)}">\n`;
    }
    head += `  <meta name="citation_publication_date" content="${formatDateSlash(paper.date)}">
  <meta name="citation_publisher" content="${PUBLISHER}">
  <meta name="citation_abstract_html_url" content="${SITE_URL}/papers/${paper.id}">
`;
    if (paper.pdf) {
      head += `  <meta name="citation_pdf_url" content="${escapeHtml(pdfUrl(paper))}">\n`;
    }
    if (paper.doi) {
      head += `  <meta name="citation_doi" content="${escapeHtml(paper.doi)}">\n`;
    }
    if (paper.journal) {
      head += `  <meta name="citation_journal_title" content="${escapeHtml(paper.journal)}">\n`;
    }

    // Dublin Core
    head += `
  <!-- Dublin Core -->
  <meta name="DC.title" content="${escapeHtml(paper.title)}">
  <meta name="DC.creator" content="${escapeHtml(paper.authors.join('; '))}">
  <meta name="DC.date" content="${formatDateISO(paper.date)}">
  <meta name="DC.publisher" content="${PUBLISHER}">
  <meta name="DC.type" content="Text">
  <meta name="DC.format" content="text/html">
  <meta name="DC.language" content="en">
`;
    if (paper.doi) {
      head += `  <meta name="DC.identifier" content="doi:${escapeHtml(paper.doi)}">\n`;
    }
    if (paper.abstract) {
      head += `  <meta name="DC.description" content="${escapeHtml(truncateAbstract(paper.abstract, 300))}">\n`;
    }

    // JSON-LD ScholarlyArticle
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'ScholarlyArticle',
      'name': paper.title,
      'headline': paper.title,
      'author': paper.authors.map(a => ({ '@type': 'Person', 'name': a })),
      'datePublished': paper.date,
      'publisher': {
        '@type': 'Organization',
        'name': PUBLISHER,
      },
      'url': `${SITE_URL}/papers/${paper.id}`,
      'abstract': paper.abstract || '',
    };
    if (paper.doi) {
      jsonLd['identifier'] = {
        '@type': 'PropertyValue',
        'propertyID': 'doi',
        'value': paper.doi,
      };
      jsonLd['sameAs'] = `https://doi.org/${paper.doi}`;
    }
    if (paper.pdf) {
      jsonLd['encoding'] = {
        '@type': 'MediaObject',
        'contentUrl': pdfUrl(paper),
        'encodingFormat': 'application/pdf',
      };
    }

    head += `
  <!-- JSON-LD -->
  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>
`;
  }

  head += `</head>`;
  return head;
}

function getNavHtml(activePage) {
  const links = [
    { href: '/framework', label: 'Framework', key: 'framework' },
    { href: '/programmes/', label: 'Programmes', key: 'programmes' },
    { href: '/papers/', label: 'Papers', key: 'papers' },
    { href: '/people', label: 'People', key: 'people' },
    { href: '/about', label: 'About', key: 'about' },
  ];

  const linksHtml = links
    .map(l => {
      const activeClass = l.key === activePage ? ' site-nav__link--active' : '';
      return `<a href="${l.href}" class="site-nav__link${activeClass}">${l.label}</a>`;
    })
    .join('\n        ');

  return `<nav class="site-nav" role="navigation" aria-label="Main navigation">
    <div class="site-nav__inner">
      <a href="/" class="site-nav__brand">${SITE_TITLE}</a>
      <button class="site-nav__toggle" aria-label="Toggle menu" onclick="document.querySelector('.site-nav__links').classList.toggle('is-open')">
        <span></span><span></span><span></span>
      </button>
      <div class="site-nav__links">
        ${linksHtml}
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
          <div class="site-footer__copy">&copy; 2026 ${PUBLISHER} &middot; Operated by ${OPERATOR}</div>
        </div>
        <div class="site-footer__links">
          <a href="/framework">Framework</a>
          <a href="/programmes/">Programmes</a>
          <a href="/papers/">Papers</a>
          <a href="/people">People</a>
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
          <a href="/feed.xml">RSS</a>
        </div>
      </div>
    </div>
  </footer>`;
}

function wrapPage(headHtml, navHtml, bodyContent, footerHtml) {
  return `${headHtml}
<body class="has-nav">
  ${navHtml}
  ${bodyContent}
  ${footerHtml}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Page generators
// ---------------------------------------------------------------------------

function buildPaperPage(paper) {
  const headHtml = getHeadHtml({
    title: paper.title,
    description: truncateAbstract(paper.abstract, 200),
    canonicalUrl: `${SITE_URL}/papers/${paper.id}`,
    ogType: 'article',
    paper: paper,
  });

  const navHtml = getNavHtml('papers');

  // Meta row: date, status, programme
  const metaHtml = `
      <div class="paper-detail__meta">
        <span class="paper-detail__date">${formatDate(paper.date)}</span>
        <span class="status ${statusClass(paper.status)}">${escapeHtml(statusLabel(paper.status))}</span>
        <a href="${programmeUrl(paper.program)}" class="paper-detail__programme">Programme ${escapeHtml(programIndex(paper.program))}: ${escapeHtml(programTitle(paper.program))}</a>
      </div>`;

  // Title block
  let titleBlock = `<h1 class="paper-detail__title">${escapeHtml(paper.title)}</h1>`;
  if (paper.subtitle) {
    titleBlock += `\n      <p class="paper-detail__subtitle">${escapeHtml(paper.subtitle)}</p>`;
  }
  titleBlock += `\n      <p class="paper-detail__authors">${escapeHtml(paper.authors.join(', '))}</p>`;

  // Journal info (if under peer review)
  if (paper.journal) {
    titleBlock += `\n      <p style="font-family: var(--font-mono); font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.5rem;">Submitted to: ${escapeHtml(paper.journal)}</p>`;
  }

  // Action buttons
  const actions = [];
  if (paper.pdf) {
    actions.push(`<a href="${escapeHtml(pdfUrl(paper))}" class="btn btn--primary" target="_blank" rel="noopener">Download PDF</a>`);
  }
  if (paper.doi) {
    actions.push(`<a href="${escapeHtml(doiUrl(paper))}" class="btn" target="_blank" rel="noopener">DOI: ${escapeHtml(paper.doi)}</a>`);
  }
  if (paper.github) {
    actions.push(`<a href="${escapeHtml(paper.github)}" class="btn" target="_blank" rel="noopener">GitHub</a>`);
  }
  if (paper.dashboard) {
    actions.push(`<a href="${escapeHtml(paper.dashboard)}" class="btn" target="_blank" rel="noopener">Dashboard</a>`);
  }

  const actionsHtml = actions.length
    ? `\n      <div class="paper-detail__actions">\n        ${actions.join('\n        ')}\n      </div>`
    : '';

  // Abstract
  const abstractHtml = paper.abstract
    ? `
      <div class="paper-detail__section">
        <h2 class="paper-detail__section-title">Abstract</h2>
        <p class="paper-detail__abstract">${escapeHtml(paper.abstract)}</p>
      </div>`
    : '';

  // Citation
  const citationHtml = `
      <div class="paper-detail__section">
        <h2 class="paper-detail__section-title">Suggested Citation</h2>
        <div class="citation-block">
          ${escapeHtml(suggestedCitation(paper))}
        </div>
      </div>`;

  // BibTeX
  const bibtex = bibtexEntry(paper);
  const bibtexHtml = `
      <div class="paper-detail__section">
        <h2 class="paper-detail__section-title">BibTeX</h2>
        <div style="position: relative;">
          <pre class="citation-block" id="bibtex-${paper.id}" style="white-space: pre-wrap; font-size: 0.75rem;">${escapeHtml(bibtex)}</pre>
          <button class="btn btn--small" style="position: absolute; top: 0.5rem; right: 0.5rem;" onclick="navigator.clipboard.writeText(document.getElementById('bibtex-${paper.id}').textContent).then(() => { this.textContent = 'Copied'; setTimeout(() => { this.textContent = 'Copy'; }, 2000); })">Copy</button>
        </div>
      </div>`;

  // Tags
  let tagsHtml = '';
  if (paper.tags && paper.tags.length) {
    const tagPills = paper.tags
      .map(t => `<span class="tag">${escapeHtml(tags[t] || t)}</span>`)
      .join('\n          ');
    tagsHtml = `
      <div class="paper-detail__section">
        <h2 class="paper-detail__section-title">Tags</h2>
        <div class="tag-list">
          ${tagPills}
        </div>
      </div>`;
  }

  const bodyContent = `
  <main class="paper-detail">
    <div class="container">
      <a href="/papers/" class="paper-detail__back">&larr; All Papers</a>

      <div class="paper-detail__header">
${metaHtml}
${titleBlock}
      </div>
${actionsHtml}
${abstractHtml}
${citationHtml}
${bibtexHtml}
${tagsHtml}
    </div>
  </main>`;

  return wrapPage(headHtml, navHtml, bodyContent, getFooterHtml());
}

function buildPapersIndexPage() {
  const headHtml = getHeadHtml({
    title: 'Papers',
    description: 'Research papers from the Adversarial Systems & Complexity Research Initiative.',
    canonicalUrl: `${SITE_URL}/papers/`,
  });

  const navHtml = getNavHtml('papers');

  const grouped = groupByProgramme(papers);
  let sectionsHtml = '';

  for (const [programKey, programPapers] of Object.entries(grouped)) {
    if (programPapers.length === 0) continue;

    const prog = programs[programKey];
    if (!prog) continue;

    let cardsHtml = '';
    for (const paper of programPapers) {
      const subtitleHtml = paper.subtitle
        ? `\n          <p class="paper-card__subtitle">${escapeHtml(paper.subtitle)}</p>`
        : '';
      cardsHtml += `
        <a href="${paperUrl(paper)}" class="paper-card">
          <div class="paper-card__meta">
            <span class="paper-card__date">${formatDate(paper.date)}</span>
            <span class="status ${statusClass(paper.status)}">${escapeHtml(statusLabel(paper.status))}</span>
          </div>
          <h3 class="paper-card__title">${escapeHtml(paper.title)}</h3>${subtitleHtml}
          <p class="paper-card__authors">${escapeHtml(paper.authors.join(', '))}</p>
        </a>`;
    }

    sectionsHtml += `
      <section>
        <span class="section-label">Programme ${escapeHtml(prog.index)}</span>
        <h2 class="section-title">${escapeHtml(prog.title)}</h2>
        <div class="featured-papers">
${cardsHtml}
        </div>
      </section>`;
  }

  const bodyContent = `
  <main>
    <div class="container">
      <section class="hero" style="border-bottom: none; padding-bottom: 2rem;">
        <span class="hero__label">Research Output</span>
        <h1 class="hero__title">Papers</h1>
        <p class="hero__subtitle">${papers.length} papers across ${Object.keys(programs).length} research programmes.</p>
      </section>
${sectionsHtml}
    </div>
  </main>`;

  return wrapPage(headHtml, navHtml, bodyContent, getFooterHtml());
}

function buildProgrammePage(programKey) {
  const prog = programs[programKey];
  if (!prog) return null;

  const programPapers = papers
    .filter(p => p.program === programKey)
    .sort(sortByDateDesc);

  const headHtml = getHeadHtml({
    title: `Programme ${prog.index}: ${prog.title}`,
    description: prog.description,
    canonicalUrl: `${SITE_URL}/programmes/${programKey}`,
  });

  const navHtml = getNavHtml('programmes');

  let cardsHtml = '';
  for (const paper of programPapers) {
    const subtitleHtml = paper.subtitle
      ? `\n          <p class="paper-card__subtitle">${escapeHtml(paper.subtitle)}</p>`
      : '';
    cardsHtml += `
        <a href="${paperUrl(paper)}" class="paper-card">
          <div class="paper-card__meta">
            <span class="paper-card__date">${formatDate(paper.date)}</span>
            <span class="status ${statusClass(paper.status)}">${escapeHtml(statusLabel(paper.status))}</span>
          </div>
          <h3 class="paper-card__title">${escapeHtml(paper.title)}</h3>${subtitleHtml}
          <p class="paper-card__authors">${escapeHtml(paper.authors.join(', '))}</p>
        </a>`;
  }

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
        <span class="section-label">${programPapers.length} paper${programPapers.length !== 1 ? 's' : ''}</span>
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
    description: 'Research programmes of the Adversarial Systems & Complexity Research Initiative.',
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
        <p class="hero__subtitle">Six interlocking research programmes investigating friction, consent, and stability across adversarial systems.</p>
      </section>

      <div class="programme-grid">
${cardsHtml}
      </div>
    </div>
  </main>`;

  return wrapPage(headHtml, navHtml, bodyContent, getFooterHtml());
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

function buildSitemap() {
  const staticPages = [
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/framework', priority: '0.9', changefreq: 'monthly' },
    { loc: '/papers/', priority: '0.9', changefreq: 'weekly' },
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

  // Paper pages
  for (const paper of papers) {
    urls += `  <url>
    <loc>${SITE_URL}/papers/${paper.id}</loc>
    <lastmod>${paper.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>\n`;
  }

  // Programme pages
  for (const key of Object.keys(programs)) {
    urls += `  <url>
    <loc>${SITE_URL}/programmes/${key}</loc>
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
// RSS Feed
// ---------------------------------------------------------------------------

function buildRSSFeed() {
  const sortedPapers = [...papers].sort(sortByDateDesc);

  let items = '';
  for (const paper of sortedPapers) {
    const paperLink = `${SITE_URL}/papers/${paper.id}`;
    const abstract = paper.abstract ? escapeXml(paper.abstract) : '';

    let descriptionParts = [];
    if (paper.subtitle) {
      descriptionParts.push(escapeXml(paper.subtitle));
    }
    if (paper.authors.length) {
      descriptionParts.push(`By ${escapeXml(paper.authors.join(', '))}`);
    }
    if (abstract) {
      descriptionParts.push(abstract);
    }

    const description = descriptionParts.join(' &mdash; ');

    items += `    <item>
      <title>${escapeXml(paper.title)}</title>
      <link>${paperLink}</link>
      <guid isPermaLink="true">${paperLink}</guid>
      <pubDate>${formatDateRFC822(paper.date)}</pubDate>
      <description>${description}</description>`;

    if (paper.doi) {
      items += `\n      <dc:identifier>doi:${escapeXml(paper.doi)}</dc:identifier>`;
    }

    // Tags as categories
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
    <title>${escapeXml(SITE_TITLE)} — Papers</title>
    <link>${SITE_URL}</link>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>en</language>
    <managingEditor>research@systems.ac (${PUBLISHER})</managingEditor>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
${items}  </channel>
</rss>`;
}

// ---------------------------------------------------------------------------
// Main build
// ---------------------------------------------------------------------------

function build() {
  const start = Date.now();

  console.log(`Building ${SITE_TITLE} static site...`);
  console.log(`  Papers: ${papers.length}`);
  console.log(`  Programmes: ${Object.keys(programs).length}`);

  // Ensure output directories
  const papersDir = path.join(PUBLIC, 'papers');
  const programmesDir = path.join(PUBLIC, 'programmes');
  ensureDir(papersDir);
  ensureDir(programmesDir);

  // --- Individual paper pages ---
  let paperCount = 0;
  for (const paper of papers) {
    const html = buildPaperPage(paper);
    const outPath = path.join(papersDir, `${paper.id}.html`);
    fs.writeFileSync(outPath, html, 'utf-8');
    paperCount++;
  }
  console.log(`  Generated ${paperCount} paper pages -> public/papers/`);

  // --- Papers index ---
  const papersIndexHtml = buildPapersIndexPage();
  fs.writeFileSync(path.join(papersDir, 'index.html'), papersIndexHtml, 'utf-8');
  console.log(`  Generated papers index -> public/papers/index.html`);

  // --- Individual programme pages ---
  let progCount = 0;
  for (const key of Object.keys(programs)) {
    const html = buildProgrammePage(key);
    if (html) {
      const outPath = path.join(programmesDir, `${key}.html`);
      fs.writeFileSync(outPath, html, 'utf-8');
      progCount++;
    }
  }
  console.log(`  Generated ${progCount} programme pages -> public/programmes/`);

  // --- Programmes index ---
  const programmesIndexHtml = buildProgrammesIndexPage();
  fs.writeFileSync(path.join(programmesDir, 'index.html'), programmesIndexHtml, 'utf-8');
  console.log(`  Generated programmes index -> public/programmes/index.html`);

  // --- Sitemap ---
  const sitemap = buildSitemap();
  fs.writeFileSync(path.join(PUBLIC, 'sitemap.xml'), sitemap, 'utf-8');
  console.log(`  Generated sitemap -> public/sitemap.xml`);

  // --- RSS Feed ---
  const feed = buildRSSFeed();
  fs.writeFileSync(path.join(PUBLIC, 'feed.xml'), feed, 'utf-8');
  console.log(`  Generated RSS feed -> public/feed.xml`);

  const elapsed = Date.now() - start;
  console.log(`\nDone in ${elapsed}ms.`);
}

build();
