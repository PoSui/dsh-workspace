import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildSite, SITE_URL, INDEXNOW_KEY, ANSWER_ENGINE_CRAWLERS, CODE_TIERS } from '../bin/build-site.js';
import { WEALTH_TOOLS } from '../src/engines/tools.js';
import { indexNowRequest } from '../bin/notify-indexnow.js';
import { listCapabilities } from '../src/engines/guidance.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wealth-site-'));
buildSite(out);
test.after(() => fs.rmSync(out, { recursive: true, force: true }));

const read = (file) => fs.readFileSync(path.join(out, file), 'utf8');
const index = read('index.html');
const meta = (attr, name) => index.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1];

test('Site: The Build Publishes Only The Dashboard, Its Pages, Engines And Discovery Files', () => {
  const files = fs.readdirSync(out).sort();
  assert.deepEqual(files, ['.nojekyll', `${INDEXNOW_KEY}.txt`, '404.html', 'assets', 'catalog', 'catalog.json', 'compare', 'index.html', 'llms-full.txt', 'llms.txt', 'og-image.png', 'robots.txt', 'sitemap.xml', 'skills', 'src'].sort());
  assert.deepEqual(fs.readdirSync(path.join(out, 'src')), ['engines']);
  assert.ok(fs.readdirSync(path.join(out, 'src', 'engines')).every(f => f.endsWith('.js')));
  assert.deepEqual(fs.readdirSync(path.join(out, 'assets')), ['pages.css']);
  // tests/pages.test.js covers what is inside the generated pages.
  const packs = fs.readdirSync(path.join(root, 'skills')).filter(name => fs.existsSync(path.join(root, 'skills', name, 'SKILL.md')));
  assert.deepEqual(fs.readdirSync(path.join(out, 'skills')).sort(), ['index.html', ...packs].sort());
});

test('Site: The Page Has A Title, Description, Canonical URL And Social Cards', () => {
  const title = index.match(/<title>([^<]+)<\/title>/)[1];
  assert.ok(title.length >= 30 && title.length <= 65, `title is ${title.length} characters`);

  const description = meta('name', 'description');
  assert.ok(description.length >= 120 && description.length <= 160, `description is ${description.length} characters`);

  assert.match(index, new RegExp(`<link rel="canonical" href="${SITE_URL}">`));
  assert.match(index, /<html lang="en">/);
  assert.equal(meta('property', 'og:url'), SITE_URL);
  assert.equal(meta('property', 'og:image'), `${SITE_URL}og-image.png`);
  assert.equal(meta('name', 'twitter:card'), 'summary_large_image');
  assert.equal((index.match(/<h1[\s>]/g) ?? []).length, 1, 'exactly one h1');
});

