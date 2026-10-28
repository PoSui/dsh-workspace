/**
 * Wealth UI Engine - Adaptive Multi-Platform UI Template Generator
 * Adapts financial outputs for Claude (Artifacts/Alerts), Codex (Canvas/LaTeX), Cursor (Diffs), Antigravity, and Terminal.
 */

export function renderAdaptiveUI(data, platform = 'claude') {
  const p = platform.toLowerCase();

  switch (p) {
    case 'claude':
      return renderClaudeUI(data);
    case 'codex':
    case 'chatgpt':
      return renderCodexUI(data);
    case 'cursor':
    case 'vscode':
      return renderCursorUI(data);
    case 'antigravity':
    case 'gemini':
      return renderAntigravityUI(data);
    default:
      return renderGenericUI(data);
  }
}

function renderClaudeUI(data) {
  let output = `> [!IMPORTANT]\n> **Wealth Management Deliverable**: Output formatted for Claude Artifacts.\n\n`;

  if (data.title) output += `## ${data.title}\n\n`;

  if (data.summary) {
    output += `> [!NOTE]\n> ${data.summary}\n\n`;
  }

  if (data.metrics) {
    output += `### Key Financial Metrics\n\n| Metric | Value |\n|---|---|\n`;
    for (const [k, v] of Object.entries(data.metrics)) {
      output += `| **${k}** | ${v} |\n`;
    }
    output += `\n`;
  }

  if (data.mermaid) {
    output += `### Workflow Diagram\n\`\`\`mermaid\n${data.mermaid}\n\`\`\`\n\n`;
  }

  return output;
}

function renderCodexUI(data) {
  let output = ``;
  if (data.title) output += `# ${data.title}\n\n`;
  if (data.summary) output += `*${data.summary}*\n\n`;

  if (data.latexFormula) {
    output += `$$\n${data.latexFormula}\n$$\n\n`;
  }

  if (data.metrics) {
    output += `### Metrics Table\n\n| Metric | Value |\n|---|---|\n`;
    for (const [k, v] of Object.entries(data.metrics)) {
      output += `| ${k} | ${v} |\n`;
    }
    output += `\n`;
  }

  return output;
}

function renderCursorUI(data) {
  let output = ``;
  if (data.title) output += `### ${data.title}\n\n`;

  if (data.diffContent) {
    output += `\`\`\`diff\n${data.diffContent}\n\`\`\`\n\n`;
  }

  if (data.fileLinks) {
    output += `**Associated Files**:\n`;
    for (const link of data.fileLinks) {
      output += `- [${link.name}](${link.uri})\n`;
    }
    output += `\n`;
  }

  return output;
}

function renderAntigravityUI(data) {
  let output = ``;
  if (data.title) output += `# ${data.title}\n\n`;
  if (data.summary) output += `> [!TIP]\n> ${data.summary}\n\n`;

  if (data.metrics) {
    output += `| Indicator | Reading |\n|---|---|\n`;
    for (const [k, v] of Object.entries(data.metrics)) {
      output += `| ${k} | ${v} |\n`;
    }
    output += `\n`;
  }

  return output;
}

function renderGenericUI(data) {
  return JSON.stringify(data, null, 2);
}
