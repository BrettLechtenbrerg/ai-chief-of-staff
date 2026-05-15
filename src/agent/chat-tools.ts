/**
 * Chat mode tool adapter
 *
 * Converts existing tool definitions to @kenkaiiii/gg-agent AgentTool format
 * and adds web_fetch / shell_command / subagent capabilities.
 * Web search is enabled via webSearch flag on AgentOptions (not a tool).
 */

import { z } from 'zod';
import type { AgentTool, ToolContext } from '@kenkaiiii/gg-agent';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createTools as createCoderTools } from '@kenkaiiii/ggcoder';
import { getCustomTools, ToolsConfig } from '../tools';
import { wrapToolHandler } from '../tools/diagnostics';
import { createSubAgentTool } from '../tools/subagent';
import { getStreamConfig } from './chat-providers';
import { validateBashCommand, validateWritePath } from './safety';

const execAsync = promisify(exec);
const IS_WINDOWS = process.platform === 'win32';
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';

/**
 * Convert a JSON Schema properties map to a Zod object schema.
 * Handles string, number, boolean, and array types; falls back to z.any().
 */
function jsonSchemaToZod(
  properties: Record<string, unknown>,
  required: string[] = []
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, value] of Object.entries(properties)) {
    const prop = value as { type?: string; items?: { type?: string }; description?: string };
    let schema: z.ZodTypeAny;

    switch (prop.type) {
      case 'string':
        schema = z.string();
        break;
      case 'number':
      case 'integer':
        schema = z.number();
        break;
      case 'boolean':
        schema = z.boolean();
        break;
      case 'array':
        if (prop.items?.type === 'string') {
          schema = z.array(z.string());
        } else if (prop.items?.type === 'number') {
          schema = z.array(z.number());
        } else {
          schema = z.array(z.any());
        }
        break;
      default:
        schema = z.any();
    }

    if (prop.description) {
      schema = schema.describe(prop.description);
    }

    if (!required.includes(key)) {
      schema = schema.optional();
    }

    shape[key] = schema;
  }

  return z.object(shape);
}

/**
 * Wrap a write/edit AgentTool so its execute() runs validateWritePath before
 * delegating to the underlying tool. Blocks writes to dangerous paths (e.g.
 * /etc, ~/.ssh, /System) and returns a string explaining the block.
 */
function wrapWithWritePathSafety(tool: AgentTool): AgentTool {
  const originalExecute = tool.execute.bind(tool);
  return {
    ...tool,
    execute: async (args: unknown, context: ToolContext) => {
      const filePath = (args as { file_path?: unknown })?.file_path;
      if (typeof filePath === 'string' && filePath.length > 0) {
        const safety = validateWritePath(filePath);
        if (!safety.allowed) {
          return `Write blocked by safety filter: ${safety.reason}`;
        }
      }
      return originalExecute(args as never, context);
    },
  } as AgentTool;
}

const WRITE_TOOL_NAMES = new Set(['write', 'edit', 'Write', 'Edit']);

/**
 * Build the AgentTool array for Chat mode.
 * Wraps each handler with diagnostics and returns AgentTool[] compatible with @kenkaiiii/gg-agent.
 */
export function getChatAgentTools(config: ToolsConfig, cwd: string): AgentTool[] {
  const customTools = getCustomTools(config);
  const tools: AgentTool[] = [];

  for (const tool of customTools) {
    const wrapped = wrapToolHandler(tool.name, tool.handler);
    const inputSchema = tool.input_schema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    const parameters = jsonSchemaToZod(inputSchema.properties || {}, inputSchema.required || []);

    tools.push({
      name: tool.name,
      description: tool.description,
      parameters,
      execute: async (args: unknown, _context: ToolContext) => {
        return await wrapped(args as Record<string, unknown>);
      },
    });
  }

  // Add file tools (read, write, edit) from gg-coder
  const { tools: coderNativeTools } = createCoderTools(cwd);
  const fileToolNames = new Set(['read', 'write', 'edit']);
  for (const t of coderNativeTools) {
    if (fileToolNames.has(t.name)) {
      tools.push(WRITE_TOOL_NAMES.has(t.name) ? wrapWithWritePathSafety(t) : t);
    }
  }

  // Add web_fetch tool
  tools.push(buildWebFetchTool());

  // Add shell_command tool
  tools.push(buildShellCommandTool());

  // Add sub-agent tool (receives parent tools so it can select a subset)
  tools.push(createSubAgentTool(tools, getStreamConfig));

  return tools;
}

