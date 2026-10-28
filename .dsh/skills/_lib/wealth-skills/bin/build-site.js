#!/usr/bin/env node

/**
 * Assembles the GitHub Pages site into a directory (default _site):
 *
 *   index.html          the dashboard, with its structured data, heading anchors and social metadata
 *   skills/             an index of the skill packs and a page per pack, built from the SKILL.md files
 *   catalog/            every catalog resource with its pack and coverage tier
 *   compare/            what this library does and does not do, against the alternatives
 *   assets/pages.css    the styling those pages share
 *   404.html            a small not-found page that links home
 *   src/engines/*.js    the browser-safe engine modules the dashboard imports
 *   robots.txt          allows everything, names the answer-engine crawlers and points at llms.txt
 *                       (crawlers read only the host root robots.txt, so submit the sitemap in Search Console)
 *   sitemap.xml         the published pages, dated by the last commit
 *   llms.txt            a plain summary for AI assistants and answer engines (llmstxt.org)
 *   llms-full.txt       the README and every skill pack, in one Markdown file
 *   catalog.json        the US Wealth Management Capability Catalog, the Dataset the page describes
 *   og-image.png        the social preview image
 *   <key>.txt           the IndexNow key, proving this site may notify search engines of updates
 *
 * Everything a search or answer engine reads is generated here: llms.txt from listCapabilities() and
 * the catalog, the JSON-LD graph from package.json, the catalog, the capability registry and the FAQ
 * on the page itself, and the heading anchors from the headings. None of it can drift from the code.
 *
 *   node bin/build-site.js [outDir]
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { listCapabilities } from '../src/engines/guidance.js';
import { LIBRARY_VERSION } from '../src/engines/audit.js';
import { WEALTH_TOOLS } from '../src/engines/tools.js';
import { buildPages } from './site-pages.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SITE_URL = 'https://ai-theories.github.io/wealth-skills/';
const ORG_URL = 'https://github.com/ai-theories';
const REPO_URL = 'https://github.com/ai-theories/wealth-skills';
const PACKS_DIR = path.join(root, 'skills');

/**
 * The AI assistant and answer-engine crawlers this site welcomes by name. A bare `Allow: /` under
 * `User-agent: *` already permits every one of them, so these blocks unlock nothing; they record,
 * in the file those operators actually read, that the content here may be crawled, cited and
 * summarised. Several of the agents only honour a block addressed to them (Google-Extended and
 * Applebot-Extended are opt-out switches for AI training, not crawlers in their own right).
 */
export const ANSWER_ENGINE_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'cohere-ai',
  'Meta-ExternalAgent',
  'Amazonbot',
  'Bytespider',
  'DuckAssistBot',
  'YouBot',
  'Diffbot',
  'Timpibot'
];
// IndexNow keys are public by design: search engines fetch this file to confirm a notification came
// from the site owner. See bin/notify-indexnow.js.
export const INDEXNOW_KEY = '6bd9647ed8bf0626c71c84c870b653b6';

function lastModified() {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs'], { cwd: root, encoding: 'utf8' }).trim() || today();
  } catch {
    return today();
  }
}

const today = () => new Date().toISOString().slice(0, 10);

function packs() {
  return fs.readdirSync(PACKS_DIR)
    .filter(name => fs.existsSync(path.join(PACKS_DIR, name, 'SKILL.md')))
    .sort()
    .map(name => {
      const text = fs.readFileSync(path.join(PACKS_DIR, name, 'SKILL.md'), 'utf8');
      const description = text.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
      return { name, description, text };
    });
}

const packageJson = () => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/** Tiers in which a library function does the work, as opposed to citing or mapping a resource. */
export const CODE_TIERS = ['engine', 'partial-engine', 'payload-builder'];

/** The catalog with the counts the page and llms.txt quote, so no count is ever typed by hand. */
function catalogData() {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog', 'catalog.json'), 'utf8'));
  const tally = (key) => {
    const counts = new Map();
    for (const item of catalog.items) counts.set(item[key], (counts.get(item[key]) ?? 0) + 1);
    return counts;
  };
  return {
    catalog,
    codeBacked: catalog.items.filter(item => CODE_TIERS.includes(item.tier)).length,
    bySection: tally('section'),
    byTier: tally('tier')
  };
}

