/**
 * The pages the site publishes besides the dashboard: one per skill pack, an index of the packs,
 * the capability catalog, and a page comparing this library with other agent skills.
 *
 * Every page is assembled from the skill packs, the capability registry and the catalog, so a pack,
 * a capability or a catalog resource added to the code appears on the site with no page to write and
 * nothing to remember. Nothing here is typed by hand except layout and section wording; if a pack
 * stops carrying a section this module needs, it throws rather than publishing a page with a hole.
 *
 * buildPages(context) returns [{ path, html, title, description }], which bin/build-site.js writes
 * out and lists in the sitemap.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (text) => String(text).replace(/[&<>"']/g, character => ESCAPES[character]);
const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const list = (items) => items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/**
 * A meta description built from whole sentences: take them in order while they fit. Search engines
 * cut a description around 160 characters, and a sentence cut mid-word reads like a broken page.
 */
function compose(sentences, max = 158) {
  let description = '';
  // Skip a sentence that does not fit rather than stopping: a shorter one further down still can.
  for (const next of sentences.filter(Boolean)) {
    const candidate = description ? `${description} ${next}` : next;
    if (candidate.length <= max) description = candidate;
  }
  if (!description) throw new Error(`no sentence short enough for a meta description: ${sentences[0]?.slice(0, 40)}`);
  return description;
}

/** Markdown emphasis and code spans, as HTML. Pack prose uses no other inline markup. */
function inline(markdown) {
  return escape(markdown)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, text, href) => /^https?:\/\//.test(href) ? `<a href="${href}">${text}</a>` : text);
}

/**
 * The bullets under a `## heading` in a SKILL.md, or null when the pack has no such section.
 * Deliberately not multiline: `$` has to mean the end of the file, or the lazy group closes at the
 * end of the heading's own line and every section comes back empty.
 */
function bullets(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const section = markdown.match(new RegExp(`(?:^|\\n)## ${escaped}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`));
  if (!section) return null;
  const found = [...section[1].matchAll(/^- (.+)$/gm)].map(match => match[1].trim());
  return found.length ? found : null;
}

/** The first shell example in a SKILL.md: what someone would actually run. */
function shellExample(markdown) {
  return markdown.match(/```bash\n([\s\S]*?)```/)?.[1].trim() ?? null;
}

const REQUIRED_SECTIONS = ['Engine-Backed Capabilities', 'Guidance Only', 'Limits to State With Every Result'];
const REQUIRED_BULLETS = ['Guidance Only', 'Limits to State With Every Result'];

/**
 * A skill pack as a page needs it: its own prose, the capabilities it documents, and the catalog
 * resources mapped to it. Throws if a pack drops a section the page is built from.
 */
export function readPack(pack, context) {
  for (const heading of REQUIRED_SECTIONS) {
    if (!pack.text.includes(`## ${heading}`)) {
      throw new Error(`skills/${pack.name}/SKILL.md has no "${heading}" section for its page to use`);
    }
  }
  // A section that parses to nothing would publish a heading with no content under it, which is
  // exactly the kind of silent gap the page is supposed to close.
  for (const heading of REQUIRED_BULLETS) {
    if (!bullets(pack.text, heading)) throw new Error(`skills/${pack.name}/SKILL.md has a "${heading}" section the page cannot read any bullets from`);
  }
  const owns = (capability) => pack.text.includes(`\`${capability.tool}\``) || pack.text.includes(`wealth-skills.js ${capability.tool}`);
  const capabilities = context.capabilities.filter(owns);
  if (!capabilities.length) throw new Error(`skills/${pack.name}/SKILL.md names none of the registered capabilities`);

  return {
    ...pack,
    capabilities,
    whenToUse: bullets(pack.text, 'When to Activate'),
    guidanceOnly: bullets(pack.text, 'Guidance Only') ?? [],
    limits: bullets(pack.text, 'Limits to State With Every Result') ?? [],
    shell: shellExample(pack.text),
    resources: context.catalog.items.filter(item => item.pack === pack.name)
  };
}

/**
 * How a pack is written in prose: "wealth-fund-ops" -> "Fund operations", "wealth-uhnw" -> "UHNW".
 * A pack with no entry here still reads correctly, just without the house spelling.
 */
const PACK_WORDS = { uhnw: 'UHNW', crm: 'CRM', ops: 'operations', fund: 'Fund' };
const packTitle = (name) => sentence(name.replace(/^wealth-/, '').split('-').map(word => PACK_WORDS[word] ?? word).join(' '));

