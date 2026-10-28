#!/usr/bin/env node

/**
 * Universal MCP Server for `wealth-skills`
 * Publishes every capability in src/engines/tools.js as an MCP tool over stdio. The definitions live
 * in the engine layer so the CLI, this server and the browser assistant cannot drift apart.
 */

import { startStdioServer, isMainModule } from '../lib/stdio-server.js';
import { WEALTH_TOOLS, inputSchemaFor, runTool } from '../../src/engines/tools.js';
import { LIBRARY_VERSION } from '../../src/engines/audit.js';

export const server = {
  name: 'universal-wealth-server',
  version: LIBRARY_VERSION,
  tools: WEALTH_TOOLS.map(tool => ({
    name: tool.name,
    command: tool.command,
    description: tool.description,
    inputSchema: inputSchemaFor(tool),
    handler: (args) => runTool(tool.name, args)
  }))
};

if (isMainModule(import.meta.url)) startStdioServer(server);