export function buildLlmsTxt() {
  const { catalog, codeBacked } = catalogData();
  const byArea = new Map();
  for (const capability of listCapabilities()) {
    const area = capability.tool.split(' ')[0];
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area).push(capability);
  }

  const lines = [
    '# Wealth Skills',
    '',
    `> Open-source (MIT) wealth skills and investing skills for Claude, Claude Code, Codex and Cursor: Claude skills (SKILL.md packs) for wealth management, zero-dependency calculation engines, a CLI and Model Context Protocol servers for US wealth management. Version ${LIBRARY_VERSION}. It prepares analysis and payloads for a licensed professional to review; it never submits orders, moves money or gives investment advice.`,
    '',
    `Every capability below is available as a CLI command (\`node bin/wealth-skills.js <command>\`) and as an MCP tool. Results carry \`auditMetadata\`, \`needsInput\` (questions to ask when an input is missing) and \`suggestedNextSteps\`. ${codeBacked} of the ${catalog.items.length} resources in the US Wealth Management Capability Catalog are backed by engine code; the rest are mapped to packs as guidance or cited references.`,
    '',
    '## Links',
    '',
    `- [Interactive calculators](${SITE_URL}): the engines running in the browser`,
    `- [Skill packs](${SITE_URL}skills/): a page per pack, with its commands, limits and catalog coverage`,
    `- [Capability catalog](${SITE_URL}catalog/): every resource with its pack and coverage tier`,
    `- [How it compares](${SITE_URL}compare/): what this library does and does not do`,
    `- [Source code and README](${REPO_URL}): installation, journeys and guardrails`,
    `- [Full documentation for LLMs](${SITE_URL}llms-full.txt): README and every skill pack in one file`,
    `- [MCP and agent setup](${REPO_URL}/blob/main/docs/AGENT_INTEGRATION.md)`,
    `- [Compliance rules for agents](${REPO_URL}/blob/main/docs/COMPLIANCE_GUIDELINES.md)`,
    `- [Catalog crosswalk](${REPO_URL}/blob/main/CATALOG_CROSSWALK.md): coverage tier for all ${catalog.items.length} catalog resources`,
    `- [Capability catalog as JSON](${SITE_URL}catalog.json): every catalog resource with its pack, tier and engines`,
    '',
    '## Skill packs',
    ''
  ];
  for (const pack of packs()) {
    lines.push(`- [${pack.name}](${REPO_URL}/blob/main/skills/${pack.name}/SKILL.md): ${pack.description}`);
  }

  lines.push('', '## Capabilities', '');
  for (const [area, capabilities] of byArea) {
    lines.push(`### ${area}`, '');
    for (const capability of capabilities) {
      const required = capability.inputs.filter(input => input.required).map(input => input.field);
      lines.push(`- \`${capability.tool}\`: ${capability.summary} Needs: ${required.join(', ')}. Answers requests like "${capability.typicalRequests[0]}".`);
    }
    lines.push('');
  }

  lines.push(
    '## Limits',
    '',
    '- Does not connect to custodians, brokers or CRMs, and does not query FINRA BrokerCheck (its terms prohibit automated access).',
    '- Registration lookups read SEC IAPD compilation files downloaded from https://adviserinfo.sec.gov/compilation and cover investment advisers only.',
    '- Does not price options, screen sanctions lists, run a factor risk model or prepare tax returns.',
    '- Not investment, tax or legal advice.',
    ''
  );
  return lines.join('\n');
}

export function buildLlmsFullTxt() {
  const parts = [`# Wealth Skills: full documentation\n\nSource: ${REPO_URL}\n`, fs.readFileSync(path.join(root, 'README.md'), 'utf8')];
  for (const pack of packs()) parts.push(`\n---\n\n<!-- skills/${pack.name}/SKILL.md -->\n\n${pack.text}`);
  return parts.join('\n');
}

/**
 * How the project positions itself, in the words the page itself uses. Prose, not fact: every
 * number, version, count and capability name in the graph is read from the code at build time.
 */
const SOFTWARE_DESCRIPTION =
  'Open-source wealth skills and investing skills for Claude, Claude Code, Codex and Cursor: AI skill packs, '
  + 'calculation engines, a CLI and Model Context Protocol (MCP) servers for US wealth management: financial '
  + 'planning and tax, portfolio risk and performance, trade preparation, client onboarding, compliance, '
  + 'research, UHNW planning and fund operations.';

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ', sect: '§', middot: '·',
  times: '×', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”'
};

