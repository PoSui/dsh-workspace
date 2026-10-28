# Multi-Platform UI Template Specifications

Different AI platforms (Claude, OpenAI Codex / ChatGPT Canvas, Cursor, Google Antigravity, Devin) render markdown and interactive UI components differently. **`wealth-skills`** includes adaptive UI templates tailored to each platform.

---

## 1. Claude UI Template (Anthropic Artifacts & Rich Markdown)

### Unique Features Supported
- **GitHub Alerts**: `> [!NOTE]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!TIP]`, `> [!CAUTION]`.
- **Mermaid Flowchart Diagrams**: Interactive workflow visualization.
- **HTML/React Artifact Cards**: Self-contained client report cards.

### Claude Format Example
```markdown
> [!IMPORTANT]
> **Advisory Action Required**: Portfolio drift breached tolerance band (8% > 5%).

### Tax-Aware Rebalance Flowchart
```mermaid
graph TD
    A[Client Portfolio] --> B{Drift Check > 5%?}
    B -- Yes --> C[Scan Tax Lots for Losses]
    C --> D[Generate Rebalance Proposal]
    D --> E[Advisor Approval Required]
```

| Asset Class | Current % | Target % | Action |
|---|---|---|---|
| US Equities | 68% | 60% | SELL ($80,000) |
| Fixed Income | 22% | 30% | BUY ($80,000) |
```

---

## 2. OpenAI Codex & ChatGPT Canvas UI Template

### Unique Features Supported
- **LaTeX Math Rendering**: `$$...$$` block math and `\(...\)` inline math for financial formulas (Sharpe, CAGR, Monte Carlo, VaR).
- **Code Interpreter / Canvas Diffs**: Markdown tables and structured JSON schema blocks.

### Codex Format Example
```markdown
# Portfolio Return & Risk Analysis

The Sharpe ratio uses the arithmetic mean annual return:
$$
\text{Sharpe Ratio} = \frac{\bar{R}_p - R_f}{\sigma_p} = \frac{0.0882 - 0.03}{0.119} = 0.49
$$

### Backtest Performance (10-Year, 2015–2024)
| Metric | 60/40 (VTI/BND) | 100% VTI |
|---|---|---|
| CAGR | 8.18% | 12.48% |
| Volatility | 11.9% | 16.46% |
| Max Drawdown (year-end) | -16.9% | -19.5% |
```

---

## 3. Cursor & VS Code AI Extensions UI Template

### Unique Features Supported
- **Diff Code Blocks (`diff`)**: Visual `+`/`-` line additions and deletions for rebalance proposals.
- **Clickable File URIs**: `file:///path/to/file` links to workspace docs.

### Cursor Format Example
```markdown
### Rebalance Allocation Proposal

```diff
- US Equity: 68.0% ($680,000)
+ US Equity: 60.0% ($600,000)
- Fixed Income: 22.0% ($220,000)
+ Fixed Income: 30.0% ($300,000)
```

For full audit records, view [COMPLIANCE_GUIDELINES.md](COMPLIANCE_GUIDELINES.md).
```

---

## 4. Google Antigravity & Gemini UI Template

### Unique Features Supported
- **Artifact Metadata Cards**: Structured YAML/JSON metadata blocks (`auditMetadata`).
- **GitHub Alerts & GFM Tables**: Clean typography and responsive data presentation.

### Antigravity Format Example
```markdown
# Wealth Management Client Review

> [!TIP]
> About **$33,600** of Roth conversion income fits within the 22% bracket (tax year 2026, standard deduction only).

| Parameter | Reading |
|---|---|
| Adjusted Gross Income (AGI) | $210,000 |
| Estimated Taxable Income | $177,800 |
| 22% Bracket Ceiling | $211,400 |

---
auditMetadata:
  skill_pack: "wealth-planning"
  engine_function: "calculateTaxBracketHeadroom"
  data_sources:
    - "IRS Rev. Proc. 2025-32 (tax year 2026 brackets and standard deduction)"
  requires_human_approval: false
```

---

## 5. Using the Adaptive UI Engine in Code

```javascript
import { renderAdaptiveUI } from './src/engines/ui.js';

const reportData = {
  title: 'Portfolio Drift & Rebalance Report',
  summary: 'Equities drifted +8% above target threshold.',
  metrics: {
    'Portfolio Value': '$1,000,000',
    'Max Drift': '8.0%',
    'Urgency Score': '80 / 100'
  },
  mermaid: 'graph TD\n  A[Current] --> B[Target]'
};

// Render for Claude
const claudeMarkdown = renderAdaptiveUI(reportData, 'claude');

// Render for Codex
const codexMarkdown = renderAdaptiveUI(reportData, 'codex');
```
