import { describe, expect, it } from 'vitest';
import { AGENT_MODES } from '../../src/agent/agent-modes.js';
import {
  filterToolsForMode,
  getToolPolicy,
  isToolAllowedForMode,
} from '../../src/agent/tool-policy.js';

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
  it('classifies native and custom side effects', () => {
    expect(getToolPolicy('read', 'native')).toMatchObject({
      capability: 'local-read',
      confirmationRequired: true,
    });
    expect(getToolPolicy('shell_command', 'native')).toMatchObject({
      capability: 'local-execute',
      confirmationRequired: true,
    });
    expect(getToolPolicy('generate_blog_image', 'custom')).toMatchObject({
      capability: 'paid-action',
      confirmationRequired: true,
    });
    expect(getToolPolicy('switch_agent', 'custom')).toMatchObject({
      capability: 'safe-local',
      confirmationRequired: false,
    });
  });

  it('preserves MCP annotations but keeps unknown external tools confirmation-required', () => {
    const annotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    };
    const policy = getToolPolicy('mcp__flo-gmail__search_emails', 'mcp', annotations);
    expect(policy).toEqual({
      capability: 'external-read',
      confirmationRequired: true,
      source: 'mcp',
      annotations,
    });
  });
});