/** The visible text of an HTML fragment: tags dropped, entities decoded, whitespace collapsed. */
export function htmlText(fragment) {
  const text = fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&([a-z]+|#\d+);/gi, (entity, name) => ENTITIES[name] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
  // Fail closed: an entity nobody taught this function would reach structured data as raw markup.
  if (/&[a-z#0-9]+;/i.test(text)) throw new Error(`unknown HTML entity in page text: ${text.match(/&[a-z#0-9]+;/i)[0]}`);
  return text;
}

/**
 * The FAQ structured data is read out of the questions and answers on the page, so the two copies
 * cannot disagree: Google requires FAQ rich results to repeat text the visitor can actually see.
 */
export function faqFromPage(html) {
  const section = html.match(/<section class="faq"[\s\S]*?<\/section>/)?.[0];
  if (!section) throw new Error('dashboard.html has no FAQ section to build FAQPage structured data from');
  const entries = [...section.matchAll(/<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)]
    .map(([, question, answer]) => ({ question: htmlText(question), answer: htmlText(answer) }));
  if (!entries.length) throw new Error('the FAQ section on the page has no questions');
  return entries;
}

const slug = (heading) => htmlText(heading).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Gives every section heading an anchor, so a person or an answer engine can link to the answer
 * rather than the page. Generated from the heading text: a heading added later cannot miss out.
 */
export function withHeadingIds(html) {
  const used = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]));
  return html.replace(/<(h2|h3)([^>]*)>([\s\S]*?)<\/\1>/g, (whole, tag, attributes, inner) => {
    if (/\sid="/.test(attributes)) return whole;
    const base = slug(inner) || tag;
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    return `<${tag}${attributes} id="${id}">${inner}</${tag}>`;
  });
}

const META_DESCRIPTION = /<meta name="description" content="([^"]*)"/;
const META_KEYWORDS = /<meta name="keywords" content="([^"]*)"/;

/**
 * The schema.org graph: an Organization and WebSite for the publisher, a WebPage with its
 * breadcrumb trail, the SoftwareApplication with one feature per registered capability, the
 * capability catalog as a Dataset with its real group counts, and the FAQ from the page itself.
 * Every fact comes from package.json, the catalog, the capability registry or the page.
 */