/**
 * Questions a pack answers, in the words people ask them, answered from the registry: the summary,
 * the inputs the command needs and why the first one matters. These feed the page's FAQPage data,
 * so an answer engine can quote a capability without the page claiming anything the code does not do.
 */
function packQuestions(pack) {
  return pack.capabilities.slice(0, 6).map(capability => {
    const required = capability.inputs.filter(input => input.required);
    const needs = required.length ? ` It needs ${list(required.map(input => input.field))}.` : '';
    const why = required[0]?.why ? ` ${required[0].why}` : '';
    return {
      question: `${sentence(capability.typicalRequests[0].replace(/\?$/, ''))}?`,
      answer: `${capability.summary} Run \`${capability.tool}\` in the CLI, or call the same tool over MCP.${needs}${why} The result carries the method it used, the data it used, anything still missing and the next steps worth taking, for a licensed professional to review.`
    };
  });
}

const TIER_ORDER = ['engine', 'partial-engine', 'payload-builder', 'guidance', 'standard-reference', 'integration-reference', 'research-reference'];

function resourceTable(resources, catalog) {
  const rows = [...resources].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.id.localeCompare(b.id));
  return `<table>
<thead><tr><th>Resource</th><th>What the pack does with it</th><th>Coverage</th></tr></thead>
<tbody>
${rows.map(item => `<tr><td>${item.url ? `<a href="${escape(item.url)}" rel="nofollow">${escape(item.name)}</a>` : escape(item.name)}</td><td>${escape(item.capability)}${item.note ? ` <span class="muted">${escape(item.note)}</span>` : ''}</td><td><span class="tier" title="${escape(catalog.tiers[item.tier])}">${escape(item.tier)}</span></td></tr>`).join('\n')}
</tbody>
</table>`;
}

function capabilityTable(capabilities, href) {
  return `<table>
<thead><tr><th>Command</th><th>What it returns</th><th>What it needs</th></tr></thead>
<tbody>
${capabilities.map(capability => {
    const required = capability.inputs.filter(input => input.required).map(input => input.field);
    const name = `<code>${escape(capability.tool)}</code>`;
    return `<tr><td>${href ? `<a href="${href(capability)}">${name}</a>` : name}</td><td>${escape(capability.summary)}</td><td>${required.length ? required.map(field => `<code>${escape(field)}</code>`).join(', ') : '<span class="muted">nothing required</span>'}</td></tr>`;
  }).join('\n')}
</tbody>
</table>`;
}

const ul = (items) => `<ul>\n${items.map(item => `<li>${inline(item)}</li>`).join('\n')}\n</ul>`;

function faqBlock(questions) {
  return questions.map(entry => `<details>
<summary>${escape(entry.question)}</summary>
<p>${inline(entry.answer)}</p>
</details>`).join('\n');
}

/* ------------------------------------------------------------------ layout */

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23f59e0b'/%3E%3Ctext x='32' y='45' font-family='Arial' font-weight='700' font-size='38' text-anchor='middle' fill='%23000'%3EW%3C/text%3E%3C/svg%3E";

/**
 * One page, with the metadata search and answer engines read and a JSON-LD graph whose breadcrumb
 * matches the trail the reader can see. `sections` are rendered in order, each with its own anchor.
 */
