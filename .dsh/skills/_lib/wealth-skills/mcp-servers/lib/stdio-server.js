/**
 * Minimal zero-dependency MCP server over stdio (newline-delimited JSON-RPC 2.0).
 * Shared by the servers in this directory so protocol handling is written once.
 */

import fs from 'fs';
import readline from 'readline';
import { fileURLToPath } from 'url';

export const PROTOCOL_VERSION = '2024-11-05';

export function createMessageHandler({ name, version, tools }) {
  const toolsByName = new Map(tools.map(tool => [tool.name, tool]));

  return function handleMessage(message) {
    if (Array.isArray(message)) return errorResponse(null, -32600, 'Batch requests are not supported');
    if (message === null || typeof message !== 'object') return errorResponse(null, -32600, 'Invalid Request');

    // Notifications carry no id and must never be answered -- including notifications/initialized,
    // which every MCP client sends right after initialize.
    const isRequest = Object.prototype.hasOwnProperty.call(message, 'id');

    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return isRequest ? errorResponse(message.id, -32600, 'Invalid Request') : null;
    }
    if (!isRequest) return null;

    const { id, method, params } = message;

    switch (method) {
      case 'initialize':
        return resultResponse(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name, version }
        });
      case 'ping':
        return resultResponse(id, {});
      case 'tools/list':
        return resultResponse(id, {
          tools: tools.map(({ name: toolName, description, inputSchema }) => ({ name: toolName, description, inputSchema }))
        });
      case 'tools/call':
        return callTool(id, params);
      default:
        return errorResponse(id, -32601, `Method not found: ${method}`);
    }
  };

  function callTool(id, params) {
    const toolName = params?.name;
    if (typeof toolName !== 'string') return errorResponse(id, -32602, 'tools/call requires params.name');

    const tool = toolsByName.get(toolName);
    if (!tool) return errorResponse(id, -32602, `Unknown tool: ${toolName}`);

    const toolArgs = params.arguments ?? {};
    if (typeof toolArgs !== 'object' || toolArgs === null || Array.isArray(toolArgs)) {
      return errorResponse(id, -32602, 'params.arguments must be an object');
    }

    const problems = validateArguments(tool.inputSchema, toolArgs);
    if (problems.length > 0) {
      return errorResponse(id, -32602, `Invalid arguments for ${toolName}: ${problems.join('; ')}`);
    }

    // A throwing tool must still produce a response, or the client waits on this id forever.
    // Execution failures are reported in-band with isError, per the MCP tools specification.
    // Synchronous tools answer synchronously; a tool that returns a promise (file I/O) answers with one.
    try {
      const data = tool.handler(toolArgs);
      return data instanceof Promise
        ? data.then(value => toolResult(id, value), err => toolError(id, err))
        : toolResult(id, data);
    } catch (err) {
      return toolError(id, err);
    }
  }
}

function toolResult(id, data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return resultResponse(id, { content: [{ type: 'text', text }] });
}

function toolError(id, err) {
  // An error naming a missing input carries the question to ask, so the model can come back to
  // the user instead of guessing or giving up.
  const text = err.needsInput
    ? JSON.stringify({ error: err.message, needsInput: err.needsInput }, null, 2)
    : `Error: ${err.message}`;
  return resultResponse(id, { content: [{ type: 'text', text }], isError: true });
}

export function startStdioServer(config) {
  const handleMessage = createMessageHandler(config);
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', (line) => {
    if (!line.trim()) return;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send(errorResponse(null, -32700, 'Parse error'));
      return;
    }

    // Synchronous responses go out in order. An async tool answers when it finishes, possibly after
    // later requests; JSON-RPC ids pair each response with its request.
    const response = handleMessage(message);
    if (response instanceof Promise) response.then(send);
    else if (response) send(response);
  });
}

// True when the calling module is the process entry point. realpath on both sides so a symlinked
// path (e.g. /tmp vs /private/tmp on macOS) still matches.
export function isMainModule(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(fileURLToPath(importMetaUrl)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

function validateArguments(schema, value) {
  const problems = [];
  const properties = schema?.properties ?? {};

  for (const key of schema?.required ?? []) {
    if (value[key] === undefined || value[key] === null) problems.push(`"${key}" is required`);
  }

  for (const [key, spec] of Object.entries(properties)) {
    const v = value[key];
    if (v === undefined || v === null) continue;

    if (spec.type && !matchesType(spec.type, v)) {
      problems.push(`"${key}" must be of type ${spec.type}`);
    } else if (spec.enum && !spec.enum.includes(v)) {
      problems.push(`"${key}" must be one of ${spec.enum.join(', ')}`);
    }
  }

  return problems;
}

function matchesType(type, v) {
  switch (type) {
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return Number.isInteger(v);
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    case 'object': return typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    default: return true;
  }
}

function resultResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}
