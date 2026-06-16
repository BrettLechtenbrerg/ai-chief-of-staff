/**
 * Shared helpers for the campaign-operations wrapper tools (campaign_*).
 *
 * Every GHL call goes through the sanctioned MCP layer (getMCPManager().
 * callTool) — never raw shell+curl (see src/config/system-guidelines.ts). The
 * GHL server may be registered as `ghl-mcp` (bundled) or `flo-ghl` /
 * `flo-ghl-brett` (Brett's hand-built entries), so we resolve it by capability
 * (does it expose `create_contact`?) rather than by name.
 */

import { getMCPManager } from '../mcp/manager';
import type { MCPToolDescriptor } from '../mcp/types';

export interface GhlServer {
  serverName: string;
  /** Unprefixed tool names this server exposes. */
  tools: Set<string>;
}

/**
 * Find the ready GHL MCP server by capability. Returns null when no connected
 * server exposes the core contact tools (i.e. GHL isn't connected).
 */
export function resolveGhlServer(): GhlServer | null {
  const all: MCPToolDescriptor[] = getMCPManager().getAllTools();
  const byServer = new Map<string, Set<string>>();
  for (const t of all) {
    if (!byServer.has(t.serverName)) byServer.set(t.serverName, new Set());
    byServer.get(t.serverName)!.add(t.toolName);
  }
  for (const [serverName, tools] of byServer) {
    if (tools.has('create_contact') && tools.has('get_contact')) {
      return { serverName, tools };
    }
  }
  return null;
}

/** Call a GHL tool through the MCP layer and parse its JSON reply (raw kept for text replies). */
export async function callGhl(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ raw: string; json: unknown }> {
  const agentToolName = `mcp__${serverName}__${toolName}`;
  const raw = await getMCPManager().callTool(agentToolName, args);
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // Some tools return plain text; keep raw for the report.
  }
  return { raw, json };
}

/** Dig a contact id out of GHL's various response shapes. */
export function extractContactId(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.id === 'string') return obj.id;
  const contact = obj.contact as Record<string, unknown> | undefined;
  if (contact && typeof contact.id === 'string') return contact.id;
  return null;
}

/** Pull the contact object out of a get_contact / create_contact response. */
export function extractContact(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  const contact = obj.contact;
  if (contact && typeof contact === 'object') return contact as Record<string, unknown>;
  if (typeof obj.id === 'string') return obj;
  return null;
}

/** True if a fetched contact carries the given tag (case-insensitive). */
export function contactHasTag(json: unknown, tag: string): boolean {
  const contact = extractContact(json) ?? (json as Record<string, unknown> | null);
  const tags = contact?.tags;
  if (!Array.isArray(tags)) return false;
  return tags.some((t) => String(t).toLowerCase() === tag.toLowerCase());
}

/**
 * Find the first array in a list-style GHL response (responses wrap the array
 * under varying keys: `contacts`, `workflows`, `campaigns`, `opportunities`,
 * `pipelines`, etc.). Returns [] when none is found.
 */
export function extractList(json: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(json)) return json as Array<Record<string, unknown>>;
  if (!json || typeof json !== 'object') return [];
  for (const v of Object.values(json as Record<string, unknown>)) {
    if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  }
  return [];
}

/**
 * Resolve a human-friendly name to an id within a list response. Matches on
 * common name/id field shapes, case-insensitive, exact-then-substring. Returns
 * null when no unambiguous match exists.
 */
export function resolveNameToId(
  list: Array<Record<string, unknown>>,
  name: string,
): string | null {
  const want = name.trim().toLowerCase();
  const nameOf = (o: Record<string, unknown>): string =>
    String(o.name ?? o.title ?? '').toLowerCase();
  const idOf = (o: Record<string, unknown>): string | null =>
    typeof o.id === 'string' ? o.id : o.id != null ? String(o.id) : null;

  const exact = list.filter((o) => nameOf(o) === want);
  if (exact.length === 1) return idOf(exact[0]);
  const partial = list.filter((o) => nameOf(o).includes(want));
  if (partial.length === 1) return idOf(partial[0]);
  return null;
}
