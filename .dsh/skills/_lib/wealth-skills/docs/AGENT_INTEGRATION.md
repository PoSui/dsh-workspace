# Agent Integration Guide: Multi-Platform Support

`wealth-skills` is built to run seamlessly across all major AI agent platforms: **Anthropic Claude**, **OpenAI Codex / Copilot**, and **Google Antigravity / Gemini**.

---

## 1. Integration with Anthropic Claude (MCP & Agent Skills)

Claude supports both natural language prompt skills and executable tools via the **Model Context Protocol (MCP)**.

### A. Installing Skill Packs
Copy the desired skill directory to your Claude project context or workspace:
```bash
cp -r skills/wealth-planning/ /path/to/claude/workspace/.claude/skills/
```

### B. Configuring MCP Tools
Add the Node.js MCP servers to your `claude_desktop_config.json`, replacing the path with where you cloned the repository:
```json
{
  "mcpServers": {
    "wealth-skills": {
      "command": "node",
      "args": ["/absolute/path/to/wealth-skills/mcp-servers/universal-wealth-server/index.js"]
    }
  }
}
```

The universal server exposes every CLI capability as an MCP tool (35 tools). Registration lookups run in a second server, `sec-iapd-lookup`, which reads an SEC IAPD compilation file you download from [adviserinfo.sec.gov/compilation](https://adviserinfo.sec.gov/compilation):

```json
{
  "mcpServers": {
    "sec-iapd-lookup": {
      "command": "node",
      "args": ["/absolute/path/to/wealth-skills/mcp-servers/sec-iapd-lookup/index.js"],
      "env": { "WEALTH_SKILLS_IAPD_FEED": "/absolute/path/to/IA_FIRM_SEC_Feed_09_13_2026.xml.gz" }
    }
  }
}
```

The files are refreshed daily, so schedule the download. The server does not query FINRA BrokerCheck, whose terms of use prohibit automated access.

---

## 2. Integration with OpenAI Codex & GitHub Copilot

OpenAI Codex uses function calling schemas and system prompt instructions.

### A. System Instruction Prompt
Load the target `SKILL.md` file content into your system instructions or custom GPT/Copilot workspace settings:
```markdown
System Prompt: You are a US Wealth Management assistant equipped with `wealth-skills`.
Always enforce the compliance guidelines defined in `docs/COMPLIANCE_GUIDELINES.md`.
```

### B. Tool Schema
Each MCP tool publishes a JSON Schema `inputSchema` through `tools/list`, which can be adapted into OpenAI function-calling definitions. The servers do not publish OpenAPI documents.

---

## 3. Integration with Google Antigravity & Gemini Agent SDK

Google Antigravity uses native agent skill files located in the skills plugins folder.

### A. Registering Skills
Place skills inside your local Antigravity plugin directory:
```bash
cp -r skills/* ~/.gemini/config/plugins/wealth-skills/skills/
```

### B. Triggering Skills
Antigravity automatically indexes the `SKILL.md` header metadata. When a request matches a wealth management task (e.g. *"Perform a tax-loss harvesting review for portfolio X"*), the agent activates `skills/wealth-portfolio/SKILL.md`.
