import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildSite, SITE_URL, pageContext } from '../bin/build-site.js';
import { buildPages } from '../bin/site-pages.js';
import { listCapabilities } from '../src/engines/guidance.js';
import { WEALTH_TOOLS } from '../src/engines/tools.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wealth-pages-'));
buildSite(out);
test.after(() => fs.rmSync(out, { recursive: true, force: true }));

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog', 'catalog.json'), 'utf8'));
const packNames = fs.readdirSync(path.join(root, 'skills')).filter(name => fs.existsSync(path.join(root, 'skills', name, 'SKILL.md'))).sort();
const pages = buildPages(pageContext()).map(page => ({ ...page, html: fs.readFileSync(path.join(out, page.path, 'index.html'), 'utf8') }));
const page = (urlPath) => pages.find(entry => entry.path === urlPath) ?? assert.fail(`no page at ${urlPath}`);
const graphOf = (html) => JSON.parse(html.match(/<script type="application\/ld\+json" id="structured-data">([\s\S]*?)<\/script>/)[1])['@graph'];
const nodeOf = (html, type) => graphOf(html).find(entry => entry['@type'] === type);
const visibleText = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('Pages: Every Skill Pack And Every Command Gets A Page, Alongside The Index, Catalog And Comparison', () => {
  // One page per command, under the first pack that documents it, so a command cited twice is published once.
  const owners = new Map();
  for (const name of packNames) {
    const skill = fs.readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
    for (const capability of listCapabilities()) {
      const documented = skill.includes(`\`${capability.tool}\``) || skill.includes(`wealth-skills.js ${capability.tool}`);
      if (documented && !owners.has(capability.tool)) owners.set(capability.tool, name);
    }
  }
  assert.equal(owners.size, listCapabilities().length, 'every registered command needs a pack to live under');
  const toolPaths = [...owners].map(([tool, name]) => `skills/${name}/${tool.replace(/[^a-z0-9]+/g, '-')}/`);

  assert.deepEqual(pages.map(entry => entry.path).sort(), [
    'catalog/', 'compare/', 'skills/', ...packNames.map(name => `skills/${name}/`), ...toolPaths
  ].sort());
  for (const entry of pages) assert.ok(fs.existsSync(path.join(out, entry.path, 'index.html')), `${entry.path} was not written`);
  assert.ok(fs.existsSync(path.join(out, 'assets', 'pages.css')));
});

test('Pages: No Two Pages Compete With The Same Title Or Description', () => {
  const titles = pages.map(entry => entry.title);
  const descriptions = pages.map(entry => entry.description);
  assert.equal(new Set(titles).size, titles.length, 'duplicate <title>');
  assert.equal(new Set(descriptions).size, descriptions.length, 'duplicate meta description');
  for (const entry of pages) {
    assert.ok(entry.title.length >= 30 && entry.title.length <= 70, `${entry.path} title is ${entry.title.length} characters`);
    assert.ok(entry.description.length >= 80 && entry.description.length <= 160, `${entry.path} description is ${entry.description.length} characters`);
    assert.doesNotMatch(entry.description, /\.\.\.$/, `${entry.path} description is a truncated sentence`);
    assert.equal(entry.html.match(/<title>([^<]+)<\/title>/)[1], entry.title.replace(/&/g, '&amp;'));
    assert.equal(entry.html.match(/<meta name="description" content="([^"]*)"/)[1], entry.description.replace(/&/g, '&amp;'));
  }
});

