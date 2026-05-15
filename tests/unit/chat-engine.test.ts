/**
 * Unit tests for ChatEngine after migration to @kenkaiiii/gg-agent + @kenkaiiii/gg-ai
 *
 * Tests:
 * - Public interface preservation (processMessage, stopQuery, isQueryProcessing, clearSession, buildSystemPrompt, getDeveloperPrompt)
 * - Thinking level mapping
 * - System prompt building (static/dynamic split)
 * - Session management (abort, queue, clear)
 * - Status event emission
 * - Token tracking from agent events
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock event helpers ────────────────────────────────────────────────

function makeTextDelta(text: string) {
  return { type: 'text_delta' as const, text };
}

function makeTurnEnd(turn: number, usage: { inputTokens: number; outputTokens: number; cacheRead?: number; cacheWrite?: number }) {
  return { type: 'turn_end' as const, turn, usage };
}

function makeAgentDone(totalTurns: number, totalUsage: { inputTokens: number; outputTokens: number; cacheRead?: number; cacheWrite?: number }) {
  return { type: 'agent_done' as const, totalTurns, totalUsage };
}

// ── Mock Agent class ──────────────────────────────────────────────────

let capturedAgentOptions: Record<string, unknown> | null = null;
let capturedAgentMessages: Array<Record<string, unknown>> | null = null;
let mockAgentEvents: Array<Record<string, unknown>> = [];

/**
 * Optional gate for controlling iteration timing of the mocked agentLoop.
 * When set, each call to agentLoop builds a fresh async iterator that awaits
 * `gate.start` before yielding events. Tests can use this to pause an in-flight
 * `processMessage` while making concurrent calls.
 */
interface IterationGate {
  start: Promise<void>;
  release: () => void;
  events: Array<Record<string, unknown>>;
}
let pendingGates: IterationGate[] = [];
let gateConsumerIndex = 0;

function createGate(events: Array<Record<string, unknown>>): IterationGate {
  let release!: () => void;
  const start = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { start, release, events };
}