/**
 * Build the AgentTool array for Coder mode.
 * Uses gg-coder native tools (read, write, edit, bash, etc.) merged with MCP tools.
 */
export function getCoderAgentTools(config: ToolsConfig, cwd: string): AgentTool[] {
  // Create gg-coder native tools
  const { tools: coderNativeTools } = createCoderTools(cwd);

  // Get MCP-wrapped tools (browser, notify, project, grep-github, switch_agent)
  const customTools = getCustomTools(config);
  const mcpTools: AgentTool[] = [];

  for (const tool of customTools) {
    const wrapped = wrapToolHandler(tool.name, tool.handler);
    const inputSchema = tool.input_schema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    const parameters = jsonSchemaToZod(inputSchema.properties || {}, inputSchema.required || []);

    mcpTools.push({
      name: tool.name,
      description: tool.description,
      parameters,
      execute: async (args: unknown, _context: ToolContext) => {
        return await wrapped(args as Record<string, unknown>);
      },
    });
  }

  // Merge: coder native tools (with write-path safety) + MCP tools
  const safeCoderTools = coderNativeTools.map((t) =>
    WRITE_TOOL_NAMES.has(t.name) ? wrapWithWritePathSafety(t) : t
  );
  return [...safeCoderTools, ...mcpTools];
}

/**
 * Custom web_fetch AgentTool — fetches a URL and returns its text content.
 */
function buildWebFetchTool(): AgentTool {
  const parameters = z.object({
    url: z.string().describe('The URL to fetch'),
    max_length: z.number().describe('Maximum characters to return (default: 10000)').optional(),
  });

  return {
    name: 'web_fetch',
    description:
      'Fetch and read content from a URL. Returns the text content of the page with HTML tags stripped. Useful for reading articles, documentation, or any web page.',
    parameters,
    execute: async (input: unknown, _context: ToolContext) => {
      const { url, max_length } = input as z.infer<typeof parameters>;
      const maxLength = max_length || 10000;

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PocketAgent/1.0)',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          return `Error: HTTP ${response.status} ${response.statusText}`;
        }

        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();

        // If it's HTML, strip tags
        let content: string;
        if (contentType.includes('html')) {
          content = text
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        } else {
          content = text;
        }

        if (content.length > maxLength) {
          content = content.slice(0, maxLength) + '\n\n[Content truncated]';
        }

        return content;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return `Error fetching ${url}: ${msg}`;
      }
    },
  };
}

/**
 * Shell command AgentTool — runs a command in the system shell and returns output.
 */
function buildShellCommandTool(): AgentTool {
  const parameters = z.object({
    command: z.string().describe('The shell command to execute'),
    timeout_ms: z
      .number()
      .describe('Timeout in milliseconds (default: 30000, max: 120000)')
      .optional(),
  });

  return {
    name: 'shell_command',
    description:
      'Execute a shell command and return its output. Use this for file operations, git commands, running scripts, system tasks, and any CLI operations. Commands run in bash (macOS/Linux) or PowerShell (Windows).',
    parameters,
    execute: async (input: unknown, _context: ToolContext) => {
      const { command, timeout_ms } = input as z.infer<typeof parameters>;
      const timeoutMs = Math.min(timeout_ms || 30000, 120000);

      const shellOpts = IS_WINDOWS
        ? { shell: 'powershell.exe' as string, env: process.env, timeout: timeoutMs }
        : {
            shell: '/bin/bash' as string,
            env: {
              ...process.env,
              PATH: `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin:${HOME_DIR}/.local/bin`,
            },
            timeout: timeoutMs,
          };

      const safety = validateBashCommand(command);
      if (!safety.allowed) {
        return `Command blocked by safety filter: ${safety.reason}`;
      }

      try {
        const { stdout, stderr } = await execAsync(command, shellOpts);
        let result = stdout || '';
        if (stderr) {
          result += (result ? '\n' : '') + `[stderr]: ${stderr}`;
        }
        // Truncate very long output
        if (result.length > 50000) {
          result = result.slice(0, 50000) + '\n\n[Output truncated at 50000 chars]';
        }
        return result || '(no output)';
      } catch (error) {
        const err = error as Error & { stdout?: string; stderr?: string; code?: number };
        let msg = `Command failed (exit code ${err.code || 'unknown'})`;
        if (err.stderr) msg += `\n[stderr]: ${err.stderr}`;
        if (err.stdout) msg += `\n[stdout]: ${err.stdout}`;
        return msg;
      }
    },
  };
}
