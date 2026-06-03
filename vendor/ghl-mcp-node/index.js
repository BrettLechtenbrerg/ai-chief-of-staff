#!/usr/bin/env node
/**
 * GoHighLevel MCP Server (Sub-Account) — Node ESM port.
 *
 * Hand-maintained port of vendor/ghl-mcp/main.py. Same 91 tools, same GHL REST
 * contract (BASE_URL, Version header, Bearer auth, locationId injection, 25k
 * truncation on GETs, `HTTP <code>: <body[:500]>` error passthrough).
 *
 * Spawned via Electron's bundled Node (ELECTRON_RUN_AS_NODE=1), mirroring the
 * vendored Flo MCP servers — no Python runtime required, works on macOS +
 * Windows. Credentials come from env: GHL_PRIVATE_TOKEN, GHL_LOCATION_ID.
 *
 * Tool names + argument names match main.py exactly so the agent sees the
 * identical tool surface. Do not edit ad hoc — keep in lockstep with main.py
 * and re-run the parity check in tests/unit/ghl-node-server.test.ts.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// ── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const CHARACTER_LIMIT = 25000;
const REQUEST_TIMEOUT_MS = 30000;

// ── Auth ─────────────────────────────────────────────────────────────────────

function headers() {
  const token = process.env.GHL_PRIVATE_TOKEN;
  if (!token) {
    throw new Error('GHL_PRIVATE_TOKEN environment variable is not set.');
  }
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Version: API_VERSION,
  };
}

function loc() {
  const value = process.env.GHL_LOCATION_ID;
  if (!value) {
    throw new Error('GHL_LOCATION_ID environment variable is not set.');
  }
  return value;
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function truncate(text) {
  if (text.length > CHARACTER_LIMIT) {
    return text.slice(0, CHARACTER_LIMIT) + '\n\n[Truncated — use filters to narrow results]';
  }
  return text;
}

/** Build a URL with query params, dropping null/undefined values. */
function withParams(url, params) {
  if (!params) return url;
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) usp.append(key, String(v));
    } else {
      usp.append(key, String(value));
    }
  }
  const qs = usp.toString();
  return qs ? `${url}?${qs}` : url;
}

