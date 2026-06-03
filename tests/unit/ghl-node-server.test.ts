/**
 * Unit tests for the vendored GHL Node MCP server (vendor/ghl-mcp-node/index.js).
 *
 * These prove the port maps tool params -> the correct GHL REST endpoint, HTTP
 * method, and request body/query WITHOUT making live GHL calls. We stub the
 * global `fetch` and capture what each tool handler would send. This is the
 * regression gate the plan calls for: it catches endpoint/body drift across the
 * 91-tool port (plan Risk 1).
 *
 * Parity of tool NAMES + arg names against main.py is enforced separately by the
 * extraction script; here we spot-check representative read + write mappings.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
// The server is vendored ESM with its own node_modules (the MCP SDK). Importing
// it pulls TOOLS without booting the stdio transport (the boot is guarded to the
// CLI entrypoint).
// @ts-expect-error - plain JS vendored module, no type declarations
import { TOOLS, BASE_URL } from '../../vendor/ghl-mcp-node/index.js';

interface CapturedRequest {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

const TOKEN = 'pit-test-token';
const LOCATION = 'LOC-TEST-123';

function findTool(name: string) {
  const tool = (TOOLS as Array<{ name: string; handler: (a: unknown) => Promise<string> }>).find(
    (t) => t.name === name,
  );
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

/** Run a tool handler with fetch stubbed; return the single captured request. */
async function run(name: string, args: Record<string, unknown>): Promise<CapturedRequest> {
  const captured: CapturedRequest[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    captured.push({
      url: String(url),
      method: (init?.method as string) ?? 'GET',
      body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined,
    });
    return {
      ok: true,
      status: 200,
      text: async () => '{"ok":true}',
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  await findTool(name).handler(args);
  // Most tools issue exactly one request; create_email_template issues two.
  return captured[captured.length - 1];
}

describe('ghl-node-server tool mapping', () => {
  beforeEach(() => {
    process.env.GHL_PRIVATE_TOKEN = TOKEN;
    process.env.GHL_LOCATION_ID = LOCATION;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exposes exactly 91 tools', () => {
    expect(TOOLS.length).toBe(91);
  });

  it('every tool has a name, description, inputSchema, annotations, and handler', () => {
    for (const t of TOOLS as Array<Record<string, unknown>>) {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect((t.inputSchema as { type: string }).type).toBe('object');
      expect(t.annotations).toBeTruthy();
      expect(typeof t.handler).toBe('function');
    }
  });

  it('create_contact maps fields + injects locationId; address -> address1', async () => {
    const req = await run('create_contact', {
      first_name: 'Ada',
      company_name: 'Analytical Engines',
      address: '1 Lovelace Way',
      email: 'ada@example.com',
    });
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${BASE_URL}/contacts/`);
    expect(req.body).toMatchObject({
      locationId: LOCATION,
      firstName: 'Ada',
      companyName: 'Analytical Engines',
      address1: '1 Lovelace Way',
      email: 'ada@example.com',
    });
    // snake_case input keys must NOT leak into the GHL body.
    expect(req.body).not.toHaveProperty('first_name');
    expect(req.body).not.toHaveProperty('company_name');
    expect(req.body).not.toHaveProperty('address');
  });

  it('search_opportunities uses snake_case query params incl. location_id and page', async () => {
    const req = await run('search_opportunities', {
      pipeline_id: 'PIPE1',
      stage_id: 'STAGE1',
      query: 'acme',
      limit: 10,
      page: 2,
    });
    expect(req.method).toBe('GET');
    const u = new URL(req.url);
    expect(u.pathname).toBe('/opportunities/search');
    expect(u.searchParams.get('location_id')).toBe(LOCATION);
    expect(u.searchParams.get('pipeline_id')).toBe('PIPE1');
    expect(u.searchParams.get('pipeline_stage_id')).toBe('STAGE1');
    expect(u.searchParams.get('q')).toBe('acme');
    expect(u.searchParams.get('page')).toBe('2');
  });

  it('send_message builds the conversations/messages body with contactId + locationId', async () => {
    const req = await run('send_message', {
      contact_id: 'C1',
      type: 'SMS',
      message: 'hello',
      from_number: '+14155550100',
    });
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${BASE_URL}/conversations/messages`);
    expect(req.body).toMatchObject({
      type: 'SMS',
      contactId: 'C1',
      locationId: LOCATION,
      message: 'hello',
      fromNumber: '+14155550100',
    });
  });

  it('create_invoice uses altId/altType + maps line items', async () => {
    const req = await run('create_invoice', {
      contact_id: 'C1',
      title: 'Coaching',
      items: [{ name: 'Session', amount: 9700, qty: 2 }],
      currency: 'usd',
    });
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${BASE_URL}/invoices/`);
    expect(req.body).toMatchObject({
      altId: LOCATION,
      altType: 'location',
      contactDetails: { id: 'C1' },
      title: 'Coaching',
      currency: 'USD',
      lineItems: [{ name: 'Session', amount: 9700, qty: 2 }],
    });
  });

  it('search_contacts with a tag goes through the advanced POST /contacts/search', async () => {
    const req = await run('search_contacts', { tag: 'vip', limit: 50 });
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${BASE_URL}/contacts/search`);
    expect(req.body).toMatchObject({
      locationId: LOCATION,
      filters: [{ field: 'tags', operator: 'contains', value: 'vip' }],
      pageLimit: 50,
    });
  });

  it('get_pipelines is a GET that injects locationId', async () => {
    const req = await run('get_pipelines', {});
    expect(req.method).toBe('GET');
    const u = new URL(req.url);
    expect(u.pathname).toBe('/opportunities/pipelines');
    expect(u.searchParams.get('locationId')).toBe(LOCATION);
  });

  it('delete_opportunity issues a DELETE to the right path', async () => {
    const req = await run('delete_opportunity', { opportunity_id: 'OPP9' });
    expect(req.method).toBe('DELETE');
    expect(req.url).toBe(`${BASE_URL}/opportunities/OPP9`);
  });

  it('get_appointments returns a guidance error when no calendar/user/group given', async () => {
    process.env.GHL_PRIVATE_TOKEN = TOKEN;
    process.env.GHL_LOCATION_ID = LOCATION;
    const out = await findTool('get_appointments').handler({
      start_time: '2026-01-01T00:00:00Z',
      end_time: '2026-01-02T00:00:00Z',
    });
    expect(out).toMatch(/requires exactly one of calendar_id, user_id, or group_id/);
  });

  it('surfaces a clear GHL_PRIVATE_TOKEN error string when the token is missing', async () => {
    // Faithful to main.py: the HTTP helper catches the missing-auth error and
    // returns it as a `Request error: ...` string rather than throwing, so the
    // MCP tool result carries the message instead of crashing the call.
    delete process.env.GHL_PRIVATE_TOKEN;
    vi.stubGlobal('fetch', vi.fn());
    const out = await findTool('get_pipelines').handler({});
    expect(out).toMatch(/GHL_PRIVATE_TOKEN environment variable is not set/);
    // fetch must never be reached without auth.
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