function layout({ context, path, title, description, heading, intro, sections, trail, extraNodes = [], keywords }) {
  const url = `${context.siteUrl}${path}`;
  const depth = path.split('/').filter(Boolean).length;
  const home = '../'.repeat(depth) || './';
  const crumbs = [{ name: 'Wealth Skills', path: '' }, ...trail];

  const graph = [
    {
      '@type': 'Organization',
      '@id': `${context.siteUrl}#organization`,
      name: 'ai-theories',
      url: new URL('..', context.siteUrl).href
    },
    {
      '@type': 'WebSite',
      '@id': `${context.siteUrl}#website`,
      name: 'Wealth Skills',
      url: context.siteUrl,
      publisher: { '@id': `${context.siteUrl}#organization` }
    },
    {
      '@type': 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: title,
      description,
      inLanguage: 'en',
      dateModified: context.lastmod,
      isPartOf: { '@id': `${context.siteUrl}#website` },
      breadcrumb: { '@id': `${url}#breadcrumbs` },
      primaryImageOfPage: { '@type': 'ImageObject', url: `${context.siteUrl}og-image.png`, width: 1200, height: 630 }
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumbs`,
      itemListElement: crumbs.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.name,
        item: `${context.siteUrl}${crumb.path}`
      }))
    },
    ...extraNodes
  ];

  const body = sections.map(section => `  <section class="block">
    <h2 id="${section.id}">${escape(section.heading)}</h2>
    ${section.html}
  </section>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escape(title)}</title>
  <meta name="description" content="${escape(description)}">
${keywords ? `  <meta name="keywords" content="${escape(keywords)}">\n` : ''}  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical" href="${url}">
  <meta name="theme-color" content="#0a0d14">
  <link rel="icon" href="${FAVICON}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Wealth Skills">
  <meta property="og:title" content="${escape(title)}">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${context.siteUrl}og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Wealth Skills: open-source AI tools for US wealth management">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escape(title)}">
  <meta name="twitter:description" content="${escape(description)}">
  <meta name="twitter:image" content="${context.siteUrl}og-image.png">
  <link rel="alternate" type="text/plain" href="${context.siteUrl}llms.txt" title="LLM-readable summary">
  <link rel="alternate" type="text/plain" href="${context.siteUrl}llms-full.txt" title="Full documentation for LLMs">
  <link rel="stylesheet" href="${home}assets/pages.css">
  <script type="application/ld+json" id="structured-data">
${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2).replace(/</g, '\\u003c')}
  </script>
</head>
<body>
  <a class="skip-link" href="#content">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="${home}"><span class="brand-logo">W</span> Wealth Skills</a>
    <nav class="header-nav" aria-label="Site">
      <a href="${home}skills/">Skill packs</a>
      <a href="${home}catalog/">Catalog</a>
      <a href="${home}compare/">Comparison</a>
      <a href="${context.repoUrl}">GitHub</a>
    </nav>
  </header>
  <nav class="breadcrumbs" aria-label="Breadcrumb">
    ${crumbs.map((crumb, index) => index === crumbs.length - 1
      ? `<span aria-current="page">${escape(crumb.name)}</span>`
      : `<a href="${context.siteUrl}${crumb.path}">${escape(crumb.name)}</a> <span class="sep">/</span>`).join('\n    ')}
  </nav>
  <main id="content">
    <h1>${escape(heading)}</h1>
    ${intro}
${body}
  </main>
  <footer class="site-footer">
    <p>MIT licensed &middot; v${context.version} &middot; Not investment, tax or legal advice. Results are for review by a licensed professional. &middot; <a href="${context.repoUrl}">GitHub</a> &middot; <a href="${context.siteUrl}llms.txt">llms.txt</a></p>
  </footer>
</body>
</html>
`;
}

/* ------------------------------------------------------------------- pages */

/** Words up to a limit, cut at a word boundary and never mid-word. */
function clampWords(text, max) {
  const trimmed = text.replace(/\.$/, '');
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '');
}

const toolSlug = (tool) => slug(tool);

/**
 * A page for one command: what it returns, what it needs and why, the requests it answers and the
 * limits of the pack it belongs to. Every word comes from the capability registry or the pack, so
 * these pages exist for exactly the commands the code exposes.
 */
function toolPage(capability, pack, context) {
  const path = `skills/${pack.name}/${toolSlug(capability.tool)}/`;
  const required = capability.inputs.filter(input => input.required);
  // The question people actually type, which is also what the registry records as a typical request.
  const title = `${sentence(capability.typicalRequests[0].replace(/\?$/, ''))}? | Wealth Skills`;
  const description = compose([
    `${capability.summary}`,
    `Run \`${capability.tool}\` in the CLI or as an MCP tool in Claude, Claude Code or Cursor.`,
    required.length ? `It needs ${list(required.map(input => input.field))}.` : 'It needs no input to start.',
    'Free and open source.'
  ]);
  const command = (pack.shell ?? '').split('\n').find(line => line.includes(capability.tool));

  const inputRows = `<table>
<thead><tr><th>Input</th><th>Required</th><th>The question it asks</th><th>Why it matters</th></tr></thead>
<tbody>
${capability.inputs.map(input => `<tr><td><code>${escape(input.field)}</code></td><td>${input.required ? 'yes' : 'optional'}</td><td>${escape(input.question)}</td><td>${escape(input.why)}</td></tr>`).join('\n')}
</tbody>
</table>`;

  const steps = [
    { name: 'Gather what it needs', text: required.length ? `Have ${list(required.map(input => input.field))} to hand. The command asks for anything missing rather than assuming a value.` : 'The command runs without required input.' },
    { name: 'Run the command', text: command ? `Run ${command.trim()}` : `Run the ${capability.tool} command in the CLI, or call the same tool over MCP.` },
    { name: 'Review the result', text: 'Read the figures alongside the method, the data sources and the stated limits that come back with them, and route anything that affects a client to a licensed professional.' }
  ];

  return {
    path,
    title,
    description,
    html: layout({
      context,
      path,
      title,
      description,
      keywords: `${capability.tool}, ${capability.typicalRequests.join(', ')}, Claude skill, MCP tool`,
      heading: sentence(capability.summary.replace(/\.$/, '')),
      intro: `<p class="lead">One command in the <a href="${context.siteUrl}skills/${pack.name}/">${escape(packTitle(pack.name))}</a> pack, available in the CLI, as an MCP tool and as a JavaScript import: <code>${escape(capability.tool)}</code>.</p>`,
      trail: [
        { name: 'Skill packs', path: 'skills/' },
        { name: packTitle(pack.name), path: `skills/${pack.name}/` },
        { name: capability.tool, path }
      ],
      sections: [
        {
          id: 'what-it-needs',
          heading: 'What it needs, and why',
          html: `<p>Every input is checked before anything is calculated. ${required.length ? `${list(required.map(input => `<code>${escape(input.field)}</code>`))} ${required.length === 1 ? 'is' : 'are'} required; the rest refine the answer.` : 'Nothing is required to start.'}</p>
${inputRows}`
        },
        {
          id: 'requests-it-answers',
          heading: 'Requests it answers',
          html: ul(capability.typicalRequests.map(request => `\u201c${request}\u201d`)) + `<p>An agent with this pack loaded picks the command from phrasing like that, asks for whatever input is missing, and reports the figures with the method that produced them.</p>`
        },
        ...(command ? [{ id: 'run-it', heading: 'Run it', html: `<pre><code>${escape(command.trim())}</code></pre>` }] : []),
        {
          id: 'limits',
          heading: `Limits it inherits from ${pack.name}`,
          html: ul(pack.limits) + `<p>The full pack, its other ${pack.capabilities.length - 1} ${pack.capabilities.length === 2 ? 'command' : 'commands'} and what it deliberately leaves alone are on the <a href="${context.siteUrl}skills/${pack.name}/">${escape(packTitle(pack.name))} page</a>.</p>`
        }
      ],
      extraNodes: [{
        '@type': 'HowTo',
        '@id': `${context.siteUrl}${path}#howto`,
        name: `How to run ${capability.tool}`,
        description: capability.summary,
        totalTime: 'PT1M',
        supply: capability.inputs.map(input => ({ '@type': 'HowToSupply', name: input.field })),
        step: steps.map((step, index) => ({ '@type': 'HowToStep', position: index + 1, name: step.name, text: step.text }))
      }]
    })
  };
}