async function httpGet(url, params) {
  try {
    const resp = await fetch(withParams(url, params), {
      method: 'GET',
      headers: headers(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await resp.text();
    if (!resp.ok) return `HTTP ${resp.status}: ${text.slice(0, 500)}`;
    return truncate(text);
  } catch (err) {
    return `Request error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function httpSend(method, url, body) {
  try {
    const resp = await fetch(url, {
      method,
      headers: headers(),
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await resp.text();
    if (!resp.ok) return `HTTP ${resp.status}: ${text.slice(0, 500)}`;
    if (method === 'DELETE') return text || '{"success": true}';
    return text;
  } catch (err) {
    return `Request error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

const httpPost = (url, body) => httpSend('POST', url, body);
const httpPut = (url, body) => httpSend('PUT', url, body);
const httpDelete = (url) => httpSend('DELETE', url, undefined);

/** Annotation presets mirroring main.py's @mcp.tool(annotations=...). */
const RO = { readOnlyHint: true, openWorldHint: true };
const RW = { readOnlyHint: false, openWorldHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

// JSON-Schema fragment helpers (Flo declares inputSchema as inline JSON Schema).
const S = {
  str: (description) => ({ type: 'string', description }),
  num: (description) => ({ type: 'number', description }),
  int: (description) => ({ type: 'integer', description }),
  strArr: (description) => ({ type: 'array', items: { type: 'string' }, description }),
  objArr: (description) => ({ type: 'array', items: { type: 'object' }, description }),
};

function schema(properties, required) {
  const inputSchema = { type: 'object', properties };
  if (required && required.length) inputSchema.required = required;
  return inputSchema;
}

// ════════════════════════════════════════════════════════════════════════════
// TOOLS — ported 1:1 from main.py. Each: { name, description, inputSchema,
// annotations, handler(args) => string }.
// ════════════════════════════════════════════════════════════════════════════

const TOOLS = [
  // ── Contacts ───────────────────────────────────────────────────────────────
  {
    name: 'search_contacts',
    description:
      'Search contacts in the GHL sub-account. Supports full-text search and filters.',
    annotations: RO,
    inputSchema: schema({
      query: S.str('Full-text search across name, email, phone'),
      email: S.str('Filter by exact email'),
      phone: S.str('Filter by phone number'),
      tag: S.str('Filter by tag name'),
      limit: S.int('Number of results (max 100)'),
      page: S.int('1-indexed page number'),
    }),
    handler: async (a) => {
      const limit = a.limit ?? 25;
      const page = a.page ?? 1;
      if (a.tag) {
        const body = {
          locationId: loc(),
          filters: [{ field: 'tags', operator: 'contains', value: a.tag }],
          pageLimit: Math.min(limit, 100),
          page,
        };
        if (a.query) body.query = a.query;
        return httpPost(`${BASE_URL}/contacts/search`, body);
      }
      const params = { locationId: loc(), limit, page };
      if (a.query) params.query = a.query;
      if (a.email) params.email = a.email;
      if (a.phone) params.phone = a.phone;
      return httpGet(`${BASE_URL}/contacts/`, params);
    },
  },
  {
    name: 'get_contact',
    description:
      'Get full contact details including notes, tags, custom fields, and activity.',
    annotations: RO,
    inputSchema: schema({ contact_id: S.str('Contact ID') }, ['contact_id']),
    handler: async (a) => httpGet(`${BASE_URL}/contacts/${a.contact_id}`),
  },
  {
    name: 'create_contact',
    description: 'Create a new contact in the sub-account.',
    annotations: RW,
    inputSchema: schema(
      {
        first_name: S.str('Contact first name'),
        last_name: S.str('Contact last name'),
        email: S.str('Email address'),
        phone: S.str('Phone in E.164 format (e.g. +14155552671)'),
        company_name: S.str('Company or organization name'),
        tags: S.strArr('List of tag strings to apply'),
        source: S.str('Lead source (e.g. "website", "referral", "cold outreach")'),
        address: S.str('Street address'),
        city: S.str('City'),
        state: S.str('State/province'),
        country: S.str('Country code (e.g. "US")'),
        website: S.str('Website URL'),
      },
      ['first_name'],
    ),
    handler: async (a) => {
      const body = { locationId: loc(), firstName: a.first_name };
      if (a.last_name) body.lastName = a.last_name;
      if (a.email) body.email = a.email;
      if (a.phone) body.phone = a.phone;
      if (a.company_name) body.companyName = a.company_name;
      if (a.tags) body.tags = a.tags;
      if (a.source) body.source = a.source;
      if (a.address) body.address1 = a.address;
      if (a.city) body.city = a.city;
      if (a.state) body.state = a.state;
      if (a.country) body.country = a.country;
      if (a.website) body.website = a.website;
      return httpPost(`${BASE_URL}/contacts/`, body);
    },
  },
  {
    name: 'update_contact',
    description: 'Update an existing contact. Only provided fields will be changed.',
    annotations: RW,
    inputSchema: schema(
      {
        contact_id: S.str('Contact ID to update'),
        first_name: S.str('New first name'),
        last_name: S.str('New last name'),
        email: S.str('New email address'),
        phone: S.str('New phone in E.164 format'),
        company_name: S.str('New company name'),
        tags: S.strArr('Replace all tags with this list'),
        address: S.str('New street address'),
        city: S.str('New city'),
        state: S.str('New state/province'),
        country: S.str('New country code'),
        website: S.str('New website URL'),
      },
      ['contact_id'],
    ),
    handler: async (a) => {
      const body = {};
      if (a.first_name) body.firstName = a.first_name;
      if (a.last_name) body.lastName = a.last_name;
      if (a.email) body.email = a.email;
      if (a.phone) body.phone = a.phone;
      if (a.company_name) body.companyName = a.company_name;
      if (a.tags !== undefined && a.tags !== null) body.tags = a.tags;
      if (a.address) body.address1 = a.address;
      if (a.city) body.city = a.city;
      if (a.state) body.state = a.state;
      if (a.country) body.country = a.country;
      if (a.website) body.website = a.website;
      return httpPut(`${BASE_URL}/contacts/${a.contact_id}`, body);
    },
  },
  {
    name: 'get_contact_notes',
    description: 'Get all notes for a contact.',
    annotations: RO,
    inputSchema: schema({ contact_id: S.str('Contact ID') }, ['contact_id']),
    handler: async (a) => httpGet(`${BASE_URL}/contacts/${a.contact_id}/notes`),
  },
  {
    name: 'add_contact_note',
    description: 'Add a note to a contact.',
    annotations: RW,
    inputSchema: schema(
      { contact_id: S.str('Contact ID'), note: S.str('Note text content') },
      ['contact_id', 'note'],
    ),
    handler: async (a) => httpPost(`${BASE_URL}/contacts/${a.contact_id}/notes`, { body: a.note }),
  },
  {
    name: 'add_contact_tags',
    description: 'Add one or more tags to a contact.',
    annotations: RW,
    inputSchema: schema(
      {
        contact_id: S.str('Contact ID'),
        tags: S.strArr('List of tag strings to add (e.g. ["vip", "lead", "follow-up"])'),
      },
      ['contact_id', 'tags'],
    ),
    handler: async (a) => httpPost(`${BASE_URL}/contacts/${a.contact_id}/tags`, { tags: a.tags }),
  },

  // ── Conversations ────────────────────────────────────────────────────────────
  {
    name: 'search_conversations',
    description: 'Search conversations in the sub-account.',
    annotations: RO,
    inputSchema: schema({
      contact_id: S.str("Filter to a specific contact's conversations"),
      query: S.str('Search query across conversation content'),
      assigned_to: S.str('Filter by assigned user ID'),
      status: S.str('Filter by status — "open", "read", "unread", "starred", "recents"'),
      limit: S.int('Number of results (max 100)'),
      last_id: S.str('Last conversation ID from previous page (for pagination)'),
    }),
    handler: async (a) => {
      const params = { locationId: loc(), limit: a.limit ?? 25 };
      if (a.contact_id) params.contactId = a.contact_id;
      if (a.query) params.query = a.query;
      if (a.assigned_to) params.assignedTo = a.assigned_to;
      if (a.status) params.status = a.status;
      if (a.last_id) params.lastId = a.last_id;
      return httpGet(`${BASE_URL}/conversations/search`, params);
    },
  },
  {
    name: 'get_conversation',
    description: 'Get full details for a specific conversation.',
    annotations: RO,
    inputSchema: schema({ conversation_id: S.str('Conversation ID') }, ['conversation_id']),
    handler: async (a) => httpGet(`${BASE_URL}/conversations/${a.conversation_id}`),
  },
  {
    name: 'get_messages',
    description: 'Get messages in a conversation, newest first.',
    annotations: RO,
    inputSchema: schema(
      {
        conversation_id: S.str('Conversation ID'),
        limit: S.int('Number of messages to return (max 100)'),
        last_id: S.str('Last message ID from previous page (for pagination)'),
      },
      ['conversation_id'],
    ),
    handler: async (a) => {
      const params = { limit: a.limit ?? 25 };
      if (a.last_id) params.lastId = a.last_id;
      return httpGet(`${BASE_URL}/conversations/${a.conversation_id}/messages`, params);
    },
  },
  {
    name: 'send_message',
    description: 'Send a message to a contact via SMS, email, or other channel.',
    annotations: RW,
    inputSchema: schema(
      {
        contact_id: S.str('Contact ID to message'),
        type: S.str('Channel — "SMS", "Email", "WhatsApp", "GMB", "IG", "FB"'),
        message: S.str('Plain text message body'),
        from_number: S.str('Sender phone number for SMS (E.164 format)'),
        subject: S.str('Email subject line (Email only)'),
        html: S.str('HTML email body (Email only, optional)'),
        scheduled_timestamp: S.int('Unix timestamp (seconds) to schedule delivery'),
      },
      ['contact_id', 'type', 'message'],
    ),
    handler: async (a) => {
      const body = {
        type: a.type,
        contactId: a.contact_id,
        locationId: loc(),
        message: a.message,
      };
      if (a.from_number) body.fromNumber = a.from_number;
      if (a.subject) body.subject = a.subject;
      if (a.html) body.html = a.html;
      if (a.scheduled_timestamp) body.scheduledTimestamp = a.scheduled_timestamp;
      return httpPost(`${BASE_URL}/conversations/messages`, body);
    },
  },

  // ── Pipelines & Opportunities ────────────────────────────────────────────────
  {
    name: 'get_pipelines',
    description: 'Get all sales pipelines and their stages in the sub-account.',
    annotations: RO,
    inputSchema: schema({}),
    handler: async () => httpGet(`${BASE_URL}/opportunities/pipelines`, { locationId: loc() }),
  },
  {
    name: 'search_opportunities',
    description:
      'Search opportunities (deals) across all pipelines, or filtered to one. pipeline_id is OPTIONAL — omit it to search every pipeline in the location.',
    annotations: RO,
    inputSchema: schema({
      pipeline_id: S.str('(optional) Filter by pipeline ID'),
      stage_id: S.str('Filter by pipeline stage ID'),
      contact_id: S.str('Filter by associated contact'),
      assigned_to: S.str('Filter by assigned user ID'),
      status: S.str('Filter by status — "open", "won", "lost", "abandoned"'),
      query: S.str('Search query'),
      limit: S.int('Number of results (max 100)'),
      page: S.int('1-indexed page number for pagination'),
    }),
    handler: async (a) => {
      const params = { location_id: loc(), limit: a.limit ?? 25, page: a.page ?? 1 };
      if (a.pipeline_id) params.pipeline_id = a.pipeline_id;
      if (a.stage_id) params.pipeline_stage_id = a.stage_id;
      if (a.contact_id) params.contact_id = a.contact_id;
      if (a.assigned_to) params.assigned_to = a.assigned_to;
      if (a.status) params.status = a.status;
      if (a.query) params.q = a.query;
      return httpGet(`${BASE_URL}/opportunities/search`, params);
    },
  },
  {
    name: 'get_opportunity',
    description: 'Get full details for a specific opportunity.',
    annotations: RO,
    inputSchema: schema({ opportunity_id: S.str('Opportunity ID') }, ['opportunity_id']),
    handler: async (a) => httpGet(`${BASE_URL}/opportunities/${a.opportunity_id}`),
  },
  {
    name: 'create_opportunity',
    description: 'Create a new opportunity (deal) in a pipeline.',
    annotations: RW,
    inputSchema: schema(
      {
        pipeline_id: S.str('Pipeline ID (get from get_pipelines)'),
        stage_id: S.str('Pipeline stage ID'),
        contact_id: S.str('Associated contact ID'),
        name: S.str('Opportunity name/title'),
        status: S.str('"open", "won", "lost", or "abandoned" (default: "open")'),
        monetary_value: S.num('Deal value in dollars'),
        assigned_to: S.str('User ID to assign the deal to'),
        close_date: S.str('Expected close date in ISO 8601 (e.g. "2025-12-31")'),
      },
      ['pipeline_id', 'stage_id', 'contact_id', 'name'],
    ),
    handler: async (a) => {
      const body = {
        pipelineId: a.pipeline_id,
        locationId: loc(),
        name: a.name,
        pipelineStageId: a.stage_id,
        status: a.status ?? 'open',
        contactId: a.contact_id,
      };
      if (a.monetary_value !== undefined && a.monetary_value !== null) body.monetaryValue = a.monetary_value;
      if (a.assigned_to) body.assignedTo = a.assigned_to;
      if (a.close_date) body.closeDate = a.close_date;
      return httpPost(`${BASE_URL}/opportunities/`, body);
    },
  },
  {
    name: 'update_opportunity',
    description: 'Update an existing opportunity. Only provided fields will be changed.',
    annotations: RW,
    inputSchema: schema(
      {
        opportunity_id: S.str('Opportunity ID to update'),
        name: S.str('New name'),
        status: S.str('New status — "open", "won", "lost", "abandoned"'),
        stage_id: S.str('New pipeline stage ID'),
        monetary_value: S.num('New deal value in dollars'),
        assigned_to: S.str('New assigned user ID'),
        close_date: S.str('New expected close date (ISO 8601)'),
      },
      ['opportunity_id'],
    ),
    handler: async (a) => {
      const body = {};
      if (a.name) body.name = a.name;
      if (a.status) body.status = a.status;
      if (a.stage_id) body.pipelineStageId = a.stage_id;
      if (a.monetary_value !== undefined && a.monetary_value !== null) body.monetaryValue = a.monetary_value;
      if (a.assigned_to) body.assignedTo = a.assigned_to;
      if (a.close_date) body.closeDate = a.close_date;
      return httpPut(`${BASE_URL}/opportunities/${a.opportunity_id}`, body);
    },
  },
  {
    name: 'delete_opportunity',
    description: 'Permanently delete an opportunity. This cannot be undone.',
    annotations: DESTRUCTIVE,
    inputSchema: schema({ opportunity_id: S.str('Opportunity ID to delete') }, ['opportunity_id']),
    handler: async (a) => httpDelete(`${BASE_URL}/opportunities/${a.opportunity_id}`),
  },

  // ── Calendar & Appointments ──────────────────────────────────────────────────
  {
    name: 'get_calendars',
    description: 'List all calendars in the sub-account.',
    annotations: RO,
    inputSchema: schema({}),
    handler: async () => httpGet(`${BASE_URL}/calendars/`, { locationId: loc() }),
  },
  {
    name: 'get_appointments',
    description:
      "Get appointments/bookings in the sub-account within a date range. Requires start_time + end_time AND exactly one of (calendar_id, user_id, group_id).",
    annotations: RO,
    inputSchema: schema(
      {
        start_time: S.str('Start of date range, required. ISO 8601 or epoch-millis string.'),
        end_time: S.str('End of date range, required. Same format as start_time.'),
        calendar_id: S.str('Specific calendar to query (mutually exclusive with user_id and group_id).'),
        user_id: S.str('Specific user whose appointments to list across every calendar they own.'),
        group_id: S.str('Specific calendar group to query.'),
      },
      ['start_time', 'end_time'],
    ),
    handler: async (a) => {
      if (!(a.calendar_id || a.user_id || a.group_id)) {
        return (
          'Error: get_appointments requires exactly one of calendar_id, ' +
          'user_id, or group_id. Call get_calendars to discover calendar IDs.'
        );
      }
      const params = { locationId: loc(), startTime: a.start_time, endTime: a.end_time };
      if (a.calendar_id) params.calendarId = a.calendar_id;
      if (a.user_id) params.userId = a.user_id;
      if (a.group_id) params.groupId = a.group_id;
      return httpGet(`${BASE_URL}/calendars/events`, params);
    },
  },
  {
    name: 'create_appointment',
    description: 'Create a new appointment/booking.',
    annotations: RW,
    inputSchema: schema(
      {
        calendar_id: S.str('Calendar ID (get from get_calendars)'),
        contact_id: S.str('Contact ID'),
        start_time: S.str('Start datetime in ISO 8601 (e.g. "2025-12-31T10:00:00-05:00")'),
        end_time: S.str('End datetime in ISO 8601'),
        title: S.str('Appointment title/description'),
        notes: S.str('Internal notes for the appointment'),
        assigned_user_id: S.str('User ID to assign appointment to'),
      },
      ['calendar_id', 'contact_id', 'start_time', 'end_time'],
    ),
    handler: async (a) => {
      const body = {
        calendarId: a.calendar_id,
        locationId: loc(),
        contactId: a.contact_id,
        startTime: a.start_time,
        endTime: a.end_time,
      };
      if (a.title) body.title = a.title;
      if (a.notes) body.notes = a.notes;
      if (a.assigned_user_id) body.assignedUserId = a.assigned_user_id;
      return httpPost(`${BASE_URL}/calendars/events/appointments`, body);
    },
  },
  {
    name: 'delete_appointment',
    description: 'Delete a calendar appointment. This cannot be undone.',
    annotations: DESTRUCTIVE,
    inputSchema: schema({ event_id: S.str('Calendar event/appointment ID') }, ['event_id']),
    handler: async (a) => httpDelete(`${BASE_URL}/calendars/events/${a.event_id}`),
  },

  // ── Users ────────────────────────────────────────────────────────────────────
  {
    name: 'get_users',
    description: 'Get all users (team members) in the sub-account.',
    annotations: RO,
    inputSchema: schema({}),
    handler: async () => httpGet(`${BASE_URL}/users/`, { locationId: loc() }),
  },

  // ── Custom Fields ────────────────────────────────────────────────────────────
  {
    name: 'get_custom_fields',
    description: 'Get all custom fields defined in the sub-account.',
    annotations: RO,
    inputSchema: schema({}),
    handler: async () => httpGet(`${BASE_URL}/locations/${loc()}/customFields`),
  },

  // ── Tags ─────────────────────────────────────────────────────────────────────
  {
    name: 'get_tags',
    description: 'Get all tags defined in the sub-account.',
    annotations: RO,
    inputSchema: schema({}),
    handler: async () => httpGet(`${BASE_URL}/locations/${loc()}/tags`),
  },

  // ── Email Templates ──────────────────────────────────────────────────────────
  {
    name: 'list_email_templates',
    description: 'List all email templates in the sub-account.',
    annotations: RO,
    inputSchema: schema({
      limit: S.int('Number of results (max 100)'),
      page: S.int('1-indexed page number'),
      type: S.str('Template type filter — "html" or "unlayer"'),
    }),
    handler: async (a) => {
      const params = { locationId: loc(), limit: a.limit ?? 25, page: a.page ?? 1 };
      if (a.type) params.type = a.type;
      return httpGet(`${BASE_URL}/emails/builder`, params);
    },
  },
  {
    name: 'get_email_template',
    description: 'Get a specific email template by ID.',
    annotations: RO,
    inputSchema: schema({ template_id: S.str('Email template ID') }, ['template_id']),
    handler: async (a) => httpGet(`${BASE_URL}/emails/builder/${a.template_id}`),
  },
  {
    name: 'create_email_template',
    description: 'Create a new HTML email template and save its content.',
    annotations: RW,
    inputSchema: schema(
      {
        title: S.str('Template name/title'),
        html: S.str('Full HTML content of the email'),
        preview_text: S.str('Preview/preheader text shown in inbox'),
      },
      ['title', 'html'],
    ),
    handler: async (a) => {
      const location = loc();
      const createBody = { locationId: location, title: a.title, name: a.title, type: 'html' };
      const createResult = await httpPost(`${BASE_URL}/emails/builder`, createBody);
      let templateId;
      try {
        const data = JSON.parse(createResult);
        templateId = data.redirect || data.id;
      } catch {
        return createResult;
      }
      if (!templateId) return createResult;
      const saveBody = {
        locationId: location,
        templateId,
        updatedBy: location,
        html: a.html,
        editorType: 'html',
        dnd: { elements: [], attrs: {}, templateSettings: {} },
      };
      if (a.preview_text) saveBody.previewText = a.preview_text;
      return httpPost(`${BASE_URL}/emails/builder/data`, saveBody);
    },
  },
  {
    name: 'update_email_template',
    description: 'Update the HTML content of an existing email template.',
    annotations: RW,
    inputSchema: schema(
      {
        template_id: S.str('Email template ID to update'),
        html: S.str('New HTML content for the template'),
        preview_text: S.str('New preview/preheader text shown in inbox'),
      },
      ['template_id', 'html'],
    ),
    handler: async (a) => {
      const location = loc();
      const body = {
        locationId: location,
        templateId: a.template_id,
        updatedBy: location,
        html: a.html,
        editorType: 'html',
        dnd: { elements: [], attrs: {}, templateSettings: {} },
      };
      if (a.preview_text) body.previewText = a.preview_text;
      return httpPost(`${BASE_URL}/emails/builder/data`, body);
    },
  },
  {
    name: 'delete_email_template',
    description: 'Permanently delete an email template. This cannot be undone.',
    annotations: DESTRUCTIVE,
    inputSchema: schema({ template_id: S.str('Email template ID to delete') }, ['template_id']),
    handler: async (a) => httpDelete(`${BASE_URL}/emails/builder/${a.template_id}`),
  },

  // ── Email Marketing Campaigns ────────────────────────────────────────────────
  {
    name: 'list_campaigns',
    description: 'List email marketing campaigns (broadcasts).',
    annotations: RO,
    inputSchema: schema({
      status: S.str('Filter by status — "draft", "scheduled", "sent", "archived"'),
      limit: S.int('Number of results (max 100)'),
      page: S.int('1-indexed page number'),
    }),
    handler: async (a) => {
      const params = { locationId: loc(), limit: a.limit ?? 25, page: a.page ?? 1 };
      if (a.status) params.status = a.status;
      return httpGet(`${BASE_URL}/email-marketing/campaigns`, params);
    },
  },
  {
    name: 'get_campaign',
    description: 'Get full details for a specific email marketing campaign.',
    annotations: RO,
    inputSchema: schema({ campaign_id: S.str('Campaign ID') }, ['campaign_id']),
    handler: async (a) => httpGet(`${BASE_URL}/email-marketing/campaigns/${a.campaign_id}`),
  },
  {
    name: 'create_campaign',
    description: 'Create a new email marketing campaign (broadcast).',
    annotations: RW,
    inputSchema: schema(
      {
        name: S.str('Internal campaign name (not shown to recipients)'),
        subject: S.str('Email subject line'),
        from_name: S.str('Sender display name'),
        from_email: S.str('Sender email address'),
        template_id: S.str('ID of an existing email template to use'),
        html: S.str('Raw HTML content — use this if not providing a template_id'),
        reply_to: S.str('Reply-to email address (defaults to from_email if omitted)'),
      },
      ['name', 'subject', 'from_name', 'from_email'],
    ),
    handler: async (a) => {
      const body = {
        locationId: loc(),
        name: a.name,
        subject: a.subject,
        sender: { name: a.from_name, email: a.from_email },
      };
      if (a.template_id) body.templateId = a.template_id;
      if (a.html) body.html = a.html;
      if (a.reply_to) body.replyTo = a.reply_to;
      return httpPost(`${BASE_URL}/email-marketing/campaigns`, body);
    },
  },
  {
    name: 'update_campaign',
    description: 'Update an existing email marketing campaign. Only provided fields will be changed.',
    annotations: RW,
    inputSchema: schema(
      {
        campaign_id: S.str('Campaign ID to update'),
        name: S.str('New internal campaign name'),
        subject: S.str('New subject line'),
        from_name: S.str('New sender display name'),
        from_email: S.str('New sender email address'),
        template_id: S.str('New template ID to use'),
        html: S.str('New raw HTML content'),
        reply_to: S.str('New reply-to email address'),
      },
      ['campaign_id'],
    ),
    handler: async (a) => {
      const body = {};
      if (a.name) body.name = a.name;
      if (a.subject) body.subject = a.subject;
      if (a.from_name || a.from_email) {
        body.sender = {};
        if (a.from_name) body.sender.name = a.from_name;
        if (a.from_email) body.sender.email = a.from_email;
      }
      if (a.template_id) body.templateId = a.template_id;
      if (a.html) body.html = a.html;
      if (a.reply_to) body.replyTo = a.reply_to;
      return httpPut(`${BASE_URL}/email-marketing/campaigns/${a.campaign_id}`, body);
    },
  },
  {
    name: 'schedule_campaign',
    description: 'Schedule an email campaign to send at a future date and time.',
    annotations: RW,
    inputSchema: schema(
      {
        campaign_id: S.str('Campaign ID to schedule (must be in draft status)'),
        scheduled_at: S.str('ISO 8601 datetime to send (e.g. "2026-03-01T10:00:00-05:00")'),
      },
      ['campaign_id', 'scheduled_at'],
    ),
    handler: async (a) =>
      httpPost(`${BASE_URL}/email-marketing/campaigns/${a.campaign_id}/schedule`, {
        scheduledAt: a.scheduled_at,
      }),
  },
  {
    name: 'send_campaign_now',
    description: 'Immediately send an email campaign (no scheduling — sends right now).',
    annotations: RW,
    inputSchema: schema(
      { campaign_id: S.str('Campaign ID to send (must be in draft status)') },
      ['campaign_id'],
    ),
    handler: async (a) =>
      httpPost(`${BASE_URL}/email-marketing/campaigns/${a.campaign_id}/send`, {}),
  },
  {
    name: 'delete_campaign',
    description: 'Permanently delete an email campaign. This cannot be undone.',
    annotations: DESTRUCTIVE,
    inputSchema: schema({ campaign_id: S.str('Campaign ID to delete') }, ['campaign_id']),
    handler: async (a) => httpDelete(`${BASE_URL}/email-marketing/campaigns/${a.campaign_id}`),
  },

  // ── Workflows ───────────────────────────────────────────────────────────────
  {
    name: 'list_workflows',
    description: 'List all automation workflows in the sub-account.',
    annotations: RO,
    inputSchema: schema({ status: S.str('Filter by status — "draft", "published"') }),
    handler: async (a) => {
      const params = { locationId: loc() };
      if (a.status) params.status = a.status;
      return httpGet(`${BASE_URL}/workflows/`, params);
    },
  },
  {
    name: 'add_contact_to_workflow',
    description: 'Add a contact to an automation workflow.',
    annotations: RW,
    inputSchema: schema(
      {
        workflow_id: S.str('Workflow ID (get from list_workflows)'),
        contact_id: S.str('Contact ID to enroll'),
        event_start_time: S.str('ISO 8601 datetime to start the workflow (defaults to now)'),
      },
      ['workflow_id', 'contact_id'],
    ),
    handler: async (a) => {
      const body = { contactId: a.contact_id };
      if (a.event_start_time) body.eventStartTime = a.event_start_time;
      return httpPost(`${BASE_URL}/contacts/${a.contact_id}/workflow/${a.workflow_id}`, body);
    },
  },

  // ── Funnels & Landing Pages ──────────────────────────────────────────────────
  {
    name: 'list_funnels',
    description: 'List all funnels and landing pages in the sub-account.',
    annotations: RO,
    inputSchema: schema({
      type: S.str('Filter by type — "funnel" or "website"'),
      limit: S.int('Number of results (max 100)'),
      page: S.int('1-indexed page number'),
    }),
    handler: async (a) => {
      const params = { locationId: loc(), limit: a.limit ?? 25, page: a.page ?? 1 };
      if (a.type) params.type = a.type;
      return httpGet(`${BASE_URL}/funnels/funnel/list`, params);
    },
  },
  {
    name: 'list_funnel_pages',
    description: 'List all pages within a specific funnel.',
    annotations: RO,
    inputSchema: schema(
      {
        funnel_id: S.str('Funnel ID (get from list_funnels)'),
        limit: S.int('Number of results (max 20)'),
        offset: S.int('Offset for pagination'),
      },
      ['funnel_id'],
    ),
    handler: async (a) =>
      httpGet(`${BASE_URL}/funnels/page`, {
        locationId: loc(),
        funnelId: a.funnel_id,
        limit: a.limit ?? 20,
        offset: a.offset ?? 0,
      }),
  },

  // ── Forms ───────────────────────────────────────────────────────────────
  {
    name: 'list_forms',
    description: 'List all forms in the sub-account.',
    annotations: RO,
    inputSchema: schema({
      limit: S.int('Number of results (max 100)'),
      page: S.int('1-indexed page number'),
    }),
    handler: async (a) =>
      httpGet(`${BASE_URL}/forms/`, { locationId: loc(), limit: a.limit ?? 25, page: a.page ?? 1 }),
  },
  {
    name: 'get_form_submissions',
    description: 'Get form submission data.',
    annotations: RO,
    inputSchema: schema({
      form_id: S.str('Filter to a specific form ID (optional — returns all if omitted)'),
      limit: S.int('Number of results (max 100)'),
      page: S.int('1-indexed page number'),
      start_at: S.str('Filter submissions after this date (ISO 8601)'),
      end_at: S.str('Filter submissions before this date (ISO 8601)'),
    }),
    handler: async (a) => {
      const params = { locationId: loc(), limit: a.limit ?? 25, page: a.page ?? 1 };
      if (a.form_id) params.formId = a.form_id;
      if (a.start_at) params.startAt = a.start_at;
      if (a.end_at) params.endAt = a.end_at;
      return httpGet(`${BASE_URL}/forms/submissions`, params);
    },
  },

  // ── Surveys ────────────────────────────────────────────────────────────
  {
    name: 'list_surveys',
    description: 'List all surveys in the sub-account.',
    annotations: RO,
    inputSchema: schema({
      limit: S.int('Number of results (max 100)'),
      page: S.int('1-indexed page number'),
    }),
    handler: async (a) =>
      httpGet(`${BASE_URL}/surveys/`, { locationId: loc(), limit: a.limit ?? 25, page: a.page ?? 1 }),
  },
  {
    name: 'get_survey_submissions',
    description: 'Get survey submission data.',
    annotations: RO,
    inputSchema: schema({
      survey_id: S.str('Filter to a specific survey ID (optional)'),
      limit: S.int('Number of results (max 100)'),
      page: S.int('1-indexed page number'),
      start_at: S.str('Filter submissions after this date (ISO 8601)'),
      end_at: S.str('Filter submissions before this date (ISO 8601)'),
    }),
    handler: async (a) => {
      const params = { locationId: loc(), limit: a.limit ?? 25, page: a.page ?? 1 };
      if (a.survey_id) params.surveyId = a.survey_id;
      if (a.start_at) params.startAt = a.start_at;
      if (a.end_at) params.endAt = a.end_at;
      return httpGet(`${BASE_URL}/surveys/submissions`, params);
    },
  },

  // ── Blog ───────────────────────────────────────────────────────────────
  {
    name: 'list_blog_posts',
    description: 'List all blog posts in the sub-account.',
    annotations: RO,
    inputSchema: schema({
      limit: S.int('Number of results (max 100)'),
      offset: S.int('Offset for pagination'),
    }),
    handler: async (a) =>
      httpGet(`${BASE_URL}/blogs/posts`, { locationId: loc(), limit: a.limit ?? 25, offset: a.offset ?? 0 }),
  },
  {
    name: 'create_blog_post',
    description: 'Create a new blog post.',
    annotations: RW,
    inputSchema: schema(
      {
        title: S.str('Blog post title'),
        html: S.str('Full HTML content of the post'),
        status: S.str('"draft" (default) or "published"'),
        author_id: S.str('User ID of the author (get from get_users)'),
        image_url: S.str('Featured image URL'),
        meta_description: S.str('SEO meta description'),
        tags: S.strArr('List of tag strings for the post'),
      },
      ['title', 'html'],
    ),
    handler: async (a) => {
      const body = { locationId: loc(), title: a.title, rawHTML: a.html, status: a.status ?? 'draft' };
      if (a.author_id) body.authorId = a.author_id;
      if (a.image_url) body.imageUrl = a.image_url;
      if (a.meta_description) body.metaDescription = a.meta_description;
      if (a.tags) body.tags = a.tags;
      return httpPost(`${BASE_URL}/blogs/posts`, body);
    },
  },
  {
    name: 'update_blog_post',
    description: 'Update an existing blog post. Only provided fields will be changed.',
    annotations: RW,
    inputSchema: schema(
      {
        post_id: S.str('Blog post ID to update'),
        title: S.str('New title'),
        html: S.str('New HTML content'),
        status: S.str('New status — "draft" or "published"'),
        image_url: S.str('New featured image URL'),
        meta_description: S.str('New SEO meta description'),
        tags: S.strArr('New tag list (replaces existing tags)'),
      },
      ['post_id'],
    ),
    handler: async (a) => {
      const body = {};
      if (a.title) body.title = a.title;
      if (a.html) body.rawHTML = a.html;
      if (a.status) body.status = a.status;
      if (a.image_url) body.imageUrl = a.image_url;
      if (a.meta_description) body.metaDescription = a.meta_description;
      if (a.tags !== undefined && a.tags !== null) body.tags = a.tags;
      return httpPut(`${BASE_URL}/blogs/posts/${a.post_id}`, body);
    },
  },
  {
    name: 'delete_blog_post',
    description: 'Permanently delete a blog post. This cannot be undone.',
    annotations: DESTRUCTIVE,
    inputSchema: schema({ post_id: S.str('Blog post ID to delete') }, ['post_id']),
    handler: async (a) => httpDelete(`${BASE_URL}/blogs/posts/${a.post_id}`),
  },

  // ── Social Media Posting ─────────────────────────────────────────────────────
  {
    name: 'get_social_accounts',
    description:
      'Get all connected social media accounts (Facebook, Instagram, Google, LinkedIn, TikTok, etc.).',
    annotations: RO,
    inputSchema: schema({}),
    handler: async () => httpGet(`${BASE_URL}/social-media-posting/oauth/${loc()}/accounts`),
  },
  {
    name: 'list_social_posts',
    description: 'List social media posts.',
    annotations: RO,
    inputSchema: schema({
      account_id: S.str('Filter by a specific connected social account ID'),
      status: S.str('Filter by status — "draft", "scheduled", "published", "failed"'),
      limit: S.int('Number of results (max 100)'),
      page: S.int('1-indexed page number'),
    }),
    handler: async (a) => {
      const params = { locationId: loc(), limit: a.limit ?? 25, page: a.page ?? 1 };
      if (a.account_id) params.accountId = a.account_id;
      if (a.status) params.status = a.status;
      return httpGet(`${BASE_URL}/social-media-posting/posts`, params);
    },
  },
  {
    name: 'get_social_post',
    description: 'Get details for a specific social media post.',
    annotations: RO,
    inputSchema: schema({ post_id: S.str('Post ID') }, ['post_id']),
    handler: async (a) => httpGet(`${BASE_URL}/social-media-posting/posts/${a.post_id}`),
  },
  {
    name: 'create_social_post',
    description: 'Create a social media post for one or more connected accounts.',
    annotations: RW,
    inputSchema: schema(
      {
        account_ids: S.strArr('List of connected social account IDs to post to'),
        content: S.str('Post text/caption'),
        status: S.str('"draft" (default) or "scheduled" (requires scheduled_at)'),
        scheduled_at: S.str('ISO 8601 datetime to publish'),
        image_urls: S.strArr('List of image URLs to attach to the post'),
      },
      ['account_ids', 'content'],
    ),
    handler: async (a) => {
      const body = {
        locationId: loc(),
        accountIds: a.account_ids,
        summary: a.content,
        status: a.status ?? 'draft',
      };
      if (a.scheduled_at) body.scheduledAt = a.scheduled_at;
      if (a.image_urls) body.mediaUrls = a.image_urls;
      return httpPost(`${BASE_URL}/social-media-posting/posts`, body);
    },
  },
  {
    name: 'update_social_post',
    description: 'Update an existing social media post (only works on drafts/scheduled posts).',
    annotations: RW,
    inputSchema: schema(
      {
        post_id: S.str('Post ID to update'),
        content: S.str('New post text/caption'),
        status: S.str('New status — "draft" or "scheduled"'),
        scheduled_at: S.str('New ISO 8601 scheduled datetime'),
        image_urls: S.strArr('New list of image URLs'),
      },
      ['post_id'],
    ),
    handler: async (a) => {
      const body = {};
      if (a.content) body.summary = a.content;
      if (a.status) body.status = a.status;
      if (a.scheduled_at) body.scheduledAt = a.scheduled_at;
      if (a.image_urls) body.mediaUrls = a.image_urls;
      return httpPut(`${BASE_URL}/social-media-posting/posts/${a.post_id}`, body);
    },
  },
  {
    name: 'delete_social_post',
    description: 'Delete a social media post. This cannot be undone.',
    annotations: DESTRUCTIVE,
    inputSchema: schema({ post_id: S.str('Post ID to delete') }, ['post_id']),
    handler: async (a) => httpDelete(`${BASE_URL}/social-media-posting/posts/${a.post_id}`),
  },

  // ── Products ─────────────────────────────────────────────────────────────
  {
    name: 'list_products',
    description: 'List all products (courses, services, physical goods, etc.).',
    annotations: RO,
    inputSchema: schema({
      limit: S.int('Number of results (max 100)'),
      offset: S.int('Offset for pagination'),
    }),
    handler: async (a) =>
      httpGet(`${BASE_URL}/products/`, { locationId: loc(), limit: a.limit ?? 25, offset: a.offset ?? 0 }),
  },
  {
    name: 'get_product',
    description: 'Get full details for a specific product.',
    annotations: RO,
    inputSchema: schema({ product_id: S.str('Product ID') }, ['product_id']),
    handler: async (a) => httpGet(`${BASE_URL}/products/${a.product_id}`),
  },
  {
    name: 'create_product',
    description: 'Create a new product.',
    annotations: RW,
    inputSchema: schema(
      {
        name: S.str('Product name'),
        product_type: S.str('"SERVICE" (default), "PHYSICAL", or "DIGITAL"'),
        description: S.str('Product description'),
        image_url: S.str('Product image URL'),
      },
      ['name'],
    ),
    handler: async (a) => {
      const body = { locationId: loc(), name: a.name, productType: a.product_type ?? 'SERVICE' };
      if (a.description) body.description = a.description;
      if (a.image_url) body.image = a.image_url;
      return httpPost(`${BASE_URL}/products/`, body);
    },
  },
  {
    name: 'update_product',
    description: 'Update an existing product.',
    annotations: RW,
    inputSchema: schema(
      {
        product_id: S.str('Product ID to update'),
        name: S.str('New product name'),
        description: S.str('New product description'),
        image_url: S.str('New product image URL'),
      },
      ['product_id'],
    ),
    handler: async (a) => {
      const body = {};
      if (a.name) body.name = a.name;
      if (a.description) body.description = a.description;
      if (a.image_url) body.image = a.image_url;
      return httpPut(`${BASE_URL}/products/${a.product_id}`, body);
    },
  },
  {
    name: 'delete_product',
    description: 'Permanently delete a product. This cannot be undone.',
    annotations: DESTRUCTIVE,
    inputSchema: schema({ product_id: S.str('Product ID to delete') }, ['product_id']),
    handler: async (a) => httpDelete(`${BASE_URL}/products/${a.product_id}`),
  },

  // ── Product Prices ───────────────────────────────────────────────────────
  {
    name: 'list_prices',
    description: 'List all prices for a product.',
    annotations: RO,
    inputSchema: schema({ product_id: S.str('Product ID') }, ['product_id']),
    handler: async (a) => httpGet(`${BASE_URL}/products/${a.product_id}/prices`, { locationId: loc() }),
  },
  {
    name: 'create_price',
    description: 'Create a new price for a product.',
    annotations: RW,
    inputSchema: schema(
      {
        product_id: S.str('Product ID'),
        name: S.str('Price name (e.g. "Monthly", "One-Time", "Annual")'),
        amount: S.int('Price in cents (e.g. 9700 = $97.00)'),
        currency: S.str('Currency code (default: "USD")'),
        recurring_interval: S.str('For subscriptions — "day", "week", "month", or "year". Omit for one-time.'),
        recurring_interval_count: S.int('How many intervals per billing cycle (default: 1)'),
        trial_days: S.int('Number of free trial days before billing starts'),
      },
      ['product_id', 'name', 'amount'],
    ),
    handler: async (a) => {
      const body = {
        locationId: loc(),
        name: a.name,
        amount: a.amount,
        currency: (a.currency ?? 'USD').toUpperCase(),
      };
      if (a.recurring_interval) {
        body.recurring = {
          interval: a.recurring_interval,
          intervalCount: a.recurring_interval_count ?? 1,
        };
        if (a.trial_days) body.trialDays = a.trial_days;
      }
      return httpPost(`${BASE_URL}/products/${a.product_id}/prices`, body);
    },
  },
  {
    name: 'update_price',
    description: 'Update an existing price.',
    annotations: RW,
    inputSchema: schema(
      {
        product_id: S.str('Product ID'),
        price_id: S.str('Price ID to update'),
        name: S.str('New price name'),
        amount: S.int('New amount in cents'),
        currency: S.str('New currency code'),
      },
      ['product_id', 'price_id'],
    ),
    handler: async (a) => {
      const body = {};
      if (a.name) body.name = a.name;
      if (a.amount !== undefined && a.amount !== null) body.amount = a.amount;
      if (a.currency) body.currency = a.currency.toUpperCase();
      return httpPut(`${BASE_URL}/products/${a.product_id}/prices/${a.price_id}`, body);
    },
  },
  {
    name: 'delete_price',
    description: 'Delete a price from a product. This cannot be undone.',
    annotations: DESTRUCTIVE,
    inputSchema: schema(
      { product_id: S.str('Product ID'), price_id: S.str('Price ID to delete') },
      ['product_id', 'price_id'],
    ),
    handler: async (a) => httpDelete(`${BASE_URL}/products/${a.product_id}/prices/${a.price_id}`),
  },

  // ── Invoices ─────────────────────────────────────────────────────────────
  {
    name: 'list_invoices',
    description: 'List invoices in the sub-account.',
    annotations: RO,
    inputSchema: schema({
      status: S.str('Filter — "draft", "sent", "payment_processing", "paid", "void", "overdue"'),
      contact_id: S.str('Filter by contact ID'),
      limit: S.int('Number of results (max 100)'),
      offset: S.int('Offset for pagination'),
      start_at: S.str('Filter invoices created after this date (ISO 8601)'),
      end_at: S.str('Filter invoices created before this date (ISO 8601)'),
    }),
    handler: async (a) => {
      const location = loc();
      const params = { altId: location, altType: 'location', limit: a.limit ?? 25, offset: a.offset ?? 0 };
      if (a.status) params.status = a.status;
      if (a.contact_id) params.contactId = a.contact_id;
      if (a.start_at) params.startAt = a.start_at;
      if (a.end_at) params.endAt = a.end_at;
      return httpGet(`${BASE_URL}/invoices/`, params);
    },
  },
  {
    name: 'get_invoice',
    description: 'Get full details for a specific invoice.',
    annotations: RO,
    inputSchema: schema({ invoice_id: S.str('Invoice ID') }, ['invoice_id']),
    handler: async (a) => httpGet(`${BASE_URL}/invoices/${a.invoice_id}`),
  },
  {
    name: 'create_invoice',
    description: 'Create a new invoice for a contact.',
    annotations: RW,
    inputSchema: schema(
      {
        contact_id: S.str('Contact ID to bill'),
        title: S.str('Invoice title/name'),
        items: S.objArr('List of line items. Each: {"name": str, "amount": int (cents), "qty": int}'),
        due_date: S.str('Due date in ISO 8601 format (e.g. "2026-03-31")'),
        currency: S.str('Currency code (default: "USD")'),
        notes: S.str('Internal or customer-facing notes on the invoice'),
      },
      ['contact_id', 'title', 'items'],
    ),
    handler: async (a) => {
      const location = loc();
      const items = Array.isArray(a.items) ? a.items : [];
      const body = {
        altId: location,
        altType: 'location',
        contactDetails: { id: a.contact_id },
        title: a.title,
        currency: (a.currency ?? 'USD').toUpperCase(),
        lineItems: items.map((item) => ({
          name: item?.name ?? '',
          amount: item?.amount ?? 0,
          qty: item?.qty ?? 1,
        })),
      };
      if (a.due_date) body.dueDate = a.due_date;
      if (a.notes) body.internalNotes = a.notes;
      return httpPost(`${BASE_URL}/invoices/`, body);
    },
  },
  {
    name: 'send_invoice',
    description: 'Send an invoice to the contact via email.',
    annotations: RW,
    inputSchema: schema(
      {
        invoice_id: S.str('Invoice ID to send'),
        action: S.str('"send" (default) or "resend"'),
      },
      ['invoice_id'],
    ),
    handler: async (a) =>
      httpPost(`${BASE_URL}/invoices/${a.invoice_id}/send`, {
        altId: loc(),
        altType: 'location',
        action: a.action ?? 'send',
      }),
  },
  {
    name: 'void_invoice',
    description: 'Void an invoice (marks it as cancelled — cannot be undone).',
    annotations: RW,
    inputSchema: schema({ invoice_id: S.str('Invoice ID to void') }, ['invoice_id']),
    handler: async (a) =>
      httpPost(`${BASE_URL}/invoices/${a.invoice_id}/void`, { altId: loc(), altType: 'location' }),
  },
  {
    name: 'record_invoice_payment',
    description: 'Record a manual payment against an invoice.',
    annotations: RW,
    inputSchema: schema(
      {
        invoice_id: S.str('Invoice ID'),
        amount: S.int('Amount paid in cents (e.g. 9700 = $97.00)'),
        mode: S.str('Payment mode — "cash", "cheque", "bank_transfer", "other" (default: "cash")'),
        notes: S.str('Payment notes'),
      },
      ['invoice_id', 'amount'],
    ),
    handler: async (a) => {
      const body = { altId: loc(), altType: 'location', amount: a.amount, mode: a.mode ?? 'cash' };
      if (a.notes) body.notes = a.notes;
      return httpPost(`${BASE_URL}/invoices/${a.invoice_id}/record-payment`, body);
    },
  },
  {
    name: 'delete_invoice',
    description: 'Permanently delete a draft invoice. This cannot be undone.',
    annotations: DESTRUCTIVE,
    inputSchema: schema(
      { invoice_id: S.str('Invoice ID to delete (must be in draft status)') },
      ['invoice_id'],
    ),
    handler: async (a) => httpDelete(`${BASE_URL}/invoices/${a.invoice_id}`),
  },

  // ── Payments ─────────────────────────────────────────────────────────────
  {
    name: 'list_orders',
    description: 'List payment orders.',
    annotations: RO,
    inputSchema: schema({
      contact_id: S.str('Filter by contact ID'),
      status: S.str('Filter — "pending", "completed", "cancelled", "refunded"'),
      limit: S.int('Number of results (max 100)'),
      offset: S.int('Offset for pagination'),
      start_at: S.str('Filter orders created after this date (ISO 8601)'),
      end_at: S.str('Filter orders created before this date (ISO 8601)'),
    }),
    handler: async (a) => {
      const params = { altId: loc(), altType: 'location', limit: a.limit ?? 25, offset: a.offset ?? 0 };
      if (a.contact_id) params.contactId = a.contact_id;
      if (a.status) params.status = a.status;
      if (a.start_at) params.startAt = a.start_at;
      if (a.end_at) params.endAt = a.end_at;
      return httpGet(`${BASE_URL}/payments/orders`, params);
    },
  },
  {
    name: 'get_order',
    description: 'Get full details for a specific payment order.',
    annotations: RO,
    inputSchema: schema({ order_id: S.str('Order ID') }, ['order_id']),
    handler: async (a) =>
      httpGet(`${BASE_URL}/payments/orders/${a.order_id}`, { altId: loc(), altType: 'location' }),
  },
  {
    name: 'list_transactions',
    description: 'List payment transactions.',
    annotations: RO,
    inputSchema: schema({
      contact_id: S.str('Filter by contact ID'),
      limit: S.int('Number of results (max 100)'),
      offset: S.int('Offset for pagination'),
      start_at: S.str('Filter transactions after this date (ISO 8601)'),
      end_at: S.str('Filter transactions before this date (ISO 8601)'),
    }),
    handler: async (a) => {
      const params = { altId: loc(), altType: 'location', limit: a.limit ?? 25, offset: a.offset ?? 0 };
      if (a.contact_id) params.contactId = a.contact_id;
      if (a.start_at) params.startAt = a.start_at;
      if (a.end_at) params.endAt = a.end_at;
      return httpGet(`${BASE_URL}/payments/transactions`, params);
    },
  },
  {
    name: 'list_subscriptions',
    description: 'List payment subscriptions.',
    annotations: RO,
    inputSchema: schema({
      contact_id: S.str('Filter by contact ID'),
      status: S.str('Filter — "active", "canceled", "past_due", "trialing"'),
      limit: S.int('Number of results (max 100)'),
      offset: S.int('Offset for pagination'),
    }),
    handler: async (a) => {
      const params = { altId: loc(), altType: 'location', limit: a.limit ?? 25, offset: a.offset ?? 0 };
      if (a.contact_id) params.contactId = a.contact_id;
      if (a.status) params.status = a.status;
      return httpGet(`${BASE_URL}/payments/subscriptions`, params);
    },
  },

  // ── Media Library ──────────────────────────────────────────────────────
  {
    name: 'list_media_files',
    description: 'List files in the media library.',
    annotations: RO,
    inputSchema: schema({
      query: S.str('Search term to filter files by name'),
      type: S.str('Filter by file type — "image", "video", "pdf", "audio"'),
      limit: S.int('Number of results (max 100)'),
      offset: S.int('Offset for pagination'),
      sort_by: S.str('Field to sort by — "updatedAt" (default), "createdAt", "name", "size"'),
      sort_order: S.str('"desc" (default) or "asc"'),
    }),
    handler: async (a) => {
      const params = {
        altId: loc(),
        altType: 'location',
        limit: a.limit ?? 25,
        offset: a.offset ?? 0,
        sortBy: a.sort_by ?? 'updatedAt',
        sortOrder: a.sort_order ?? 'desc',
      };
      if (a.query) params.query = a.query;
      if (a.type) params.type = a.type;
      return httpGet(`${BASE_URL}/medias/`, params);
    },
  },

  // ── Businesses ──────────────────────────────────────────────────────────
  {
    name: 'list_businesses',
    description: 'List all businesses (companies) in the sub-account.',
    annotations: RO,
    inputSchema: schema({
      limit: S.int('Number of results (max 100)'),
      page: S.int('1-indexed page number'),
    }),
    handler: async (a) =>
      httpGet(`${BASE_URL}/businesses/`, { locationId: loc(), limit: a.limit ?? 25, page: a.page ?? 1 }),
  },
  {
    name: 'get_business',
    description: 'Get full details for a specific business.',
    annotations: RO,
    inputSchema: schema({ business_id: S.str('Business ID') }, ['business_id']),
    handler: async (a) => httpGet(`${BASE_URL}/businesses/${a.business_id}`),
  },
  {
    name: 'create_business',
    description: 'Create a new business record.',
    annotations: RW,
    inputSchema: schema(
      {
        name: S.str('Business name'),
        email: S.str('Business email address'),
        phone: S.str('Business phone (E.164 format)'),
        website: S.str('Business website URL'),
        address: S.str('Street address'),
        city: S.str('City'),
        state: S.str('State/province'),
        country: S.str('Country code (e.g. "US")'),
        description: S.str('Business description or notes'),
      },
      ['name'],
    ),
    handler: async (a) => {
      const body = { locationId: loc(), name: a.name };
      if (a.email) body.email = a.email;
      if (a.phone) body.phone = a.phone;
      if (a.website) body.website = a.website;
      if (a.address) body.address = a.address;
      if (a.city) body.city = a.city;
      if (a.state) body.state = a.state;
      if (a.country) body.country = a.country;
      if (a.description) body.description = a.description;
      return httpPost(`${BASE_URL}/businesses/`, body);
    },
  },
  {
    name: 'update_business',
    description: 'Update an existing business record. Only provided fields will be changed.',
    annotations: RW,
    inputSchema: schema(
      {
        business_id: S.str('Business ID to update'),
        name: S.str('New business name'),
        email: S.str('New email'),
        phone: S.str('New phone'),
        website: S.str('New website URL'),
        address: S.str('New street address'),
        city: S.str('New city'),
        state: S.str('New state'),
        country: S.str('New country code'),
        description: S.str('New description'),
      },
      ['business_id'],
    ),
    handler: async (a) => {
      const body = {};
      if (a.name) body.name = a.name;
      if (a.email) body.email = a.email;
      if (a.phone) body.phone = a.phone;
      if (a.website) body.website = a.website;
      if (a.address) body.address = a.address;
      if (a.city) body.city = a.city;
      if (a.state) body.state = a.state;
      if (a.country) body.country = a.country;
      if (a.description) body.description = a.description;
      return httpPut(`${BASE_URL}/businesses/${a.business_id}`, body);
    },
  },
  {
    name: 'delete_business',
    description: 'Permanently delete a business record. This cannot be undone.',
    annotations: DESTRUCTIVE,
    inputSchema: schema({ business_id: S.str('Business ID to delete') }, ['business_id']),
    handler: async (a) => httpDelete(`${BASE_URL}/businesses/${a.business_id}`),
  },

  // ── Custom Values ──────────────────────────────────────────────────────
  {
    name: 'list_custom_values',
    description:
      'List all custom values (location-level variables like business name, links, etc.).',
    annotations: RO,
    inputSchema: schema({}),
    handler: async () => httpGet(`${BASE_URL}/locations/${loc()}/customValues`),
  },
  {
    name: 'create_custom_value',
    description: 'Create a new custom value (reusable variable).',
    annotations: RW,
    inputSchema: schema(
      {
        name: S.str('Variable name (e.g. "Offer Deadline", "Zoom Link")'),
        value: S.str('Variable value'),
      },
      ['name', 'value'],
    ),
    handler: async (a) =>
      httpPost(`${BASE_URL}/locations/${loc()}/customValues`, { name: a.name, value: a.value }),
  },
  {
    name: 'update_custom_value',
    description: 'Update an existing custom value.',
    annotations: RW,
    inputSchema: schema(
      {
        custom_value_id: S.str('Custom value ID'),
        name: S.str('New variable name'),
        value: S.str('New variable value'),
      },
      ['custom_value_id'],
    ),
    handler: async (a) => {
      const body = {};
      if (a.name) body.name = a.name;
      if (a.value) body.value = a.value;
      return httpPut(`${BASE_URL}/locations/${loc()}/customValues/${a.custom_value_id}`, body);
    },
  },
  {
    name: 'delete_custom_value',
    description: 'Delete a custom value. This cannot be undone.',
    annotations: DESTRUCTIVE,
    inputSchema: schema({ custom_value_id: S.str('Custom value ID to delete') }, ['custom_value_id']),
    handler: async (a) => httpDelete(`${BASE_URL}/locations/${loc()}/customValues/${a.custom_value_id}`),
  },

  // ── Trigger Links ──────────────────────────────────────────────────────
  {
    name: 'list_trigger_links',
    description: 'List all trigger links. Trigger links fire automations when clicked by a contact.',
    annotations: RO,
    inputSchema: schema({}),
    handler: async () => httpGet(`${BASE_URL}/links/`, { locationId: loc() }),
  },
  {
    name: 'create_trigger_link',
    description: 'Create a new trigger link that fires automations when clicked.',
    annotations: RW,
    inputSchema: schema(
      {
        name: S.str('Link name (e.g. "Clicked Offer Button")'),
        redirect_to: S.str('URL to redirect the contact to after clicking'),
      },
      ['name', 'redirect_to'],
    ),
    handler: async (a) =>
      httpPost(`${BASE_URL}/links/`, { locationId: loc(), name: a.name, redirectTo: a.redirect_to }),
  },
  {
    name: 'update_trigger_link',
    description: 'Update an existing trigger link.',
    annotations: RW,
    inputSchema: schema(
      {
        link_id: S.str('Trigger link ID'),
        name: S.str('New link name'),
        redirect_to: S.str('New redirect URL'),
      },
      ['link_id'],
    ),
    handler: async (a) => {
      const body = {};
      if (a.name) body.name = a.name;
      if (a.redirect_to) body.redirectTo = a.redirect_to;
      return httpPut(`${BASE_URL}/links/${a.link_id}`, body);
    },
  },
  {
    name: 'delete_trigger_link',
    description: 'Delete a trigger link. This cannot be undone.',
    annotations: DESTRUCTIVE,
    inputSchema: schema({ link_id: S.str('Trigger link ID to delete') }, ['link_id']),
    handler: async (a) => httpDelete(`${BASE_URL}/links/${a.link_id}`),
  },

  // ── Courses & Memberships ────────────────────────────────────────────────
  {
    name: 'list_courses',
    description: 'List all courses/memberships in the sub-account.',
    annotations: RO,
    inputSchema: schema({
      limit: S.int('Number of results (max 100)'),
      offset: S.int('Offset for pagination'),
    }),
    handler: async (a) =>
      httpGet(`${BASE_URL}/courses/`, { locationId: loc(), limit: a.limit ?? 25, offset: a.offset ?? 0 }),
  },

  // ── Drip Campaigns (legacy automation) ────────────────────────────────────
  {
    name: 'list_drip_campaigns',
    description:
      'List all drip campaigns (legacy automation sequences under Contacts > Campaigns).',
    annotations: RO,
    inputSchema: schema({}),
    handler: async () => httpGet(`${BASE_URL}/campaigns/`, { locationId: loc() }),
  },
  {
    name: 'add_contact_to_campaign',
    description: 'Add a contact to a drip campaign (legacy automation sequence).',
    annotations: RW,
    inputSchema: schema(
      {
        contact_id: S.str('Contact ID'),
        campaign_id: S.str('Campaign ID (get from list_drip_campaigns)'),
      },
      ['contact_id', 'campaign_id'],
    ),
    handler: async (a) =>
      httpPost(`${BASE_URL}/contacts/${a.contact_id}/campaigns/${a.campaign_id}`, {}),
  },
];

// ════════════════════════════════════════════════════════════════════════════
// MCP server boot — mirrors vendor/flo-mcp-servers/gmail/index.js.
// ════════════════════════════════════════════════════════════════════════════

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

async function main() {
  const server = new Server(
    { name: 'ghl', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.onerror = (error) => {
    console.error('[MCP Error]', error);
  };
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS_BY_NAME.get(request.params.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }
    try {
      const text = await tool.handler(request.params.arguments ?? {});
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Boot the stdio server only when run as the entrypoint (how Electron spawns
// it). When imported by unit tests we just want the TOOLS array, so guard the
// boot to avoid hanging on a stdio transport.
import { fileURLToPath } from 'url';
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { TOOLS, BASE_URL, API_VERSION, CHARACTER_LIMIT, main };