test('Pages: Each Page Says Where It Lives, And Says It The Same Way Twice', () => {
  for (const entry of pages) {
    const url = `${SITE_URL}${entry.path}`;
    assert.match(entry.html, new RegExp(`<link rel="canonical" href="${url}">`), `${entry.path} canonical`);
    assert.equal(entry.html.match(/<meta property="og:url" content="([^"]*)"/)[1], url);
    assert.equal((entry.html.match(/<h1[\s>]/g) ?? []).length, 1, `${entry.path} needs exactly one h1`);

    // The trail in the markup and the trail in the structured data have to agree.
    const crumbs = nodeOf(entry.html, 'BreadcrumbList').itemListElement;
    assert.deepEqual(crumbs.map(crumb => crumb.position), crumbs.map((_, index) => index + 1));
    assert.equal(crumbs[0].item, SITE_URL);
    assert.equal(crumbs.at(-1).item, url, `${entry.path} breadcrumb does not end at the page`);
    const visibleCrumbs = entry.html.match(/<nav class="breadcrumbs"[\s\S]*?<\/nav>/)[0];
    for (const crumb of crumbs) assert.ok(visibleCrumbs.includes(crumb.name), `${entry.path} hides the "${crumb.name}" crumb from readers`);

    const webPage = nodeOf(entry.html, 'WebPage');
    assert.equal(webPage.url, url);
    assert.equal(webPage.name, entry.title);
    assert.match(webPage.dateModified, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('Pages: Every Heading Can Be Deep-Linked, Behind A Skip Link Into A Content Landmark', () => {
  for (const entry of pages) {
    const headings = [...entry.html.matchAll(/<(h2|h3)([^>]*)>/g)];
    assert.ok(headings.length >= 3, `${entry.path} has ${headings.length} section headings`);
    const ids = headings.map(([whole, , attributes]) => {
      const id = attributes.match(/\sid="([^"]+)"/)?.[1];
      assert.ok(id, `${entry.path}: no anchor on ${whole}`);
      return id;
    });
    assert.equal(new Set(ids).size, ids.length, `${entry.path} repeats a heading anchor`);
    assert.match(entry.html, /<a class="skip-link" href="#content">/, `${entry.path} skip link`);
    assert.match(entry.html, /<main id="content">/, `${entry.path} content landmark`);
  }
});

test('Pages: A Pack Page Lists Exactly The Capabilities Its SKILL.md Documents', () => {
  const seen = new Set();
  for (const name of packNames) {
    const entry = page(`skills/${name}/`);
    const skill = fs.readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
    const owned = listCapabilities().filter(capability => skill.includes(`\`${capability.tool}\``) || skill.includes(`wealth-skills.js ${capability.tool}`));
    assert.ok(owned.length, `${name} documents no capability`);

    for (const capability of owned) {
      assert.ok(entry.html.includes(`<code>${capability.tool}</code>`), `${name} page omits ${capability.tool}`);
      assert.ok(entry.html.includes(capability.summary.replace(/&/g, '&amp;')), `${name} page omits what ${capability.tool} returns`);
      seen.add(capability.tool);
    }
    // The page states a count; it has to be the real one.
    assert.ok(entry.html.includes(`${owned.length} ${owned.length === 1 ? 'command' : 'commands'}`), `${name} page miscounts its commands`);
    const itemList = nodeOf(entry.html, 'ItemList');
    assert.equal(itemList.numberOfItems, owned.length);
    assert.deepEqual(itemList.itemListElement.map(item => item.name), owned.map(capability => capability.tool));
  }
  // Nothing registered may be missing from the site altogether.
  assert.deepEqual([...seen].sort(), listCapabilities().map(capability => capability.tool).sort());
});

test('Pages: A Pack Page Carries Its Catalog Resources And Its Published Limits', () => {
  for (const name of packNames) {
    const entry = page(`skills/${name}/`);
    const resources = catalog.items.filter(item => item.pack === name);
    for (const item of resources) {
      assert.ok(entry.html.includes(item.name.replace(/&/g, '&amp;')), `${name} page omits catalog resource ${item.id} (${item.name})`);
    }
    if (resources.length) assert.ok(entry.html.includes(`${resources.length} ${resources.length === 1 ? 'resource' : 'resources'}`), `${name} page miscounts its catalog resources`);

    // "What it does not do" is the section an agent needs most; it must never render empty.
    const limits = entry.html.match(/<h2 id="what-it-does-not-do">[\s\S]*?<\/section>/)[0];
    assert.ok(visibleText(limits).length > 300, `${name} page says too little about what it does not do`);
  }
});

test('Pages: The Catalog Page Lists Every Resource, Grouped As The Catalog Groups Them', () => {
  const entry = page('catalog/');
  for (const item of catalog.items) {
    assert.ok(entry.html.includes(item.name.replace(/&/g, '&amp;')), `the catalog page omits ${item.id} (${item.name})`);
  }
  for (const [key, label] of Object.entries(catalog.sections)) {
    const count = catalog.items.filter(item => item.section === key).length;
    assert.ok(entry.html.includes(`${label} (${count})`), `the catalog page miscounts section ${key}`);
  }
  for (const [tier, meaning] of Object.entries(catalog.tiers)) {
    assert.ok(entry.html.includes(meaning.replace(/&/g, '&amp;')), `the catalog page does not explain the ${tier} tier`);
  }
  const dataset = nodeOf(entry.html, 'Dataset');
  const measured = new Map(dataset.variableMeasured.map(variable => [variable.name, variable.value]));
  assert.equal(measured.get('Catalog resources'), catalog.items.length);
  for (const tier of Object.keys(catalog.tiers)) {
    assert.equal(measured.get(tier), catalog.items.filter(item => item.tier === tier).length);
  }
});

test('Pages: The Comparison Page Counts What The Registries Count, And Claims Nothing Else', () => {
  const entry = page('compare/');
  const text = visibleText(entry.html);
  assert.ok(text.includes(`${listCapabilities().length} commands`), 'the comparison page miscounts the commands');
  assert.ok(text.includes(`${WEALTH_TOOLS.length} MCP tools`), 'the comparison page miscounts the MCP tools');
  assert.ok(text.includes(`${catalog.items.length} resources`), 'the comparison page miscounts the catalog');
  assert.ok(text.includes(`${packNames.length} `), 'the comparison page does not say how many packs there are');

  // The page exists to answer "best ..." queries; the superlative belongs in the question only.
  const faq = nodeOf(entry.html, 'FAQPage').mainEntity;
  assert.ok(faq.some(question => /best AI agent for wealth management/i.test(question.name)));
  assert.ok(faq.some(question => /compare with other Claude finance skills/i.test(question.name)));
  for (const claim of [entry.title, entry.description, entry.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1], ...faq.map(question => question.acceptedAnswer.text)]) {
    assert.doesNotMatch(claim, /\b(best|top \d|number one|#1|leading|most advanced|unrivalled|unrivaled)\b/i, `unevidenced superlative: "${claim.slice(0, 60)}"`);
  }
});

test('Pages: Structured Data FAQs Repeat Questions The Reader Can See', () => {
  for (const entry of pages) {
    const faq = nodeOf(entry.html, 'FAQPage');
    if (!faq) continue;
    const visible = [...entry.html.matchAll(/<summary>([^<]+)<\/summary>/g)].map(match => match[1]);
    assert.deepEqual(faq.mainEntity.map(question => question.name.replace(/&/g, '&amp;')), visible, `${entry.path} FAQ does not match the page`);
    for (const question of faq.mainEntity) assert.ok(question.acceptedAnswer.text.length > 80, `${entry.path}: a one-line answer is not worth marking up`);
  }
});

test('Pages: Every Internal Link Points At Something The Build Publishes', () => {
  const published = (href) => {
    const relative = href.startsWith(SITE_URL) ? href.slice(SITE_URL.length) : href;
    const target = relative.replace(/[?#].*$/, '');
    if (!target) return true;
    const file = path.join(out, target.endsWith('/') ? path.join(target, 'index.html') : target);
    return fs.existsSync(file);
  };

  for (const entry of pages) {
    const base = entry.path;
    for (const [, href] of entry.html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^(https?:\/\/|data:|mailto:|#)/.test(href) && !href.startsWith(SITE_URL)) continue;
      const resolved = href.startsWith(SITE_URL) ? href : path.posix.normalize(path.posix.join(base, href));
      assert.ok(published(resolved), `${entry.path} links to ${href}, which the build does not publish`);
    }
  }
  // And the dashboard has to reach the new pages, or nothing will ever crawl them.
  const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  for (const target of ['skills/', 'catalog/', 'compare/', ...packNames.map(name => `skills/${name}/`)]) {
    assert.ok(index.includes(`href="${target}"`), `the dashboard does not link ${target}`);
  }
});

test('Pages: The Sitemap Lists Every Page, And The Pages Stay Cheap To Load', () => {
  const sitemap = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
  for (const entry of pages) {
    assert.ok(sitemap.includes(`<loc>${SITE_URL}${entry.path}</loc>`), `the sitemap omits ${entry.path}`);
  }
  for (const entry of pages) {
    // One stylesheet, no webfont, no script: these pages have nothing to run.
    assert.doesNotMatch(entry.html, /<script(?! type="application\/ld\+json")/, `${entry.path} loads a script`);
    assert.doesNotMatch(entry.html, /fonts\.googleapis\.com|fonts\.gstatic\.com/, `${entry.path} loads a webfont`);
    assert.deepEqual([...entry.html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match => match[1].replace(/^(\.\.\/)+/, '')), ['assets/pages.css']);
  }
});

test('Pages: Every Command Page Explains Its Inputs And How To Run It', () => {
  const commandPages = pages.filter(entry => entry.path.split('/').filter(Boolean).length === 3);
  assert.equal(commandPages.length, listCapabilities().length);

  for (const entry of commandPages) {
    const tool = listCapabilities().find(capability => entry.path.endsWith(`${capability.tool.replace(/[^a-z0-9]+/g, '-')}/`));
    assert.ok(tool, `${entry.path} does not correspond to a registered command`);

    // Every input, the question it asks and the reason it asks, as the registry states them.
    for (const input of tool.inputs) {
      assert.ok(entry.html.includes(`<code>${input.field}</code>`), `${entry.path} omits the ${input.field} input`);
      assert.ok(entry.html.includes(input.question.replace(/&/g, '&amp;').replace(/'/g, '&#39;')), `${entry.path} omits the question behind ${input.field}`);
    }
    for (const request of tool.typicalRequests) {
      assert.ok(entry.html.includes(request.replace(/&/g, '&amp;')), `${entry.path} omits the request "${request}"`);
    }

    const howTo = nodeOf(entry.html, 'HowTo');
    assert.equal(howTo.step.length, 3);
    assert.deepEqual(howTo.step.map(step => step.position), [1, 2, 3]);
    assert.deepEqual(howTo.supply.map(supply => supply.name), tool.inputs.map(input => input.field));
    assert.equal(howTo.description, tool.summary);
  }
});

test('Pages: A Pack Page Links Through To Each Of Its Commands', () => {
  for (const name of packNames) {
    const entry = page(`skills/${name}/`);
    const commandPages = pages.filter(other => other.path.startsWith(`skills/${name}/`) && other.path !== `skills/${name}/`);
    for (const command of commandPages) {
      assert.ok(entry.html.includes(`href="${SITE_URL}${command.path}"`), `the ${name} page does not link ${command.path}`);
    }
  }
});

test('Pages: The Comparison Page Is Marked Up As The Article It Is', () => {
  const entry = page('compare/');
  const article = nodeOf(entry.html, 'Article');
  assert.equal(article.headline, entry.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1]);
  assert.match(article.dateModified, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(nodeOf(entry.html, 'SoftwareSourceCode').codeRepository, 'https://github.com/ai-theories/wealth-skills');

  // Competitors carry AggregateRating and Review; this project has no ratings, so it claims none.
  for (const entry_ of pages) {
    assert.doesNotMatch(entry_.html, /"(AggregateRating|Review|Rating)"/, `${entry_.path} claims a rating nobody gave it`);
  }
});