function packPage(pack, context, siblings, toolHref) {
  const title = `${packTitle(pack.name)} skills for Claude and AI agents | Wealth Skills`;
  const topic = packTitle(pack.name).toLowerCase();
  const description = compose([
    pack.capabilities.length === 1
      ? `One ${topic} command for Claude, Claude Code and any MCP client, backed by calculation code.`
      : `${pack.capabilities.length} ${topic} commands for Claude, Claude Code and any MCP client, each backed by calculation code.`,
    `Includes ${list(pack.capabilities.slice(0, 2).map(capability => capability.tool))}.`,
    'Open source and free.'
  ]);
  const questions = packQuestions(pack);
  const codeBacked = pack.resources.filter(item => context.codeTiers.includes(item.tier)).length;

  const sections = [
    {
      id: 'capabilities',
      heading: `What ${pack.name} calculates`,
      html: `<p>${pack.capabilities.length} ${pack.capabilities.length === 1 ? 'command' : 'commands'}, each available in the CLI, as an MCP tool and as a JavaScript import. Every result carries the method it used, the questions it still needs answered and the next steps worth taking.</p>
${capabilityTable(pack.capabilities, toolHref)}`
    },
    {
      id: 'when-to-use-it',
      heading: 'When to use it',
      html: (pack.whenToUse ? ul(pack.whenToUse) : '') + `<p>Requests this pack answers:</p>
${ul(pack.capabilities.flatMap(capability => capability.typicalRequests.slice(0, 2)).map(request => `“${request}”`))}`
    },
    {
      id: 'what-it-does-not-do',
      heading: 'What it does not do',
      html: `<p>Named here because leaving it out is how an agent ends up asserting something the code never computed.</p>
${pack.guidanceOnly.length ? `<h3 id="guidance-only">Guidance only, no engine behind it</h3>\n${ul(pack.guidanceOnly)}` : ''}
${pack.limits.length ? `<h3 id="limits">Limits to state with every result</h3>\n${ul(pack.limits)}` : ''}`
    },
    ...(pack.shell ? [{
      id: 'run-it',
      heading: 'Run it',
      html: `<pre><code>${escape(pack.shell)}</code></pre>
<p>The same commands are exposed as MCP tools, so Claude, Claude Code, Codex, Cursor and any other MCP client can call them directly. See the <a href="${context.repoUrl}/blob/main/docs/AGENT_INTEGRATION.md">integration guide</a> and the pack itself, <a href="${context.repoUrl}/blob/main/skills/${pack.name}/SKILL.md">skills/${pack.name}/SKILL.md</a>.</p>`
    }] : []),
    ...(pack.resources.length ? [{
      id: 'catalog-coverage',
      heading: 'Catalog coverage',
      html: `<p>${pack.resources.length} ${pack.resources.length === 1 ? 'resource' : 'resources'} from the <a href="${context.siteUrl}catalog/">US Wealth Management Capability Catalog</a> map to this pack, ${codeBacked} of them backed by engine code and the rest cited as guidance or reference.</p>
${resourceTable(pack.resources, context.catalog)}`
    }] : []),
    {
      id: 'questions-it-answers',
      heading: 'Questions it answers',
      html: faqBlock(questions)
    },
    {
      id: 'other-packs',
      heading: 'The other skill packs',
      html: ul(siblings.map(other => `[${packTitle(other.name)}](${context.siteUrl}skills/${other.name}/): ${other.description.split('. ')[0]}.`))
    }
  ];

  return {
    path: `skills/${pack.name}/`,
    title,
    description,
    html: layout({
      context,
      path: `skills/${pack.name}/`,
      title,
      description,
      keywords: `${packTitle(pack.name).toLowerCase()} skills, Claude skills for ${packTitle(pack.name).toLowerCase()}, ${pack.name}, AI agent skills for wealth management, MCP tools`,
      heading: `${packTitle(pack.name)}: Claude skills backed by calculation code`,
      intro: `<p class="lead">${escape(pack.description)}</p>`,
      trail: [{ name: 'Skill packs', path: 'skills/' }, { name: packTitle(pack.name), path: `skills/${pack.name}/` }],
      sections,
      extraNodes: [
        {
          '@type': 'FAQPage',
          '@id': `${context.siteUrl}skills/${pack.name}/#faq`,
          mainEntity: questions.map(entry => ({
            '@type': 'Question',
            name: entry.question,
            acceptedAnswer: { '@type': 'Answer', text: entry.answer.replace(/`/g, '') }
          }))
        },
        {
          '@type': 'ItemList',
          '@id': `${context.siteUrl}skills/${pack.name}/#capabilities`,
          name: `${packTitle(pack.name)} capabilities`,
          numberOfItems: pack.capabilities.length,
          itemListElement: pack.capabilities.map((capability, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: capability.tool,
            description: capability.summary
          }))
        }
      ]
    })
  };
}

function packsIndexPage(packs, context) {
  const title = 'Claude skill packs for wealth management | Wealth Skills';
  const capabilities = packs.reduce((total, pack) => total + pack.capabilities.length, 0);
  const description = compose([
    `The ${packs.length} skill packs in Wealth Skills, ${capabilities} commands in all: ${packs.slice(0, 4).map(pack => packTitle(pack.name).toLowerCase()).join(', ')} and more.`,
    'Each is backed by calculation code an agent can run.'
  ]);

  return {
    path: 'skills/',
    title,
    description,
    html: layout({
      context,
      path: 'skills/',
      title,
      description,
      keywords: 'Claude skills, Claude Code skills, agent skills, wealth management skills, investing skills, MCP tools, SKILL.md',
      heading: 'Skill packs for wealth management and investing',
      intro: `<p class="lead">A skill pack is a <code>SKILL.md</code> file that tells an agent when a workflow applies and which tools to use, plus the code those tools run. Wealth Skills has ${packs.length}, covering ${capabilities} commands between them.</p>`,
      trail: [{ name: 'Skill packs', path: 'skills/' }],
      sections: [
        {
          id: 'the-packs',
          heading: 'The packs',
          html: packs.map(pack => `<article class="card">
  <h3 id="${slug(pack.name)}"><a href="${context.siteUrl}skills/${pack.name}/">${escape(packTitle(pack.name))}</a></h3>
  <p>${escape(pack.description)}</p>
  <p class="muted">${pack.capabilities.length} ${pack.capabilities.length === 1 ? 'command' : 'commands'}: ${pack.capabilities.map(capability => `<code>${escape(capability.tool)}</code>`).join(', ')}</p>
</article>`).join('\n')
        },
        {
          id: 'how-to-install-them',
          heading: 'How to use them',
          html: `<p>Clone the repository and register the MCP server with your client, or call the CLI directly. The <a href="${context.repoUrl}/blob/main/docs/AGENT_INTEGRATION.md">integration guide</a> has the configuration for Claude Desktop, Claude Code, Codex and Cursor. Every pack runs locally with no dependencies and reaches no network service.</p>`
        }
      ],
      extraNodes: [{
        '@type': 'ItemList',
        '@id': `${context.siteUrl}skills/#packs`,
        name: 'Wealth Skills skill packs',
        numberOfItems: packs.length,
        itemListElement: packs.map((pack, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: packTitle(pack.name),
          description: pack.description,
          url: `${context.siteUrl}skills/${pack.name}/`
        }))
      }]
    })
  };
}

function catalogPage(context, packs) {
  const { catalog } = context;
  const codeBacked = catalog.items.filter(item => context.codeTiers.includes(item.tier)).length;
  const title = `US wealth management capability catalog: ${catalog.items.length} resources`;
  const description = compose([
    `Every platform, specification, open-source project and paper Wealth Skills covers: ${catalog.items.length} resources, ${codeBacked} of them backed by engine code.`,
    'Each one carries its skill pack and coverage tier.'
  ]);

  const sections = Object.entries(catalog.sections).map(([key, label]) => {
    const items = catalog.items.filter(item => item.section === key);
    return {
      id: slug(label),
      heading: `${label} (${items.length})`,
      html: resourceTable(items, catalog)
    };
  });

  return {
    path: 'catalog/',
    title,
    description,
    html: layout({
      context,
      path: 'catalog/',
      title,
      description,
      keywords: 'wealth management software catalog, financial advisor tools, MCP tools, capability catalog, Addepar, Orion, eMoney, Schwab, FINRA, SEC',
      heading: `US Wealth Management Capability Catalog`,
      intro: `<p class="lead">${catalog.items.length} resources a US wealth management practice runs on, each mapped to the <a href="${context.siteUrl}skills/">skill pack</a> that covers it and a coverage tier saying how far that goes. ${codeBacked} are backed by engine code; the rest are cited as guidance or reference. The same data is published as <a href="${context.siteUrl}catalog.json">catalog.json</a>.</p>`,
      trail: [{ name: 'Catalog', path: 'catalog/' }],
      sections: [
        {
          id: 'coverage-tiers',
          heading: 'What the coverage tiers mean',
          html: `<dl>${Object.entries(catalog.tiers).map(([tier, meaning]) => `<dt><span class="tier">${escape(tier)}</span></dt><dd>${escape(meaning)} <span class="muted">${catalog.items.filter(item => item.tier === tier).length} resources</span></dd>`).join('\n')}</dl>
<p>Coverage by pack: ${packs.map(pack => `<a href="${context.siteUrl}skills/${pack.name}/">${escape(packTitle(pack.name))}</a> (${catalog.items.filter(item => item.pack === pack.name).length})`).join(', ')}.</p>`
        },
        ...sections
      ],
      extraNodes: [{
        '@type': 'Dataset',
        '@id': `${context.siteUrl}catalog/#dataset`,
        name: 'US Wealth Management Capability Catalog',
        description,
        url: `${context.siteUrl}catalog/`,
        license: context.licenseUrl,
        creator: { '@id': `${context.siteUrl}#organization` },
        isAccessibleForFree: true,
        dateModified: context.lastmod,
        distribution: [{ '@type': 'DataDownload', name: 'catalog.json', encodingFormat: 'application/json', contentUrl: `${context.siteUrl}catalog.json` }],
        variableMeasured: [
          { '@type': 'PropertyValue', name: 'Catalog resources', value: catalog.items.length, unitText: 'resources' },
          { '@type': 'PropertyValue', name: 'Resources backed by engine code', value: codeBacked, unitText: 'resources' },
          ...Object.entries(catalog.sections).map(([key, label]) => ({
            '@type': 'PropertyValue', name: label, value: catalog.items.filter(item => item.section === key).length, unitText: 'resources'
          })),
          ...Object.entries(catalog.tiers).map(([tier, meaning]) => ({
            '@type': 'PropertyValue', name: tier, value: catalog.items.filter(item => item.tier === tier).length, unitText: 'resources', description: meaning
          }))
        ]
      }]
    })
  };
}

function comparisonPage(context, packs) {
  const capabilities = context.capabilities.length;
  const codeBacked = context.catalog.items.filter(item => context.codeTiers.includes(item.tier)).length;
  const title = 'How Wealth Skills compares with other Claude finance skills';
  const description = compose([
    `What separates agent skills for finance is whether the numbers come from code: ${capabilities} commands, ${context.toolCount} MCP tools, ${packs.length} skill packs.`,
    'The limits are published too.'
  ]);

  const questions = [
    {
      question: 'What is the best AI agent for wealth management?',
      answer: `That depends on the work, and no honest answer is a single name. The question worth asking is where the numbers come from: a skill that leaves arithmetic to a language model will be confidently wrong eventually, and the output gives a reviewer nothing to check. Wealth Skills runs ${capabilities} calculations in zero-dependency JavaScript the agent calls, and every result names the method it used, the inputs it still needs and the next steps worth taking.`
    },
    {
      question: 'How does this compare with other Claude finance skills and MCP servers?',
      answer: `Most published finance skills are prompt files: a SKILL.md that tells the model what to do and leaves the calculation to the model. Here the calculation is code, exposed as ${context.toolCount} MCP tools and the same commands in the CLI, with the repository's tests running against every engine before the site deploys. Its ${packs.length} packs map onto a catalog of ${context.catalog.items.length} wealth management resources with a stated coverage tier for each, so what is implemented and what is merely cited is public rather than implied.`
    },
    {
      question: 'Is it safe to let an agent run these calculations for a client?',
      answer: 'The library prepares work; it does not act. It opens no connection to a custodian, broker or CRM, submits no orders and moves no money. Results that would affect a client are flagged for human approval, and every engine fails closed by naming the input it is missing rather than assuming one. A licensed professional still reviews the output.'
    },
    {
      question: 'What does Wealth Skills not do?',
      answer: `It does not connect to custodians, brokers or CRMs, does not query FINRA BrokerCheck (its terms prohibit automated access), does not price options, screen sanctions lists, run a factor risk model or prepare tax returns, and gives no investment, tax or legal advice. Of the ${context.catalog.items.length} catalog resources, ${codeBacked} are backed by engine code and the remainder are cited as guidance or reference, which the catalog states resource by resource.`
    },
    {
      question: 'Is it free and open source?',
      answer: `Yes, MIT licensed, with no dependencies and no account to create. The engines run locally, in the CLI, in an MCP server or in the browser on this site. Version ${context.version} is current.`
    }
  ];

  return {
    path: 'compare/',
    title,
    description,
    html: layout({
      context,
      path: 'compare/',
      title,
      description,
      keywords: 'best Claude skills for wealth management, best AI agent for wealth management, top wealth management AI agents, Claude finance skills comparison, open source wealth management AI, MCP server comparison',
      heading: 'How Wealth Skills compares with other Claude finance skills',
      intro: `<p class="lead">There are a lot of agent skills for finance now, and most of the difference between them comes down to one question: when the answer is a number, where did the number come from? This page lays out what this library does, in checkable terms, and what it refuses to do.</p>`,
      trail: [{ name: 'Comparison', path: 'compare/' }],
      sections: [
        {
          id: 'what-is-actually-in-the-box',
          heading: 'What is actually in the box',
          html: `<table>
<thead><tr><th>&nbsp;</th><th>Wealth Skills</th></tr></thead>
<tbody>
<tr><td>Calculations</td><td>${capabilities} commands in zero-dependency JavaScript, run locally</td></tr>
<tr><td>Agent interface</td><td>${context.toolCount} MCP tools, the same commands in a CLI, and a JavaScript library</td></tr>
<tr><td>Skill packs</td><td>${packs.length} <code>SKILL.md</code> packs, each <a href="${context.siteUrl}skills/">published here</a> with its commands and limits</td></tr>
<tr><td>Scope, stated</td><td>A <a href="${context.siteUrl}catalog/">catalog of ${context.catalog.items.length} resources</a>, ${codeBacked} backed by code and the rest marked as guidance or reference</td></tr>
<tr><td>Every result carries</td><td>The method, the data sources, the questions still unanswered, the suggested next steps, and a human-approval flag where it matters</td></tr>
<tr><td>Network access</td><td>None, apart from the SEC and FRED lookups you ask for by name</td></tr>
<tr><td>Licence and cost</td><td>MIT, free, no account</td></tr>
</tbody>
</table>`
        },
        {
          id: 'the-difference-that-matters',
          heading: 'The difference that matters',
          html: `<p>A prompt-only skill and an engine-backed one look identical in a demo. They diverge when a client asks how a figure was reached. A capital-loss carryover produced by a language model reading a prompt cannot be traced; one produced by <code>planning capital-losses</code> follows the Schedule D Capital Loss Carryover Worksheet, states that it did, and names what it ignored.</p>
<p>The same applies to the gaps. This library publishes its own limits on every page and in <a href="${context.siteUrl}llms.txt">llms.txt</a>, because an agent that does not know a tool's boundary will walk straight past it.</p>`
        },
        {
          id: 'questions-people-ask',
          heading: 'Questions people ask',
          html: faqBlock(questions)
        },
        {
          id: 'see-for-yourself',
          heading: 'See for yourself',
          html: `<p>The <a href="${context.siteUrl}">calculators on the home page</a> run the real engines in your browser, with no sign-up and no API key. The code is on <a href="${context.repoUrl}">GitHub</a>, and <a href="${context.siteUrl}llms-full.txt">llms-full.txt</a> is the whole documentation set in one file if you would rather hand it to an agent.</p>`
        }
      ],
      extraNodes: [{
        '@type': 'Article',
        '@id': `${context.siteUrl}compare/#article`,
        headline: 'How Wealth Skills compares with other Claude finance skills',
        description,
        author: { '@id': `${context.siteUrl}#organization` },
        publisher: { '@id': `${context.siteUrl}#organization` },
        dateModified: context.lastmod,
        isAccessibleForFree: true,
        mainEntityOfPage: { '@id': `${context.siteUrl}compare/#webpage` }
      }, {
        '@type': 'SoftwareSourceCode',
        '@id': `${context.siteUrl}#source`,
        name: 'wealth-skills',
        codeRepository: context.repoUrl,
        programmingLanguage: 'JavaScript',
        runtimePlatform: 'Node.js',
        license: context.licenseUrl,
        author: { '@id': `${context.siteUrl}#organization` }
      }, {
        '@type': 'FAQPage',
        '@id': `${context.siteUrl}compare/#faq`,
        mainEntity: questions.map(entry => ({
          '@type': 'Question',
          name: entry.question,
          acceptedAnswer: { '@type': 'Answer', text: entry.answer }
        }))
      }]
    })
  };
}

/** Every page besides the dashboard, ready to write out. */
export function buildPages(context) {
  const packs = context.packs.map(pack => readPack(pack, context));
  const owner = new Map();
  for (const pack of packs) {
    for (const capability of pack.capabilities) if (!owner.has(capability.tool)) owner.set(capability.tool, { capability, pack });
  }
  if (owner.size !== context.capabilities.length) {
    const missing = context.capabilities.filter(capability => !owner.has(capability.tool)).map(capability => capability.tool);
    throw new Error(`no skill pack documents ${missing.join(', ')}, so ${missing.length} command(s) would have no page`);
  }

  // A command cited by two packs is published once, under the first pack that documents it.
  const toolHref = (capability) => `${context.siteUrl}skills/${owner.get(capability.tool).pack.name}/${toolSlug(capability.tool)}/`;

  const pages = [
    packsIndexPage(packs, context),
    ...packs.map(pack => packPage(pack, context, packs.filter(other => other.name !== pack.name), toolHref)),
    ...[...owner.values()].map(({ capability, pack }) => toolPage(capability, pack, context)),
    catalogPage(context, packs),
    comparisonPage(context, packs)
  ];

  const titles = new Set(pages.map(page => page.title));
  if (titles.size !== pages.length) throw new Error('two generated pages share a title, which makes them compete with each other');
  return pages;
}

export { packTitle };
