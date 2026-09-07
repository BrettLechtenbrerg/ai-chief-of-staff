import { describe, expect, it } from 'vitest';
import { AGENT_MODES } from '../../src/agent/agent-modes.js';
import {
  attachToolPolicy,
  filterToolsForMode,
  getToolPolicy,
  guardToolWithApproval,
  isToolAllowedForMode,
} from '../../src/agent/tool-policy.js';
import { ApprovalManager } from '../../src/security/approval-manager.js';

const candidateTools = [
  'read',
  'write',
  'edit',
  'bash',
  'shell_command',
  'web_fetch',
  'subagent',
  'browser',
  'notify',
  'remember',
  'soul_get',
  'create_reminder',
  'switch_agent',
  'generate_blog_image',
  'fetch_aeo_visibility',
  'mcp__grep__searchGitHub',
  'mcp__flo-gmail__search_emails',
].map((name) => ({ name }));

describe('mode tool enforcement', () => {
  it('produces stable per-mode tool snapshots', () => {
    const snapshots = Object.fromEntries(
      Object.entries(AGENT_MODES).map(([id, mode]) => [
        id,
        filterToolsForMode(candidateTools, mode).map((tool) => tool.name),
      ])
    );

    expect(snapshots).toEqual({
      general: [
        'read',
        'write',
        'edit',
        'shell_command',
        'web_fetch',
        'subagent',
        'browser',
        'notify',
        'remember',
        'soul_get',
        'create_reminder',
        'switch_agent',
        'generate_blog_image',
        'fetch_aeo_visibility',
        'mcp__flo-gmail__search_emails',
      ],
      coder: [
        'read',
        'write',
        'edit',
        'bash',
        'web_fetch',
        'subagent',
        'switch_agent',
        'mcp__grep__searchGitHub',
      ],
      researcher: [
        'web_fetch',
        'subagent',
        'browser',
        'notify',
        'remember',
        'switch_agent',
        'fetch_aeo_visibility',
        'mcp__flo-gmail__search_emails',
      ],
      writer: ['notify', 'remember', 'soul_get', 'switch_agent', 'generate_blog_image'],
      therapist: ['notify', 'remember', 'soul_get', 'switch_agent'],
    });
  });

  it('does not let the external wildcard unlock internal MCP tools', () => {
    expect(isToolAllowedForMode('mcp__flo-gmail__search_emails', AGENT_MODES.general)).toBe(true);
    expect(isToolAllowedForMode('mcp__pocket-agent__unexpected', AGENT_MODES.general)).toBe(false);
    expect(isToolAllowedForMode('mcp__grep__other', AGENT_MODES.general)).toBe(false);
    expect(isToolAllowedForMode('mcp__flo-gmail__search_emails', AGENT_MODES.writer)).toBe(false);
  });
});

describe('tool capability registry', () => {
  it('lets local work run unattended', () => {
    for (const name of ['read', 'write', 'subagent', 'remember', 'notify', 'create_routine', 'task_output', 'task_stop']) {
      expect(getToolPolicy(name, 'native').confirmationRequired, name).toBe(false);
    }
    expect(getToolPolicy('generate_blog_image', 'custom')).toMatchObject({
      capability: 'paid-action',
      confirmationRequired: false,
    });
  });

  it('still gates outbound and batch-paid actions', () => {
    for (const name of ['send_telegram_message', 'campaign_send_message', 'campaign_enroll', 'fetch_aeo_visibility', 'browser']) {
      expect(getToolPolicy(name, 'custom').confirmationRequired, name).toBe(true);
    }
  });

  it('allows inspected MCP reads only; staging and unreviewed tools require approval', () => {
    const read = [
      'mcp__flo-gmail__gmail_search_emails',
      'mcp__flo-calendar__calendar_list_events',
      'mcp__flo-calendar__calendar_check_conflicts',
      'mcp__flo-docs__docs_read_content',
      'mcp__flo-ghl__get_contact',
      'mcp__flo-ghl__search_contacts',
    ];
    const write = [
      'mcp__flo-gmail__gmail_propose_send',
      'mcp__dataforseo-mcp-server__serp_organic_live_advanced',
      'mcp__firecrawl-mcp__firecrawl_scrape',
      'mcp__unknown__get_status',
      'mcp__unknown__propose_send',
      'mcp__flo-gmail__gmail_send',
      'mcp__flo-gmail__gmail_execute',
      'mcp__flo-gmail__gmail_delete_by_search',
      'mcp__flo-calendar__calendar_execute',
      'mcp__flo-calendar__calendar_block_focus_time',
      'mcp__flo-docs__docs_execute',
      'mcp__flo-ghl__send_message',
      'mcp__flo-ghl__create_contact',
      'mcp__flo-ghl__add_contact_to_workflow',
      'mcp__flo-ghl__record_invoice_payment',
      'mcp__meta-ads__create_campaign',
    ];
    for (const name of read) {
      expect(getToolPolicy(name, 'mcp'), name).toMatchObject({ capability: 'external-read', confirmationRequired: false });
    }
    for (const name of write) {
      expect(getToolPolicy(name, 'mcp'), name).toMatchObject({ capability: 'external-write', confirmationRequired: true });
    }
  });

  it('only prompts the browser tool for acting actions', async () => {
    const execution = { sessionId: 's', channel: 'scheduled', cwd: '/', approvedRoots: [] };
    const tool = guardToolWithApproval(
      attachToolPolicy(
        { name: 'browser', description: '', parameters: {} as never, execute: async () => 'ran' },
        'custom'
      ),
      execution
    );
    ApprovalManager.setNotifier(null);
    const ctx = {} as never;
    expect(await tool.execute({ action: 'navigate', url: 'https://x' }, ctx)).toBe('ran');
    expect(await tool.execute({ action: 'extract' }, ctx)).toBe('ran');
    expect(String(await tool.execute({ action: 'click', selector: 'a' }, ctx))).toContain('requires user approval');
  });

  it('lets a destructive annotation escalate but never downgrade', () => {
    const annotations = { readOnlyHint: true, destructiveHint: true, idempotentHint: true, openWorldHint: false };
    expect(getToolPolicy('mcp__x__get_thing', 'mcp', annotations)).toEqual({
      capability: 'external-write',
      confirmationRequired: true,
      source: 'mcp',
      annotations,
    });
    expect(getToolPolicy('mcp__x__send_thing', 'mcp', { readOnlyHint: true }).confirmationRequired).toBe(true);
  });
});