export function buildStructuredData(html, lastmod = lastModified()) {
  const pkg = packageJson();
  const { catalog, codeBacked, bySection, byTier } = catalogData();
  const capabilities = listCapabilities();
  const skillPacks = packs();
  const id = (fragment) => ({ '@id': `${SITE_URL}#${fragment}` });
  const licenseUrl = `https://opensource.org/licenses/${pkg.license}`;
  const image = { '@type': 'ImageObject', url: `${SITE_URL}og-image.png`, width: 1200, height: 630 };
  const resource = (name, value, description) => ({ '@type': 'PropertyValue', name, value, unitText: 'resources', description });

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        ...id('organization'),
        name: 'ai-theories',
        url: new URL('..', SITE_URL).href,
        sameAs: [ORG_URL, REPO_URL],
        logo: image
      },
      {
        '@type': 'WebSite',
        ...id('website'),
        name: 'Wealth Skills',
        alternateName: pkg.name,
        url: SITE_URL,
        description: pkg.description,
        inLanguage: 'en',
        publisher: id('organization'),
        license: licenseUrl
      },
      {
        '@type': 'WebPage',
        ...id('webpage'),
        url: SITE_URL,
        name: html.match(/<title>([^<]+)<\/title>/)[1],
        description: html.match(META_DESCRIPTION)[1],
        inLanguage: 'en',
        dateModified: lastmod,
        isPartOf: id('website'),
        about: id('software'),
        mainEntity: id('faq'),
        breadcrumb: id('breadcrumbs'),
        primaryImageOfPage: image
      },
      {
        '@type': 'BreadcrumbList',
        ...id('breadcrumbs'),
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'ai-theories', item: new URL('..', SITE_URL).href },
          { '@type': 'ListItem', position: 2, name: 'Wealth Skills', item: SITE_URL }
        ]
      },
      {
        '@type': 'SoftwareApplication',
        ...id('software'),
        name: 'Wealth Skills',
        alternateName: ['wealth-skills', 'Claude skills for wealth management', 'Claude Code skills for wealth management', 'Investing skills for AI agents'],
        keywords: html.match(META_KEYWORDS)[1],
        description: SOFTWARE_DESCRIPTION,
        url: SITE_URL,
        codeRepository: REPO_URL,
        applicationCategory: 'FinanceApplication',
        applicationSubCategory: 'Claude skills and AI agent skills for wealth management',
        operatingSystem: `Any (Node.js ${pkg.engines.node.replace(/^>=/, '')} or later; runs in the browser)`,
        softwareVersion: LIBRARY_VERSION,
        license: licenseUrl,
        isAccessibleForFree: true,
        author: id('organization'),
        publisher: id('organization'),
        softwareHelp: { '@type': 'CreativeWork', name: 'MCP and agent setup', url: `${REPO_URL}/blob/main/docs/AGENT_INTEGRATION.md` },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        // One feature per registered capability, so the list is exactly what the CLI and MCP servers do.
        featureList: capabilities.map(capability => `${capability.summary} (\`${capability.tool}\`)`)
      },
      {
        '@type': 'Dataset',
        ...id('catalog'),
        name: 'US Wealth Management Capability Catalog',
        description: `${catalog.items.length} wealth management resources: platforms, specifications, open-source projects and research papers, each mapped to the skill pack that covers it and a coverage tier. ${codeBacked} are backed by engine code; the rest are cited as guidance or references. Covered by ${skillPacks.length} skill packs and ${capabilities.length} capabilities, ${WEALTH_TOOLS.length} of them exposed as MCP tools.`,
        url: `${REPO_URL}/blob/main/CATALOG_CROSSWALK.md`,
        creator: id('organization'),
        license: licenseUrl,
        isAccessibleForFree: true,
        inLanguage: 'en',
        dateModified: lastmod,
        keywords: ['wealth management', 'financial advisor software', 'AI agent skills', 'MCP tools', 'capability catalog'],
        measurementTechnique: 'Each resource is assigned a coverage tier by the skill pack that cites it; the counts here are read from catalog/catalog.json when the site is built.',
        distribution: [
          { '@type': 'DataDownload', name: 'catalog.json', encodingFormat: 'application/json', contentUrl: `${SITE_URL}catalog.json` },
          { '@type': 'DataDownload', name: 'llms-full.txt', encodingFormat: 'text/plain', contentUrl: `${SITE_URL}llms-full.txt` }
        ],
        variableMeasured: [
          resource('Catalog resources', catalog.items.length, 'Every resource in the catalog.'),
          resource('Resources backed by engine code', codeBacked, `Resources in the ${CODE_TIERS.join(', ')} tiers.`),
          ...[...bySection].map(([section, count]) => resource(catalog.sections[section], count, `Catalog section ${section}.`)),
          ...[...byTier].map(([tier, count]) => resource(tier, count, catalog.tiers[tier])),
          { '@type': 'PropertyValue', name: 'Skill packs', value: skillPacks.length, unitText: 'SKILL.md packs', description: skillPacks.map(pack => pack.name).join(', ') },
          { '@type': 'PropertyValue', name: 'Capabilities', value: capabilities.length, unitText: 'CLI commands', description: 'Each capability is a CLI command with a documented input contract.' },
          { '@type': 'PropertyValue', name: 'MCP tools', value: WEALTH_TOOLS.length, unitText: 'MCP tools', description: 'Tools the universal MCP server exposes to agents.' }
        ]
      },
      {
        '@type': 'FAQPage',
        ...id('faq'),
        inLanguage: 'en',
        isPartOf: id('webpage'),
        mainEntity: faqFromPage(html).map(entry => ({
          '@type': 'Question',
          name: entry.question,
          acceptedAnswer: { '@type': 'Answer', text: entry.answer }
        }))
      }
    ]
  };
}

/** Everything bin/site-pages.js builds its pages from. Assembled once, so no page reads its own facts. */
export function pageContext(lastmod = lastModified()) {
  const pkg = packageJson();
  return {
    siteUrl: SITE_URL,
    repoUrl: REPO_URL,
    orgUrl: ORG_URL,
    version: LIBRARY_VERSION,
    licenseUrl: `https://opensource.org/licenses/${pkg.license}`,
    lastmod,
    codeTiers: CODE_TIERS,
    packs: packs(),
    capabilities: listCapabilities(),
    catalog: catalogData().catalog,
    toolCount: WEALTH_TOOLS.length
  };
}

const STRUCTURED_DATA_TAG = /<script type="application\/ld\+json" id="structured-data">[\s\S]*?<\/script>/;

const PACK_LINKS_TAG = /<nav class="pack-links"[^>]*>[\s\S]*?<\/nav>/;

/** The link list the dashboard carries to the generated pages, written from the packs themselves. */
export function buildPackLinks() {
  const links = [
    `<a href="skills/">All ${packs().length} skill packs</a>`,
    ...packs().map(pack => `<a href="skills/${pack.name}/">${pack.name.replace(/^wealth-/, '').replace(/-/g, ' ')}</a>`),
    '<a href="catalog/">Capability catalog</a>',
    '<a href="compare/">How it compares</a>'
  ];
  return `<nav class="pack-links" aria-label="Skill packs">\n    ${links.join('\n    ')}\n  </nav>`;
}