test('Site: The Social Image Is A 1200 x 630 PNG', () => {
  const png = fs.readFileSync(path.join(out, 'og-image.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test('Site: Structured Data Parses And The FAQ Matches The Visible Questions', () => {
  const json = index.match(/<script type="application\/ld\+json" id="structured-data">([\s\S]*?)<\/script>/)[1];
  const graph = JSON.parse(json)['@graph'];

  const software = graph.find(node => node['@type'] === 'SoftwareApplication');
  assert.equal(software.url, SITE_URL);
  assert.equal(software.softwareVersion, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);

  // Google requires FAQ structured data to match content visible on the page, so it is read out of
  // the page: every question and every answer must be text a visitor can see.
  const faq = graph.find(node => node['@type'] === 'FAQPage').mainEntity;
  const visible = [...index.matchAll(/<details[^>]*>\s*<summary>([^<]+)<\/summary>([\s\S]*?)<\/details>/g)];
  assert.ok(visible.length >= 8);
  assert.deepEqual(faq.map(question => question.name), visible.map(match => match[1]));
  for (const [index_, question] of faq.entries()) {
    const words = visible[index_][2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    assert.ok(question.acceptedAnswer.text.length > 40);
    for (const word of words.split(' ').filter(w => w.length > 7)) {
      assert.ok(question.acceptedAnswer.text.includes(word), `the answer to "${question.name}" does not say "${word}" as the page does`);
    }
  }
});

test('Site: Crawlers Without JavaScript Do Not See The file:// Warning First', () => {
  assert.match(index, /<div id="module-warning" class="module-warning" hidden>/);
});

test('Site: robots.txt, sitemap.xml And 404 Are Well Formed', () => {
  assert.match(read('robots.txt'), new RegExp(`Sitemap: ${SITE_URL}sitemap.xml`));
  const sitemap = read('sitemap.xml');
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(sitemap, new RegExp(`<loc>${SITE_URL}</loc><lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`));
  assert.match(read('404.html'), /<meta name="robots" content="noindex">/);
});

test('Site: llms.txt Lists Every Capability And Every Skill Pack', () => {
  const llms = read('llms.txt');
  assert.match(llms, /^# Wealth Skills\n\n> /);
  for (const capability of listCapabilities()) assert.ok(llms.includes(`\`${capability.tool}\``), `llms.txt is missing ${capability.tool}`);
  for (const pack of fs.readdirSync(path.join(root, 'skills')).filter(p => fs.existsSync(path.join(root, 'skills', p, 'SKILL.md')))) {
    assert.ok(llms.includes(`[${pack}]`), `llms.txt is missing ${pack}`);
    assert.ok(read('llms-full.txt').includes(`skills/${pack}/SKILL.md`));
  }
});

test('Site: Every Dashboard Import Is An Export Of The Engine It Names', async () => {
  const imports = [...index.matchAll(/import \{([^}]+)\} from '\.\/src\/engines\/([\w-]+\.js)'/g)];
  assert.ok(imports.length >= 10);
  for (const [, names, file] of imports) {
    const module = await import(path.join(root, 'src', 'engines', file));
    for (const name of names.split(',').map(n => n.trim())) assert.notEqual(module[name], undefined, `${file} does not export ${name}`);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'src', 'engines', file), 'utf8'), /^import .* from 'node:/m, `${file} imports a Node built-in and cannot run in the browser`);
  }
});

test('Site: Every Tab Has A Panel And Every Element The Script Reads Exists', () => {
  const tabs = [...index.matchAll(/data-tab="([\w-]+)"/g)].map(match => match[1]);
  assert.ok(tabs.length >= 10);
  for (const tab of tabs) assert.match(index, new RegExp(`id="${tab}" class="tab-content`), `no panel for ${tab}`);

  const script = index.slice(index.indexOf('<script type="module">'));
  const ids = new Set([...script.matchAll(/\$\('([\w-]+)'\)/g), ...script.matchAll(/'([a-z]+-[\w-]+)'/g)].map(match => match[1]).filter(id => !id.startsWith('tab-') || tabs.includes(id)));
  for (const id of ids) {
    if (/^(input|change)$/.test(id)) continue;
    if (!/^(plan|port|quant|uhnw|fix|tax|perf|suit|mkt|fund|planning|portfolio|performance|suitability|markets|fundops|module)-/.test(id)) continue;
    assert.match(index, new RegExp(`id="${id}"`), `the script reads #${id}, which is not on the page`);
  }
});

test('Site: Every Suitability Dropdown Value Is One The Engine Accepts', async () => {
  const { checkSuitability } = await import('../src/engines/compliance.js');
  const options = (id) => [...index.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`))[0].matchAll(/value="([^"]+)"/g)].map(match => match[1]);

  for (const riskTolerance of options('suit-risk')) assert.doesNotThrow(() => checkSuitability({ riskTolerance }, { riskLevel: 3 }), riskTolerance);
  for (const liquidityNeeds of options('suit-liquidity')) assert.doesNotThrow(() => checkSuitability({ liquidityNeeds }, { liquidity: 'daily' }), liquidityNeeds);
  for (const liquidity of options('suit-pliquidity')) assert.doesNotThrow(() => checkSuitability({ liquidityNeeds: 'low' }, { liquidity }), liquidity);
});

test('Site: The IndexNow Key File Matches The Notification, And Every URL Is Under The Key Location', () => {
  assert.match(INDEXNOW_KEY, /^[a-f0-9]{32}$/);
  assert.equal(read(`${INDEXNOW_KEY}.txt`), INDEXNOW_KEY);

  const request = indexNowRequest();
  assert.equal(request.host, 'ai-theories.github.io');
  assert.equal(request.keyLocation, `${SITE_URL}${INDEXNOW_KEY}.txt`);
  for (const url of request.urlList) assert.ok(url.startsWith(SITE_URL), `${url} is outside the key location's path`);
});

test('Site: The Search Phrases People Use Appear In The Title, Description And Visible Text', () => {
  const title = index.match(/<title>([^<]+)<\/title>/)[1].toLowerCase();
  const description = meta('name', 'description').toLowerCase();
  const visible = index.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<head>[\s\S]*?<\/head>/, '').replace(/<[^>]+>/g, ' ').toLowerCase();

  assert.match(title, /claude skills for wealth management/);
  for (const phrase of ['wealth skills', 'investing skills', 'claude code']) assert.ok(description.includes(phrase), `description lacks "${phrase}"`);
  for (const phrase of ['claude skills for wealth management', 'investing skills', 'wealth skills', 'claude code', 'codex', 'cursor']) {
    assert.ok(visible.includes(phrase), `visible page text lacks "${phrase}"`);
  }
  assert.match(read('llms.txt'), /wealth skills and investing skills for Claude, Claude Code/);
});

test('Site: The Chat Tab Ships With Every Scenario, Tool And Mode', async () => {
  const { SCENARIOS } = await import('../src/engines/assistant.js');
  assert.match(index, /id="tab-chat" class="tab-content active"/, 'chat is the tab people land on');
  assert.match(index, /data-tab="tab-chat"/);
  assert.match(index, /id="chat-log"/);

  for (const element of ['chat-form', 'chat-input', 'chat-chips', 'chat-key', 'chat-model', 'chat-key-clear', 'chat-tool-index', 'chat-mode-note']) {
    assert.match(index, new RegExp(`id="${element}"`), `the chat needs #${element}`);
  }
  assert.ok(SCENARIOS.length >= 6);
  // Demo mode must not be gated behind a key.
  assert.match(index, /value="demo" checked/);
});

test('Site: Browser Calls To Claude Carry The Required Headers And Never Store The Key', () => {
  const script = index.slice(index.indexOf('<script type="module">'));

  assert.match(script, /https:\/\/api\.anthropic\.com\/v1\/messages/);
  assert.match(script, /'anthropic-version': '2023-06-01'/);
  // Anthropic rejects browser-origin calls without this opt-in.
  assert.match(script, /'anthropic-dangerous-direct-browser-access': 'true'/);
  assert.match(script, /'x-api-key': apiKey/);
  assert.match(script, /stop_reason !== 'tool_use'/, 'the tool loop must end when Claude stops calling tools');
  assert.match(script, /stop_reason === 'refusal'/, 'a refusal must be surfaced, not treated as an answer');

  // The key lives in a closure for the tab's lifetime only.
  assert.doesNotMatch(script, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  const apiHost = [...script.matchAll(/fetch\(\s*'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(apiHost, ['https://api.anthropic.com/v1/messages'], 'the page makes no other network calls');
});

test('Site: robots.txt Names Every Answer-Engine Crawler And Points At The Plain-Text Summaries', () => {
  const robots = read('robots.txt');

  assert.match(robots, /User-agent: \*\nAllow: \//, 'the wildcard rule still allows everything');
  // Named here, not read from the build, so dropping one from bin/build-site.js fails this test.
  const expected = [
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-Web', 'anthropic-ai', 'PerplexityBot',
    'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'cohere-ai', 'Meta-ExternalAgent',
    'Amazonbot', 'Bytespider', 'DuckAssistBot', 'YouBot', 'Diffbot', 'Timpibot'
  ];
  assert.deepEqual(ANSWER_ENGINE_CRAWLERS, expected);
  for (const agent of expected) {
    assert.match(robots, new RegExp(`\nUser-agent: ${agent}\nAllow: /\n`), `robots.txt does not name ${agent}`);
  }
  // A named block grants nothing the wildcard does not; the file has to say so rather than imply
  // that these crawlers were unlocked here.
  assert.match(robots, /grant nothing the wildcard rule does not already allow/);
  assert.doesNotMatch(robots, /^Disallow:/m, 'nothing on this site is blocked');

  for (const file of ['llms.txt', 'llms-full.txt', 'catalog.json']) {
    assert.ok(robots.includes(`#   ${SITE_URL}${file}`), `robots.txt does not point at ${file}`);
    assert.ok(fs.existsSync(path.join(out, file)), `robots.txt points at ${file}, which is not published`);
  }
  assert.match(robots, new RegExp(`Sitemap: ${SITE_URL}sitemap.xml`));
});

test('Site: The Page Links Both Plain-Text Summaries, And The Sitemap Lists Them', () => {
  for (const file of ['llms.txt', 'llms-full.txt']) {
    assert.match(index, new RegExp(`<link rel="alternate" type="text/plain" href="${SITE_URL}${file}" title="[^"]+">`), `the page does not link ${file}`);
  }
  const sitemap = read('sitemap.xml');
  for (const file of ['llms.txt', 'llms-full.txt', 'catalog.json']) {
    assert.ok(sitemap.includes(`<loc>${SITE_URL}${file}</loc>`), `the sitemap does not list ${file}`);
  }
});

const graph = () => JSON.parse(index.match(/<script type="application\/ld\+json" id="structured-data">([\s\S]*?)<\/script>/)[1])['@graph'];
const node = (type) => graph().find(entry => entry['@type'] === type);

test('Site: The Structured Data Is One Graph Whose Every Reference Resolves', () => {
  assert.equal((index.match(/type="application\/ld\+json"/g) ?? []).length, 1, 'one block, not a second one to drift from');
  const raw = index.match(/<script type="application\/ld\+json" id="structured-data">([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(raw, /</, 'page text inside the JSON must not be able to close the script element');

  const nodes = graph();
  assert.deepEqual(nodes.map(entry => entry['@type']).sort(), ['BreadcrumbList', 'Dataset', 'FAQPage', 'Organization', 'SoftwareApplication', 'WebPage', 'WebSite']);

  const ids = new Set(nodes.map(entry => entry['@id']));
  const referenced = [...JSON.stringify(nodes).matchAll(/"@id":"([^"]+)"/g)].map(match => match[1]);
  for (const reference of referenced) assert.ok(ids.has(reference), `${reference} is referenced but is not a node in the graph`);
  assert.equal(ids.size, nodes.length, 'every node has its own @id');
});

test('Site: The Publisher, Website And Page Nodes Agree With The Published URLs', () => {
  const organization = node('Organization');
  assert.equal(organization.url, 'https://ai-theories.github.io/');
  assert.ok(organization.sameAs.includes('https://github.com/ai-theories/wealth-skills'));

  const website = node('WebSite');
  assert.equal(website.url, SITE_URL);
  assert.equal(website.publisher['@id'], organization['@id']);

  const page = node('WebPage');
  assert.equal(page.url, SITE_URL);
  assert.equal(page.name, index.match(/<title>([^<]+)<\/title>/)[1]);
  assert.equal(page.description, meta('name', 'description'));
  assert.match(page.dateModified, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(page.primaryImageOfPage.url, `${SITE_URL}og-image.png`);
  assert.equal(page.mainEntity['@id'], node('FAQPage')['@id']);
  assert.equal(page.about['@id'], node('SoftwareApplication')['@id']);
});

test('Site: The Breadcrumb Trail Runs From The Organization Down To This Page', () => {
  const trail = node('BreadcrumbList').itemListElement;
  assert.equal(node('WebPage').breadcrumb['@id'], node('BreadcrumbList')['@id']);
  assert.deepEqual(trail.map(item => item.position), trail.map((_, i) => i + 1));
  assert.equal(trail.at(-1).item, SITE_URL, 'the trail ends at this page');
  for (const [i, item] of trail.entries()) {
    assert.ok(item.name.length > 0);
    assert.ok(SITE_URL.startsWith(item.item), `${item.item} is not an ancestor of ${SITE_URL}`);
    if (i > 0) assert.ok(item.item.length > trail[i - 1].item.length, 'each step goes one level deeper');
  }
});

test('Site: Every Registered Capability Is A Feature Of The Software, With Its Real Version', () => {
  const software = node('SoftwareApplication');
  assert.equal(software.softwareVersion, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
  assert.equal(software.keywords, meta('name', 'keywords'), 'the graph and the page claim the same keywords');
  assert.equal(software.featureList.length, listCapabilities().length);
  for (const capability of listCapabilities()) {
    assert.ok(software.featureList.some(feature => feature.includes(capability.tool)), `featureList is missing ${capability.tool}`);
  }
});

test('Site: The Catalog Dataset Carries The Catalog\'s Own Group Names And Counts', () => {
  const catalog = JSON.parse(read('catalog.json'));
  assert.deepEqual(catalog, JSON.parse(fs.readFileSync(path.join(root, 'catalog', 'catalog.json'), 'utf8')), 'the published catalog is the source of truth, unchanged');

  const dataset = node('Dataset');
  const measured = new Map(dataset.variableMeasured.map(entry => [entry.name, entry.value]));
  const counted = (key, value) => catalog.items.filter(item => item[key] === value).length;

  assert.equal(measured.get('Catalog resources'), catalog.items.length);
  assert.equal(measured.get('Resources backed by engine code'), catalog.items.filter(item => CODE_TIERS.includes(item.tier)).length);
  for (const [key, label] of Object.entries(catalog.sections)) {
    assert.equal(measured.get(label), counted('section', key), `the count for section ${key} is wrong`);
  }
  for (const tier of Object.keys(catalog.tiers)) {
    assert.equal(measured.get(tier), counted('tier', tier), `the count for tier ${tier} is wrong`);
    assert.equal(dataset.variableMeasured.find(entry => entry.name === tier).description, catalog.tiers[tier]);
  }
  assert.equal(measured.get('Skill packs'), fs.readdirSync(path.join(root, 'skills')).filter(p => fs.existsSync(path.join(root, 'skills', p, 'SKILL.md'))).length);
  assert.equal(measured.get('Capabilities'), listCapabilities().length);
  assert.equal(measured.get('MCP tools'), WEALTH_TOOLS.length);

  // Every number in the prose has to be one of the measured values, not a figure typed by hand.
  for (const number of dataset.description.match(/\d+/g)) assert.ok([...measured.values()].includes(Number(number)), `${number} in the Dataset description is not a measured count`);
  for (const download of dataset.distribution) {
    assert.ok(download.contentUrl.startsWith(SITE_URL));
    assert.ok(fs.existsSync(path.join(out, download.contentUrl.slice(SITE_URL.length))), `${download.contentUrl} is not published`);
  }
});

test('Site: The Counts In The Visible Answers Match The Registries', () => {
  const packs = fs.readdirSync(path.join(root, 'skills')).filter(p => fs.existsSync(path.join(root, 'skills', p, 'SKILL.md')));
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

  assert.ok(index.includes(`ships ${words[packs.length]} of them`), `the FAQ does not say the library ships ${words[packs.length]} skill packs`);
  assert.ok(index.includes(`${words[packs.length]} skill packs map onto`), 'the comparison answer names a different number of skill packs');
  assert.ok(index.includes(`It exposes ${WEALTH_TOOLS.length} tools`), `the FAQ does not say the server exposes ${WEALTH_TOOLS.length} tools`);
  assert.ok(index.includes(`${WEALTH_TOOLS.length} MCP tools`), 'the comparison answer names a different number of MCP tools');
  assert.ok(index.includes(`catalog of ${JSON.parse(read('catalog.json')).items.length} wealth management resources`), 'the comparison answer names a different catalog size');
  assert.ok(read('llms.txt').includes(`all ${JSON.parse(read('catalog.json')).items.length} catalog resources`));
  assert.ok(index.includes(`v${JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version}`), 'the footer shows the published version');
});

test('Site: Every Heading Can Be Deep-Linked, Behind A Skip Link Into A Content Landmark', () => {
  const headings = [...index.matchAll(/<(h2|h3)([^>]*)>([\s\S]*?)<\/\1>/g)];
  assert.ok(headings.length >= 20);
  const ids = headings.map(([whole, , attributes]) => {
    const id = attributes.match(/\sid="([^"]+)"/)?.[1];
    assert.ok(id, `no anchor on ${whole.slice(0, 60)}`);
    return id;
  });
  assert.equal(new Set(ids).size, ids.length, 'the anchors are unique');

  assert.match(index, /<a class="skip-link" href="#content">/);
  assert.match(index, /<main id="content">/);
  assert.equal((index.match(/<main[\s>]/g) ?? []).length, 1, 'one content landmark');
  // The questions answer engines quote have to be inside the landmark the skip link reaches.
  const main = index.slice(index.indexOf('<main id="content">'), index.indexOf('</main>'));
  assert.ok(main.includes('<section class="faq"'));
  assert.ok(main.includes('id="faq-title"'));
});

test('Site: The Dashboard Served Locally Is The Page That Gets Published', async () => {
  const { buildIndexHtml } = await import('../bin/build-site.js');
  assert.equal(buildIndexHtml(), index, 'npm run dashboard and npm run site must render the same page');
  // The source file carries a placeholder, so nobody can hand-edit the structured data in place.
  const source = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  assert.match(source, /id="structured-data">\s*\{"@context": "https:\/\/schema\.org", "@graph": \[\]\}/);
});

test('Site: Fonts Load Without Blocking The Page', () => {
  assert.match(index, /<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>/);
  const fonts = index.match(/<link href="(https:\/\/fonts\.googleapis\.com[^"]+)" rel="stylesheet">/)[1];
  assert.match(fonts, /display=swap/, 'text must render before the webfont arrives');
  assert.equal((index.match(/fonts\.googleapis\.com\/css2/g) ?? []).length, 1, 'one stylesheet request');
});

test('Site: The Comparison Questions People Search For Are Asked And Answered Without Self-Praise', () => {
  // The superlative belongs in the question, which is what people type, never in a claim the page
  // makes about itself: the answer has to win on specifics a reader can check.
  const faq = node('FAQPage').mainEntity;
  const asked = faq.map(question => question.name.toLowerCase());
  assert.ok(asked.some(question => question.includes('best ai agent for wealth management')));
  assert.ok(asked.some(question => question.includes('compare with other claude finance skills')));

  const keywords = meta('name', 'keywords').toLowerCase();
  for (const phrase of ['best wealth skills', 'best ai agent for wealth management', 'top 10 wealth management ai agents', 'best claude skills for investing', 'open source wealth management ai']) {
    assert.ok(keywords.includes(phrase), `the keywords leave out "${phrase}"`);
  }

  const claims = [index.match(/<title>([^<]+)<\/title>/)[1], index.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1], meta('name', 'description'), meta('property', 'og:title')];
  for (const claim of claims.concat(faq.map(question => question.acceptedAnswer.text))) {
    assert.doesNotMatch(claim, /\b(best|top \d|number one|#1|leading|most advanced|unrivalled|unrivaled)\b/i, `a superlative the project cannot evidence: "${claim.slice(0, 70)}"`);
  }
});
