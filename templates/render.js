// render.js
// Fills templates/post.html with one post's data and returns the finished HTML.
// The same code runs locally (node templates/render.js templates/sample-post.json)
// and inside an n8n Code node, so the preview and the published page match.
//
// Slots in the template look like %%name%%. Every text value is HTML-escaped;
// slots ending in _html, plus json_ld and image_meta, are built here as markup.
'use strict';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LIMITS = { title: 60, description: 155 };

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Blank lines separate paragraphs; single line breaks become <br>.
function paragraphs(text, cls) {
  const attr = cls ? ` class="${cls}"` : '';
  return String(text).trim().split(/\n\s*\n/)
    .map((p) => `<p${attr}>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

// Plain one-line text for structured data.
function plain(text) {
  return String(text).trim().replace(/\s+/g, ' ');
}

function displayDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB',
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// Returns a list of problems; an empty list means the post can be published.
function validate(post, site) {
  const errors = [];
  const blank = (v) => v === undefined || v === null || String(v).trim() === '';

  for (const f of ['slug', 'title', 'description', 'author', 'date_published', 'intro']) {
    if (blank(post[f])) errors.push(`${f} is required`);
  }
  if (!blank(post.slug) && !SLUG_RE.test(post.slug)) {
    errors.push(`slug "${post.slug}" must be lowercase letters, digits and single hyphens`);
  }
  for (const [f, max] of Object.entries(LIMITS)) {
    if (!blank(post[f]) && post[f].length > max) {
      errors.push(`${f} is ${post[f].length} characters; the limit is ${max}`);
    }
  }
  for (const f of ['date_published', 'date_modified']) {
    if (!blank(post[f]) && !DATE_RE.test(post[f])) errors.push(`${f} must be YYYY-MM-DD`);
  }
  if (!Array.isArray(post.sections) || post.sections.length === 0) {
    errors.push('at least one section (question + answer) is required');
  } else {
    post.sections.forEach((s, i) => {
      if (blank(s.question) || blank(s.answer)) errors.push(`section ${i + 1} needs a question and an answer`);
    });
  }
  (post.faq || []).forEach((f, i) => {
    if (blank(f.question) || blank(f.answer)) errors.push(`FAQ ${i + 1} needs a question and an answer`);
  });
  if (blank(site.url) || /\/$/.test(site.url)) errors.push('site.url is required, without a trailing slash');
  if (blank(site.name)) errors.push('site.name is required');
  return errors;
}

function render(template, post, site) {
  const errors = validate(post, site);
  if (errors.length) throw new Error(`Post "${post.slug || '?'}" is not valid:\n- ${errors.join('\n- ')}`);

  const lang = site.lang || 'en';
  const url = `${site.url}/posts/${post.slug}/`;
  const modified = post.date_modified || post.date_published;
  const faq = post.faq || [];
  const takeaways = post.takeaways || [];

  // Structured data: Article always, FAQPage when the post has an FAQ.
  const article = {
    '@type': 'Article',
    '@id': `${url}#article`,
    headline: post.title,
    description: post.description,
    author: { '@type': 'Person', name: post.author },
    datePublished: post.date_published,
    dateModified: modified,
    mainEntityOfPage: url,
    inLanguage: lang,
    publisher: { '@type': 'Organization', name: site.name, url: `${site.url}/` },
  };
  if (post.og_image) article.image = [post.og_image];
  const graph = [article];
  if (faq.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: faq.map((f) => ({
        '@type': 'Question',
        name: plain(f.question),
        acceptedAnswer: { '@type': 'Answer', text: plain(f.answer) },
      })),
    });
  }
  // Escaping "<" keeps "</script>" inside a value from ending the script block.
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2)
    .replace(/</g, '\\u003c');

  const slots = {
    lang: esc(lang),
    site_name: esc(site.name),
    title: esc(post.title),
    description: esc(post.description),
    canonical_url: esc(url),
    author: esc(post.author),
    date_published: esc(post.date_published),
    date_modified: esc(modified),
    date_published_display: esc(displayDate(post.date_published)),
    updated_note: modified !== post.date_published
      ? ` · Updated <time datetime="${esc(modified)}">${esc(displayDate(modified))}</time>` : '',
    twitter_card: post.og_image ? 'summary_large_image' : 'summary',
    image_meta: post.og_image
      ? `<meta property="og:image" content="${esc(post.og_image)}">\n<meta name="twitter:image" content="${esc(post.og_image)}">` : '',
    json_ld: jsonLd,
    intro_html: paragraphs(post.intro, 'lead'),
    takeaways_html: takeaways.length
      ? `<aside class="takeaways" aria-labelledby="takeaways-heading">\n<h2 id="takeaways-heading">Key takeaways</h2>\n<ul>\n${
        takeaways.map((t) => `<li>${esc(t)}</li>`).join('\n')}\n</ul>\n</aside>` : '',
    sections_html: post.sections
      .map((s) => `<section>\n<h2>${esc(s.question)}</h2>\n${paragraphs(s.answer)}\n</section>`)
      .join('\n\n'),
    faq_html: faq.length
      ? `<section class="faq" aria-labelledby="faq-heading">\n<h2 id="faq-heading">Frequently asked questions</h2>\n${
        faq.map((f) => `<h3>${esc(f.question)}</h3>\n${paragraphs(f.answer)}`).join('\n')}\n</section>` : '',
  };

  // A function replacer, so "$" in post text is never treated as a pattern.
  return template.replace(/%%([a-z_]+)%%/g, (match, name) => {
    if (!(name in slots)) throw new Error(`Template uses unknown slot ${match}`);
    return slots[name];
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { render, validate, esc };
}

// Command line: node templates/render.js <post.json>   (prints HTML to stdout)
// The JSON file holds { "site": {...}, "post": {...} }.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node templates/render.js <post.json>');
    process.exit(2);
  }
  const { site, post } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const template = fs.readFileSync(path.join(__dirname, 'post.html'), 'utf8');
  try {
    process.stdout.write(render(template, post, site));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
