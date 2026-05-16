/**
 * Thin wrapper around `@modelcontextprotocol/sdk`'s Client + StdioClientTransport.
 *
 * One MCPClient instance owns one connected MCP server (child process).
 * The manager (`./manager.ts`) creates one of these per entry in the user's
 * `mcp-servers.json`.
 *
 * Responsibilities:
 *  - spawn the child process via stdio transport
 *  - run the MCP initialize handshake
 *  - cache the tool list (we only re-list when the server signals a change)
 *  - call_tool and surface results as plain strings the agent can consume
 *  - clean shutdown on app quit
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ExternalMCPServerConfig, MCPToolDescriptor } from './types';

/** Status for diagnostics + UI. */
export type MCPClientStatus = 'idle' | 'starting' | 'ready' | 'failed' | 'stopped';

interface RawMCPToolListItem {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export class MCPClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private _tools: MCPToolDescriptor[] = [];
  private _status: MCPClientStatus = 'idle';
  private _lastError: string | null = null;

  constructor(
    readonly serverName: string,
    private readonly config: ExternalMCPServerConfig,
  ) {}

  get status(): MCPClientStatus {
    return this._status;
  }

  get tools(): readonly MCPToolDescriptor[] {
    return this._tools;
  }

  get lastError(): string | null {
    return this._lastError;
  }

  /**
   * Spawn the child process, run initialize, list tools. Resolves once
   * the server is ready (or rejects on any failure during startup).
   */
  async start(): Promise<void> {
    if (this._status === 'starting' || this._status === 'ready') return;
    this._status = 'starting';
    this._lastError = null;

    try {
      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        // SDK merges this onto its default-safe env (PATH, HOME, etc.)
        // so we only need to pass the extras the server requires.
        env: this.config.env,
        cwd: this.config.cwd,
        // "pipe" so we can swallow noisy stderr instead of polluting
        // the parent's terminal. Surfaced via onerror on the transport.
        stderr: 'pipe',
      });

      this.transport.onerror = (err) => {
        console.error(`[MCP ${this.serverName}] transport error:`, err.message);
      };
      this.transport.onclose = () => {
        // Server exited unexpectedly. Manager will see status='stopped'
        // and can decide whether to restart. We don't auto-restart here
        // to avoid spawn loops on a broken config.
        if (this._status === 'ready') {
          console.warn(`[MCP ${this.serverName}] server process closed`);
          this._status = 'stopped';
        }
      };

      this.client = new Client(
        { name: 'ai-chief-of-staff', version: '1.0.0' },
        { capabilities: {} },
      );

      await this.client.connect(this.transport);

      // Drain stderr so the pipe buffer doesn't fill and block the child.
      // We log a single warning line per server if any stderr arrives so
      // misconfigured servers surface in the app log without flooding it.
      const stderr = this.transport.stderr;
      if (stderr) {
        let stderrLogged = false;
        stderr.on('data', (chunk: Buffer) => {
          if (!stderrLogged) {
            console.warn(
              `[MCP ${this.serverName}] stderr: ${chunk.toString('utf8').split('\n')[0].slice(0, 200)}`,
            );
            stderrLogged = true;
          }
        });
      }

      await this.refreshTools();
      this._status = 'ready';
      console.log(
        `[MCP ${this.serverName}] ready with ${this._tools.length} tool${this._tools.length === 1 ? '' : 's'}`,
      );
    } catch (err) {
      this._status = 'failed';
      this._lastError = (err as Error).message;
      console.error(`[MCP ${this.serverName}] failed to start:`, this._lastError);
      // Best-effort cleanup so a failed server doesn't leave a zombie process.
      await this.stop().catch(() => undefined);
      throw err;
    }
  }

  /**
   * Re-query the server for its tool list. Called once during start();
   * exposed publicly so callers can refresh if a server announces changes.
   */
  async refreshTools(): Promise<void> {
    if (!this.client) throw new Error('MCPClient not connected');
    const result = await this.client.listTools();
    const items = (result.tools as RawMCPToolListItem[]) || [];
    this._tools = items.map((t) => ({
      serverName: this.serverName,
      toolName: t.name,
      agentToolName: prefixToolName(this.serverName, t.name),
      description: t.description || `${t.name} (via ${this.serverName})`,
      inputSchema: (t.inputSchema as Record<string, unknown>) || {
        type: 'object',
        properties: {},
      },
    }));
  }

  /**
   * Invoke a tool on the connected server. Returns the result content as
   * a single string suitable for sending back to the agent. Throws on
   * MCP-level errors so the caller can surface them as tool errors.
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client) throw new Error(`MCPClient '${this.serverName}' not connected`);
    if (this._status !== 'ready') throw new Error(`MCPClient '${this.serverName}' not ready (status=${this._status})`);

    const result = await this.client.callTool({ name: toolName, arguments: args });
    return stringifyToolResult(result);
  }

  /** Close the transport and reap the child process. Safe to call multiple times. */
  async stop(): Promise<void> {
    if (this._status === 'stopped' || this._status === 'idle') {
      this._status = 'stopped';
      return;
    }
    try {
      await this.client?.close();
    } catch (err) {
      console.warn(`[MCP ${this.serverName}] error during client.close():`, (err as Error).message);
    }
    try {
      await this.transport?.close();
    } catch (err) {
      console.warn(`[MCP ${this.serverName}] error during transport.close():`, (err as Error).message);
    }
    this.client = null;
    this.transport = null;
    this._status = 'stopped';
  }
}

/**
 * Prefix MCP tool names with their server alias so tools from different
 * MCP servers cannot collide (multiple servers can each expose a tool
 * called "search" etc.). Format: `mcp__<server>__<tool>`.
 *
 * The double-underscore separators are intentional — they match how
 * Claude Desktop renders MCP tool names, and keep the prefix visually
 * distinct from regular snake_case identifiers in agent logs.
 */
export function prefixToolName(serverName: string, toolName: string): string {
  const safeServer = serverName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `mcp__${safeServer}__${toolName}`;
}

/**
 * Flatten an MCP `CallToolResult` into a single string the agent loop
 * can consume. MCP results are arrays of content parts (text / image /
 * resource refs). For text we concatenate; for non-text we summarize
 * the type so the agent at least knows something came back.
 */
function stringifyToolResult(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const r = result as { content?: unknown; isError?: boolean };
  if (!Array.isArray(r.content)) return '';

  const parts: string[] = [];
  for (const item of r.content) {
    if (!item || typeof item !== 'object') continue;
    const it = item as { type?: string; text?: string };
    if (it.type === 'text' && typeof it.text === 'string') {
      parts.push(it.text);
    } else if (it.type) {
      parts.push(`[${it.type} content]`);
    }
  }

  const flat = parts.join('\n');
  if (r.isError) return `Tool error: ${flat || 'no message provided'}`;
  return flat;
}
