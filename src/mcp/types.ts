/**
 * External MCP server configuration.
 *
 * Shape matches Claude Desktop's `claude_desktop_config.json` exactly so
 * configs port between the two without modification.
 */
export interface ExternalMCPServerConfig {
  /** Executable to spawn (e.g. "node", "python", "npx"). */
  command: string;
  /** Command-line arguments. */
  args?: string[];
  /** Extra environment variables to inject into the child process. */
  env?: Record<string, string>;
  /** Working directory for the child process (defaults to inherit). */
  cwd?: string;
  /** Optional: disable a server without removing it from the config. */
  disabled?: boolean;
  /** Optional: skip listing this server in any UI (still loads). */
  hidden?: boolean;
}

/**
 * File shape for `mcp-servers.json` in the user data directory.
 */
export interface ExternalMCPServersFile {
  mcpServers: Record<string, ExternalMCPServerConfig>;
}

export interface MCPToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Description of a tool exposed by a connected MCP server.
 * Captured at server startup via the MCP `list_tools` call.
 */
export interface MCPToolDescriptor {
  /** Server alias the tool belongs to (e.g. "flo-gmail"). */
  serverName: string;
  /** Original tool name from the MCP server. */
  toolName: string;
  /** Tool name as exposed to the agent (prefixed to prevent collisions). */
  agentToolName: string;
  /** Description string from the MCP server. */
  description: string;
  /** Raw JSON schema for the tool's input. Passed through to the agent verbatim. */
  inputSchema: Record<string, unknown>;
  /** Server-provided hints retained for policy classification, never trusted as grants. */
  annotations?: MCPToolAnnotations;
}