vi.mock('@kenkaiiii/gg-agent', () => ({
  Agent: class MockAgent {
    constructor(options: Record<string, unknown>) {
      capturedAgentOptions = options;
    }
    prompt(_message: string) {
      return {
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            async next() {
              if (i < mockAgentEvents.length) {
                return { value: mockAgentEvents[i++], done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      };
    }
  },
  agentLoop(messages: Array<Record<string, unknown>>, options: Record<string, unknown>) {
    capturedAgentMessages = messages;
    capturedAgentOptions = options;

    // If gates are queued, consume one in FIFO order so the Nth call to
    // agentLoop drives the Nth processMessage execution.
    const gate = pendingGates[gateConsumerIndex++];
    if (gate) {
      const events = gate.events;
      return {
        [Symbol.asyncIterator]() {
          let i = 0;
          let started = false;
          return {
            async next() {
              if (!started) {
                await gate.start;
                started = true;
              }
              if (i < events.length) {
                return { value: events[i++], done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      };
    }

    return {
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          async next() {
            if (i < mockAgentEvents.length) {
              return { value: mockAgentEvents[i++], done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    };
  },
}));

vi.mock('@kenkaiiii/gg-ai', () => ({
  stream: vi.fn(),
}));

vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn((key: string) => {
      if (key === 'agent.model') return 'claude-opus-4-7';
      if (key === 'agent.thinkingLevel') return 'normal';
      return undefined;
    }),
    getFormattedProfile: vi.fn(() => ''),
    getFormattedIdentity: vi.fn(() => '# Frankie\n\nYou are a personal AI assistant.'),
    getFormattedUserContext: vi.fn(() => ''),
  },
}));

vi.mock('../../src/memory', () => ({
  MemoryManager: vi.fn(),
}));

vi.mock('../../src/config/system-guidelines', () => ({
  SYSTEM_GUIDELINES: 'Test system guidelines',
}));

vi.mock('../../src/agent/chat-providers', () => ({
  getStreamConfig: vi.fn(async () => ({
    provider: 'anthropic',
    apiKey: 'test-key',
  })),
  getProviderForModel: vi.fn((model: string) => {
    if (model.startsWith('claude-')) return 'anthropic';
    if (model.startsWith('kimi-')) return 'moonshot';
    return 'anthropic';
  }),
}));

vi.mock('../../src/agent/chat-tools', () => ({
  getChatAgentTools: vi.fn(() => []),
  getServerTools: vi.fn(() => []),
}));

vi.mock('../../src/tools', () => ({
  setCurrentSessionId: vi.fn(),
  runWithSessionId: vi.fn((_id: string, fn: () => unknown) => fn()),
}));

// Mutable flags so individual tests can override compaction behaviour
const ggcoderMocks = {
  shouldCompact: false as boolean,
  estimatedTokens: 100,
};

vi.mock('@kenkaiiii/ggcoder', () => ({
  buildSystemPrompt: vi.fn(() => ({ staticPrompt: '', dynamicPrompt: '' })),
  shouldCompact: vi.fn(() => ggcoderMocks.shouldCompact),
  estimateConversationTokens: vi.fn(() => ggcoderMocks.estimatedTokens),
  getCoderAgentTools: vi.fn(() => []),
}));

import { ChatEngine } from '../../src/agent/chat-engine';
import { SettingsManager } from '../../src/settings';
import { getStreamConfig } from '../../src/agent/chat-providers';
import { shouldCompact } from '@kenkaiiii/ggcoder';

// ── Helpers ────────────────────────────────────────────────────────────

function createEngine() {
  const memory = {
    setSummarizer: vi.fn(),
    getRecentMessages: vi.fn(() => []),
    getSessionMessageCount: vi.fn(() => 0),
    getFactsForContext: vi.fn(() => ''),
    getSoulContext: vi.fn(() => ''),
    getDailyLogsContext: vi.fn(() => ''),
    saveMessage: vi.fn(() => 1),
    getSmartContext: vi.fn(async () => ({ recentMessages: [], rollingSummary: null })),
    getSessionMode: vi.fn(() => 'general'),
    getFactsMemoryUsage: vi.fn(() => ({ usedChars: 0, budgetChars: 50000, pct: 0 })),
    getSoulMemoryUsage: vi.fn(() => ({ usedChars: 0, budgetChars: 50000, pct: 0 })),
  };

  const statusEmitter = vi.fn();

  const engine = new ChatEngine({
    memory: memory as never,
    toolsConfig: {} as never,
    statusEmitter,
  });

  return { engine, memory, statusEmitter };
}

function setDefaultAgentEvents(text = 'Hello') {
  mockAgentEvents = [
    makeTextDelta(text),
    makeTurnEnd(1, { inputTokens: 100, outputTokens: 50, cacheRead: 0, cacheWrite: 0 }),
    makeAgentDone(1, { inputTokens: 100, outputTokens: 50, cacheRead: 0, cacheWrite: 0 }),
  ];
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('ChatEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedAgentOptions = null;
    capturedAgentMessages = null;
    mockAgentEvents = [];
    pendingGates = [];
    gateConsumerIndex = 0;

    // Reset default mock implementations
    vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
      if (key === 'agent.model') return 'claude-opus-4-7';
      if (key === 'agent.thinkingLevel') return 'normal';
      return undefined;
    });
    vi.mocked(getStreamConfig).mockResolvedValue({
      provider: 'anthropic',
      apiKey: 'test-key',
    });
  });

  // ─── Public Interface ───────────────────────────────────────────────

  describe('Public interface', () => {
    it('exposes processMessage method', () => {
      const { engine } = createEngine();
      expect(typeof engine.processMessage).toBe('function');
    });

    it('exposes stopQuery method', () => {
      const { engine } = createEngine();
      expect(typeof engine.stopQuery).toBe('function');
    });

    it('exposes isQueryProcessing method', () => {
      const { engine } = createEngine();
      expect(typeof engine.isQueryProcessing).toBe('function');
    });

    it('exposes clearSession method', () => {
      const { engine } = createEngine();
      expect(typeof engine.clearSession).toBe('function');
    });

    it('exposes buildSystemPrompt method', () => {
      const { engine } = createEngine();
      expect(typeof engine.buildSystemPrompt).toBe('function');
    });

    it('exposes getDeveloperPrompt method', () => {
      const { engine } = createEngine();
      expect(typeof engine.getDeveloperPrompt).toBe('function');
    });
  });

  // ─── processMessage ─────────────────────────────────────────────────

  describe('processMessage', () => {
    it('returns ProcessResult with response and tokensUsed', async () => {
      setDefaultAgentEvents('Hello there');
      const { engine } = createEngine();

      const result = await engine.processMessage('hi', 'desktop', 'test-session');

      expect(result.response).toBe('Hello there');
      expect(result.tokensUsed).toBe(150); // 100 input + 50 output
      expect(typeof result.wasCompacted).toBe('boolean');
    });

    it('passes system prompt to Agent', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      // System prompt is passed as the first message to agentLoop
      expect(capturedAgentMessages).not.toBeNull();
      const systemMsg = capturedAgentMessages!.find((m) => m.role === 'system');
      expect(systemMsg).toBeDefined();
      expect(typeof systemMsg!.content).toBe('string');
      expect(systemMsg!.content as string).toContain('Test system guidelines');
    });

    it('passes model from settings to Agent', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.model).toBe('claude-opus-4-7');
    });

    it('passes provider from getStreamConfig to Agent', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.provider).toBe('anthropic');
    });

    it('saves messages to memory after processing', async () => {
      setDefaultAgentEvents('Hello');
      const { engine, memory } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(memory.saveMessage).toHaveBeenCalledWith('user', 'hi', 'test-session', undefined);
      expect(memory.saveMessage).toHaveBeenCalledWith('assistant', 'Hello', 'test-session', undefined);
    });
  });

  // ─── Thinking Level Mapping ─────────────────────────────────────────

  describe('Thinking level mapping', () => {
    it('maps "normal" thinking to "medium"', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'claude-opus-4-7';
        if (key === 'agent.thinkingLevel') return 'normal';
        return undefined;
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.thinking).toBe('medium');
    });

    it('maps "extended" thinking to "high"', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'claude-opus-4-7';
        if (key === 'agent.thinkingLevel') return 'extended';
        return undefined;
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.thinking).toBe('high');
    });

    it('maps "minimal" thinking to "low"', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'claude-opus-4-7';
        if (key === 'agent.thinkingLevel') return 'minimal';
        return undefined;
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.thinking).toBe('low');
    });

    it('disables thinking when level is "none"', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'claude-opus-4-7';
        if (key === 'agent.thinkingLevel') return 'none';
        return undefined;
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.thinking).toBeUndefined();
    });
  });

  // ─── Multi-Provider Support ─────────────────────────────────────────

  describe('Multi-provider support', () => {
    it('uses moonshot provider for kimi models', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'kimi-k2.6';
        if (key === 'agent.thinkingLevel') return 'normal';
        return undefined;
      });
      vi.mocked(getStreamConfig).mockResolvedValue({
        provider: 'moonshot',
        apiKey: 'moonshot-key',
        baseUrl: 'https://api.moonshot.cn/v1',
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.provider).toBe('moonshot');
      expect(capturedAgentOptions!.apiKey).toBe('moonshot-key');
      expect(capturedAgentOptions!.baseUrl).toBe('https://api.moonshot.cn/v1');
    });

    it('enables cache retention for anthropic provider', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.cacheRetention).toBe('short');
    });

    it('disables cache retention for non-anthropic providers', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'kimi-k2.6';
        if (key === 'agent.thinkingLevel') return 'normal';
        return undefined;
      });
      vi.mocked(getStreamConfig).mockResolvedValue({
        provider: 'moonshot',
        apiKey: 'moonshot-key',
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.cacheRetention).toBe('none');
    });
  });

  // ─── System Prompt Building ─────────────────────────────────────────

  describe('System prompt building', () => {
    it('builds system prompt with static and dynamic parts', () => {
      const { engine } = createEngine();
      const { staticPrompt, dynamicPrompt } = engine.buildSystemPrompt();

      expect(staticPrompt).toContain('Frankie');
      expect(staticPrompt).toContain('Test system guidelines');
      expect(typeof dynamicPrompt).toBe('string');
    });

    it('getDeveloperPrompt returns system guidelines', () => {
      const { engine } = createEngine();
      expect(engine.getDeveloperPrompt()).toBe('Test system guidelines');
    });

    it('includes identity in static prompt', () => {
      const { engine } = createEngine();
      const { staticPrompt } = engine.buildSystemPrompt();
      expect(staticPrompt).toContain('# Frankie');
    });

    it('includes temporal context in dynamic prompt', () => {
      const { engine } = createEngine();
      const { dynamicPrompt } = engine.buildSystemPrompt();
      expect(dynamicPrompt).toContain('Current Time');
    });
  });

  // ─── Status Event Emission ──────────────────────────────────────────

  describe('Status event emission', () => {
    it('emits thinking status at start', async () => {
      setDefaultAgentEvents('Hi');
      const { engine, statusEmitter } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const thinkingEvent = statusEmitter.mock.calls.find(
        (args: unknown[]) => (args[0] as { type: string }).type === 'thinking'
      );
      expect(thinkingEvent).toBeDefined();
    });

    it('emits partial_text for text deltas', async () => {
      mockAgentEvents = [
        makeTextDelta('Hello '),
        makeTextDelta('world'),
        makeTurnEnd(1, { inputTokens: 100, outputTokens: 50 }),
        makeAgentDone(1, { inputTokens: 100, outputTokens: 50 }),
      ];
      const { engine, statusEmitter } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const textEvents = statusEmitter.mock.calls.filter(
        (args: unknown[]) => (args[0] as { type: string }).type === 'partial_text'
      );
      expect(textEvents.length).toBe(2);
      expect((textEvents[0][0] as { partialText: string }).partialText).toBe('Hello ');
      expect((textEvents[1][0] as { partialText: string }).partialText).toBe('world');
    });

    it('emits tool_start for tool_call_start events', async () => {
      mockAgentEvents = [
        { type: 'tool_call_start', name: 'web_fetch', args: { url: 'https://example.com' } },
        { type: 'tool_call_end', name: 'web_fetch' },
        makeTextDelta('Done'),
        makeTurnEnd(1, { inputTokens: 100, outputTokens: 50 }),
        makeAgentDone(1, { inputTokens: 100, outputTokens: 50 }),
      ];
      const { engine, statusEmitter } = createEngine();

      await engine.processMessage('fetch it', 'desktop', 'test-session');

      const toolStartEvent = statusEmitter.mock.calls.find(
        (args: unknown[]) => (args[0] as { type: string }).type === 'tool_start'
      );
      expect(toolStartEvent).toBeDefined();
      // formatToolName maps 'web_fetch' → 'fetching that page'
      expect((toolStartEvent![0] as { toolName: string }).toolName).toBe('fetching that page');
    });

    it('emits done status at end', async () => {
      setDefaultAgentEvents('Hi');
      const { engine, statusEmitter } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const doneEvent = statusEmitter.mock.calls.find(
        (args: unknown[]) => (args[0] as { type: string }).type === 'done'
      );
      expect(doneEvent).toBeDefined();
    });
  });

  // ─── Token Tracking ─────────────────────────────────────────────────

  describe('Token tracking', () => {
    it('returns tokensUsed from single turn', async () => {
      mockAgentEvents = [
        makeTextDelta('Hello'),
        makeTurnEnd(1, { inputTokens: 300, outputTokens: 75, cacheRead: 0, cacheWrite: 0 }),
        makeAgentDone(1, { inputTokens: 300, outputTokens: 75 }),
      ];
      const { engine } = createEngine();

      const result = await engine.processMessage('hi', 'desktop', 'test-session');
      expect(result.tokensUsed).toBe(375);
    });

    it('accumulates tokens across multiple turns', async () => {
      mockAgentEvents = [
        { type: 'tool_call_start', name: 'test_tool', args: {} },
        { type: 'tool_call_end', name: 'test_tool' },
        makeTurnEnd(1, { inputTokens: 200, outputTokens: 30 }),
        makeTextDelta('Done'),
        makeTurnEnd(2, { inputTokens: 400, outputTokens: 60 }),
        makeAgentDone(2, { inputTokens: 600, outputTokens: 90 }),
      ];
      const { engine } = createEngine();

      const result = await engine.processMessage('use tool', 'desktop', 'test-session');

      // 200 + 30 + 400 + 60 = 690
      expect(result.tokensUsed).toBe(690);
    });

    it('tracks cache stats in contextTokens', async () => {
      mockAgentEvents = [
        makeTextDelta('Hello'),
        makeTurnEnd(1, { inputTokens: 200, outputTokens: 50, cacheRead: 400, cacheWrite: 50 }),
        makeAgentDone(1, { inputTokens: 200, outputTokens: 50, cacheRead: 400, cacheWrite: 50 }),
      ];
      const { engine } = createEngine();

      const result = await engine.processMessage('hi', 'desktop', 'test-session');

      // contextTokens = inputTokens + cacheRead + cacheWrite = 200 + 400 + 50
      expect(result.contextTokens).toBe(650);
    });
  });

  // ─── Performance Logging ────────────────────────────────────────────

  describe('Performance logging', () => {
    it('logs session config at start', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      setDefaultAgentEvents('Hello');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const configLog = consoleSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('Session config')
      );
      expect(configLog).toBeDefined();
      expect(configLog![0]).toContain('claude-opus-4-7');
      expect(configLog![0]).toContain('anthropic');

      consoleSpy.mockRestore();
    });

    it('logs per-turn cache stats', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      mockAgentEvents = [
        makeTextDelta('Hello'),
        makeTurnEnd(1, { inputTokens: 500, outputTokens: 100, cacheRead: 400, cacheWrite: 50 }),
        makeAgentDone(1, { inputTokens: 500, outputTokens: 100, cacheRead: 400, cacheWrite: 50 }),
      ];
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const turnLog = consoleSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('Turn 1')
      );
      expect(turnLog).toBeDefined();
      expect(turnLog![0]).toContain('cache_read: 400');
      // cache_hit = 400 / (500 + 400 + 50) = 42%
      expect(turnLog![0]).toContain('cache_hit: 42%');

      consoleSpy.mockRestore();
    });

    it('logs completion summary', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      mockAgentEvents = [
        makeTextDelta('Hello'),
        makeTurnEnd(1, { inputTokens: 200, outputTokens: 50, cacheRead: 0, cacheWrite: 0 }),
        makeAgentDone(1, { inputTokens: 200, outputTokens: 50, cacheRead: 0, cacheWrite: 0 }),
      ];
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const summaryLog = consoleSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('[ChatEngine] Done')
      );
      expect(summaryLog).toBeDefined();
      expect(summaryLog![0]).toContain('250 total tokens');

      consoleSpy.mockRestore();
    });
  });

  // ─── Session Management ─────────────────────────────────────────────

  describe('Session management', () => {
    it('isQueryProcessing returns false when idle', () => {
      const { engine } = createEngine();
      expect(engine.isQueryProcessing('test-session')).toBe(false);
    });

    it('clearSession removes conversation history', async () => {
      setDefaultAgentEvents('Hello');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');
      engine.clearSession('test-session');

      // No error means success — session was cleared
      expect(engine.isQueryProcessing('test-session')).toBe(false);
    });

    it('stopQuery returns false when no query is processing', () => {
      const { engine } = createEngine();
      expect(engine.stopQuery('test-session')).toBe(false);
    });
  });

  // ─── Agent options ──────────────────────────────────────────────────

  describe('Agent options', () => {
    it('sets maxTurns to 20', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.maxTurns).toBe(20);
    });

    it('sets maxTokens to 16384', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.maxTokens).toBe(16384);
    });

    it('passes abort signal', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ─── compactConversation: empty-filter guard ───────────────────────

  describe('compactConversation empty-filter guard', () => {
    it('keeps original conversation when getSmartContext returns only tool-role messages', async () => {
      // Arrange: make shouldCompact return true so compaction is attempted
      ggcoderMocks.shouldCompact = true;
      ggcoderMocks.estimatedTokens = 999_999;

      const { engine, memory } = createEngine();

      // Pre-seed the session with some user/assistant messages by processing one round
      setDefaultAgentEvents('First reply');
      await engine.processMessage('first', 'desktop', 'compact-session');

      // Reset event sequence for the second message
      setDefaultAgentEvents('Second reply');

      // Mock getSmartContext to return only tool-role messages (no user/assistant)
      vi.mocked(memory.getSmartContext).mockResolvedValue({
        recentMessages: [
          { role: 'tool' as never, content: 'tool result 1' },
          { role: 'tool' as never, content: 'tool result 2' },
        ],
        rollingSummary: null,
      });

      // Act: process a second message, which will trigger compactConversation
      const consoleSpy = vi.spyOn(console, 'warn');
      await engine.processMessage('second', 'desktop', 'compact-session');

      // Assert: the warn was logged (fallback path was taken)
      const warnCall = consoleSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('smart context produced no user/assistant')
      );
      expect(warnCall).toBeDefined();

      consoleSpy.mockRestore();

      // Cleanup
      ggcoderMocks.shouldCompact = false;
      ggcoderMocks.estimatedTokens = 100;
    });
  });

  describe('Context window resolution', () => {
    it('returns 1_000_000 context window for deepseek-v4-pro', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'deepseek-v4-pro';
        if (key === 'agent.thinkingLevel') return 'none';
        if (key === 'deepseek.apiKey') return 'sk-test';
        return undefined;
      });
      setDefaultAgentEvents('Hello');
      const { engine } = createEngine();

      const result = await engine.processMessage('hi', 'desktop', 'test-session');

      expect(result.contextWindow).toBe(1_000_000);
    });

    it('returns 1_000_000 context window for deepseek-v4-flash', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'deepseek-v4-flash';
        if (key === 'agent.thinkingLevel') return 'none';
        if (key === 'deepseek.apiKey') return 'sk-test';
        return undefined;
      });
      setDefaultAgentEvents('Hello');
      const { engine } = createEngine();

      const result = await engine.processMessage('hi', 'desktop', 'test-session');

      expect(result.contextWindow).toBe(1_000_000);
    });

    it('returns 1_000_000 context window for claude-opus-4-7 (baseline check)', async () => {
      setDefaultAgentEvents('Hello');
      const { engine } = createEngine();

      const result = await engine.processMessage('hi', 'desktop', 'test-session');

      expect(result.contextWindow).toBe(1_000_000);
    });
  });

  // ─── Concurrency: queue ordering ──────────────────────────────────────────────

  describe('Concurrency — queue ordering', () => {
    it('queues a second processMessage that arrives mid-flight and runs it after the first finishes', async () => {
      // Build two gated iterators, one per processMessage call.
      const firstGate = createGate([
        makeTextDelta('first reply'),
        makeTurnEnd(1, { inputTokens: 100, outputTokens: 50 }),
        makeAgentDone(1, { inputTokens: 100, outputTokens: 50 }),
      ]);
      const secondGate = createGate([
        makeTextDelta('second reply'),
        makeTurnEnd(1, { inputTokens: 200, outputTokens: 60 }),
        makeAgentDone(1, { inputTokens: 200, outputTokens: 60 }),
      ]);
      pendingGates = [firstGate, secondGate];

      const { engine, statusEmitter } = createEngine();

      // Kick off the first message but don't await it — it should occupy the session.
      const firstPromise = engine.processMessage('first', 'desktop', 'queue-session');

      // Yield once so the engine reaches its first await and marks the session as processing.
      await Promise.resolve();
      await Promise.resolve();

      expect(engine.isQueryProcessing('queue-session')).toBe(true);

      // Second call should be queued, not executed immediately.
      const secondPromise = engine.processMessage('second', 'desktop', 'queue-session');

      // A 'queued' status must be emitted with queuePosition 1.
      const queuedEvent = statusEmitter.mock.calls.find(
        (args: unknown[]) => (args[0] as { type: string }).type === 'queued'
      );
      expect(queuedEvent).toBeDefined();
      expect((queuedEvent![0] as { queuePosition: number }).queuePosition).toBe(1);
      expect((queuedEvent![0] as { queuedMessage: string }).queuedMessage).toBe('second');

      // Release the first iteration so it can complete.
      firstGate.release();
      const firstResult = await firstPromise;
      expect(firstResult.response).toBe('first reply');

      // After the first finishes, processQueue should pick up the second.
      // Yield twice so the queued setTimeout(0) runs and starts execution.
      await new Promise((r) => setTimeout(r, 0));
      await Promise.resolve();
      await Promise.resolve();

      // A 'queue_processing' status should fire for the dequeued message.
      const queueProcessingEvent = statusEmitter.mock.calls.find(
        (args: unknown[]) => (args[0] as { type: string }).type === 'queue_processing'
      );
      expect(queueProcessingEvent).toBeDefined();
      expect((queueProcessingEvent![0] as { queuedMessage: string }).queuedMessage).toBe('second');

      // Now release the second gate and wait for it to finish.
      secondGate.release();
      const secondResult = await secondPromise;
      expect(secondResult.response).toBe('second reply');
    });

    it('preserves FIFO order for multiple queued messages', async () => {
      const firstGate = createGate([
        makeTextDelta('reply-1'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      const secondGate = createGate([
        makeTextDelta('reply-2'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      const thirdGate = createGate([
        makeTextDelta('reply-3'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      pendingGates = [firstGate, secondGate, thirdGate];

      const { engine, statusEmitter } = createEngine();

      const p1 = engine.processMessage('msg-1', 'desktop', 'fifo-session');
      await Promise.resolve();
      await Promise.resolve();

      const p2 = engine.processMessage('msg-2', 'desktop', 'fifo-session');
      const p3 = engine.processMessage('msg-3', 'desktop', 'fifo-session');

      // Two 'queued' events expected, with positions 1 then 2.
      const queuedEvents = statusEmitter.mock.calls
        .filter((args: unknown[]) => (args[0] as { type: string }).type === 'queued')
        .map((args: unknown[]) => args[0] as { queuePosition: number; queuedMessage: string });
      expect(queuedEvents.length).toBe(2);
      expect(queuedEvents[0].queuePosition).toBe(1);
      expect(queuedEvents[0].queuedMessage).toBe('msg-2');
      expect(queuedEvents[1].queuePosition).toBe(2);
      expect(queuedEvents[1].queuedMessage).toBe('msg-3');

      // Release in order, asserting each completes in turn.
      firstGate.release();
      const r1 = await p1;
      expect(r1.response).toBe('reply-1');

      await new Promise((r) => setTimeout(r, 0));
      secondGate.release();
      const r2 = await p2;
      expect(r2.response).toBe('reply-2');

      await new Promise((r) => setTimeout(r, 0));
      thirdGate.release();
      const r3 = await p3;
      expect(r3.response).toBe('reply-3');
    });
  });

  // ─── Concurrency: stopQuery clears queued work ─────────────────────────────

  describe('Concurrency — stopQuery clears queued work', () => {
    it('rejects all pending queued messages with "Queue cleared" and aborts the in-flight request', async () => {
      const firstGate = createGate([
        makeTextDelta('inflight'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      // No second gate is needed — the queued message must never start executing.
      pendingGates = [firstGate];

      const { engine } = createEngine();

      // Start an in-flight request.
      const inflight = engine.processMessage('first', 'desktop', 'stop-session');
      await Promise.resolve();
      await Promise.resolve();
      expect(engine.isQueryProcessing('stop-session')).toBe(true);

      // Queue two more.
      const queued1 = engine.processMessage('queued-1', 'desktop', 'stop-session');
      const queued2 = engine.processMessage('queued-2', 'desktop', 'stop-session');

      // Attach catchers so unhandled rejections don't blow up the test runner.
      const queued1Err = queued1.catch((e: Error) => e);
      const queued2Err = queued2.catch((e: Error) => e);

      // Stop the session — should reject queued items and abort the in-flight one.
      const stopped = engine.stopQuery('stop-session');
      expect(stopped).toBe(true);

      const e1 = await queued1Err;
      const e2 = await queued2Err;
      expect(e1).toBeInstanceOf(Error);
      expect(e1.message).toBe('Queue cleared');
      expect(e2).toBeInstanceOf(Error);
      expect(e2.message).toBe('Queue cleared');

      // The abort signal passed to agentLoop should be aborted.
      const signal = capturedAgentOptions!.signal as AbortSignal;
      expect(signal.aborted).toBe(true);

      // Release the gate so the in-flight call can wind down. The mocked
      // agentLoop does not honor the abort signal, so the call resolves with
      // its events — we just need it to settle so the engine cleans up.
      firstGate.release();
      const result = await inflight;
      expect(typeof result.response).toBe('string');

      // After everything settles, the session should be idle again.
      expect(engine.isQueryProcessing('stop-session')).toBe(false);
    });

    it('stopQuery returns false (and does nothing) when only queued items exist with no active processing', async () => {
      // Build an engine that will never have an in-flight request because we
      // never trigger one. Calling stopQuery on a sessionId with no queue and
      // no processor must return false.
      const { engine } = createEngine();
      expect(engine.stopQuery('idle-session')).toBe(false);
    });

    it('does not start a queued message after stopQuery clears the queue', async () => {
      const firstGate = createGate([
        makeTextDelta('done'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      // Provide a second gate — if the queue were not cleared, the engine would
      // start consuming it and the test would observe a second agentLoop call.
      const secondGate = createGate([
        makeTextDelta('should-not-run'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ]);
      pendingGates = [firstGate, secondGate];

      const { engine } = createEngine();

      const inflight = engine.processMessage('first', 'desktop', 'no-restart-session');
      await Promise.resolve();
      await Promise.resolve();

      const queued = engine.processMessage('queued', 'desktop', 'no-restart-session');
      const queuedErr = queued.catch((e: Error) => e);

      // Stop — clears the queue and aborts in-flight.
      engine.stopQuery('no-restart-session');

      const err = await queuedErr;
      expect((err as Error).message).toBe('Queue cleared');

      // Let the in-flight call wind down.
      firstGate.release();
      await inflight;

      // Drain any setTimeout(0) the engine schedules in finally{}.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      // Only the first gate should have been consumed — gateConsumerIndex tracks
      // how many agentLoop calls actually ran.
      expect(gateConsumerIndex).toBe(1);
    });
  });

  // ─── Heartbeat suppression for cron: channels ───────────────────────────

  describe('Heartbeat suppression for cron channels', () => {
    it('skips memory persistence when a cron: response is HEARTBEAT_OK', async () => {
      mockAgentEvents = [
        makeTextDelta('HEARTBEAT_OK'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ];
      const { engine, memory } = createEngine();

      const result = await engine.processMessage(
        'check the inbox',
        'cron:hourly-inbox-check',
        'cron-session'
      );

      expect(result.response).toBe('HEARTBEAT_OK');
      // saveToMemory must short-circuit — no user/assistant messages persisted.
      expect(memory.saveMessage).not.toHaveBeenCalled();
    });

    it('skips memory persistence when a cron: response is bold-wrapped HEARTBEAT_OK', async () => {
      mockAgentEvents = [
        makeTextDelta('**HEARTBEAT_OK**'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ];
      const { engine, memory } = createEngine();

      await engine.processMessage('routine', 'cron:nightly-routine', 'cron-session');

      expect(memory.saveMessage).not.toHaveBeenCalled();
    });

    it('persists messages with scheduler metadata for cron: when response is non-heartbeat', async () => {
      mockAgentEvents = [
        makeTextDelta('Three new emails arrived overnight.'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ];
      const { engine, memory } = createEngine();

      await engine.processMessage(
        'check the inbox',
        'cron:hourly-inbox-check',
        'cron-session'
      );

      // Both user and assistant messages should be saved with source: scheduler.
      const userCall = memory.saveMessage.mock.calls.find(
        (args: unknown[]) => args[0] === 'user'
      );
      const assistantCall = memory.saveMessage.mock.calls.find(
        (args: unknown[]) => args[0] === 'assistant'
      );
      expect(userCall).toBeDefined();
      expect(assistantCall).toBeDefined();
      expect((userCall![3] as { source: string }).source).toBe('scheduler');
      expect((userCall![3] as { jobName: string }).jobName).toBe('hourly-inbox-check');
      expect((assistantCall![3] as { source: string }).source).toBe('scheduler');
    });

    it('does NOT suppress HEARTBEAT_OK on non-cron channels (still persists)', async () => {
      mockAgentEvents = [
        makeTextDelta('HEARTBEAT_OK'),
        makeTurnEnd(1, { inputTokens: 10, outputTokens: 5 }),
        makeAgentDone(1, { inputTokens: 10, outputTokens: 5 }),
      ];
      const { engine, memory } = createEngine();

      await engine.processMessage('hi', 'desktop', 'desktop-session');

      // saveToMemory only short-circuits when channel.startsWith('cron:').
      expect(memory.saveMessage).toHaveBeenCalled();
    });
  });
});