/** The dashboard with its heading anchors and its generated structured data filled in. */
export function buildIndexHtml() {
  const html = withHeadingIds(fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8'))
    .replace(PACK_LINKS_TAG, () => buildPackLinks());
  if (!STRUCTURED_DATA_TAG.test(html)) throw new Error('dashboard.html has no structured-data script tag to fill in');
  // `<` is escaped so no page text can close the script element early.
  const json = JSON.stringify(buildStructuredData(html), null, 2).replace(/</g, '\\u003c');
  return html.replace(STRUCTURED_DATA_TAG, `<script type="application/ld+json" id="structured-data">\n${json}\n  </script>`);
}

export function buildSitemap(lastmod = lastModified()) {
  const pages = buildPages(pageContext(lastmod)).map(page => `${SITE_URL}${page.path}`);
  const urls = [SITE_URL, ...pages, `${SITE_URL}llms.txt`, `${SITE_URL}llms-full.txt`, `${SITE_URL}catalog.json`];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(loc => `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`),
    '</urlset>',
    ''
  ].join('\n');
}

export function buildRobots() {
  const lines = [
    '# Wealth Skills: open-source wealth management and investing skills for AI agents.',
    `# ${SITE_URL}`,
    '#',
    '# Plain-text summaries written for AI assistants and answer engines (llmstxt.org):',
    `#   ${SITE_URL}llms.txt       capabilities, skill packs, limits`,
    `#   ${SITE_URL}llms-full.txt  the README and every skill pack in one file`,
    `#   ${SITE_URL}catalog.json   the capability catalog as data`,
    '#',
    '# The named blocks below grant nothing the wildcard rule does not already allow. They are a',
    '# statement of intent, in the file their operators read: this content may be crawled, cited and',
    '# summarised, and no AI crawler is opted out here.',
    '',
    'User-agent: *',
    'Allow: /',
    ''
  ];
  for (const agent of ANSWER_ENGINE_CRAWLERS) lines.push(`User-agent: ${agent}`, 'Allow: /', '');
  lines.push(`Sitemap: ${SITE_URL}sitemap.xml`, '');
  return lines.join('\n');
}

export function build404() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Page not found | Wealth Skills</title>
  <meta name="robots" content="noindex">
  <style>
    body { font-family: system-ui, sans-serif; background: #0a0d14; color: #f3f4f6; display: grid; place-items: center; min-height: 100vh; margin: 0; }
    main { text-align: center; padding: 24px; }
    a { color: #3b82f6; }
  </style>
</head>
<body>
  <main>
    <h1>Page not found</h1>
    <p>This page does not exist. The <a href="${SITE_URL}">Wealth Skills calculators</a> and the <a href="${REPO_URL}">source code</a> do.</p>
  </main>
</body>
</html>
`;
}

export function buildSite(outDir = path.join(root, '_site')) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'src', 'engines'), { recursive: true });

  fs.writeFileSync(path.join(outDir, 'index.html'), buildIndexHtml());
  for (const file of fs.readdirSync(path.join(root, 'src', 'engines')).filter(f => f.endsWith('.js'))) {
    fs.copyFileSync(path.join(root, 'src', 'engines', file), path.join(outDir, 'src', 'engines', file));
  }
  fs.copyFileSync(path.join(root, 'site', 'og-image.png'), path.join(outDir, 'og-image.png'));
  // The Dataset in the page's structured data names this file as its distribution, so publish it.
  fs.copyFileSync(path.join(root, 'catalog', 'catalog.json'), path.join(outDir, 'catalog.json'));

  // A page per skill pack, the catalog and the comparison, each with its own metadata and anchors.
  fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });
  fs.copyFileSync(path.join(root, 'site', 'pages.css'), path.join(outDir, 'assets', 'pages.css'));
  for (const page of buildPages(pageContext())) {
    fs.mkdirSync(path.join(outDir, page.path), { recursive: true });
    fs.writeFileSync(path.join(outDir, page.path, 'index.html'), page.html);
  }
  fs.writeFileSync(path.join(outDir, '404.html'), build404());
  fs.writeFileSync(path.join(outDir, 'robots.txt'), buildRobots());
  fs.writeFileSync(path.join(outDir, 'sitemap.xml'), buildSitemap());
  fs.writeFileSync(path.join(outDir, 'llms.txt'), buildLlmsTxt());
  fs.writeFileSync(path.join(outDir, 'llms-full.txt'), buildLlmsFullTxt());
  fs.writeFileSync(path.join(outDir, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY);
  // Serve files as they are, without Jekyll processing.
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
  return outDir;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = buildSite(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log(`Site assembled in ${path.relative(root, out) || out}`);
}
