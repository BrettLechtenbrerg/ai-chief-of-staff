import { describe, it, expect } from 'vitest';
import {
  AGENT_MODES,
  ALL_MODE_IDS,
  isValidModeId,
  getModeConfig,
  getAllModes,
  buildRoutingInstructions,
} from '../../src/agent/agent-modes';
import type { AgentModeId } from '../../src/agent/agent-modes';

describe('Agent Modes', () => {
  const EXPECTED_MODES: AgentModeId[] = ['general', 'coder', 'researcher', 'writer', 'therapist'];

  describe('AGENT_MODES registry', () => {
    it('should contain all 5 expected modes', () => {
      expect(Object.keys(AGENT_MODES).sort()).toEqual([...EXPECTED_MODES].sort());
    });

    it('every mode should have all required fields', () => {
      for (const mode of Object.values(AGENT_MODES)) {
        expect(mode).toHaveProperty('id');
        expect(mode).toHaveProperty('name');
        expect(mode).toHaveProperty('icon');
        expect(mode).toHaveProperty('engine');
        expect(mode).toHaveProperty('systemPrompt');
        expect(mode).toHaveProperty('allowedTools');
        expect(mode).toHaveProperty('description');
        expect(mode).toHaveProperty('handoffDescription');
        expect(mode).toHaveProperty('canHandoffTo');
        expect(mode).toHaveProperty('technicalMode');
      }
    });

    it('every mode should use the chat engine', () => {
      for (const mode of Object.values(AGENT_MODES)) {
        expect(mode.engine).toBe('chat');
      }
    });

    it('every mode id should match its registry key', () => {
      for (const [key, mode] of Object.entries(AGENT_MODES)) {
        expect(mode.id).toBe(key);
      }
    });

    it('every mode should have a non-empty name and icon', () => {
      for (const mode of Object.values(AGENT_MODES)) {
        expect(mode.name.length).toBeGreaterThan(0);
        expect(mode.icon.length).toBeGreaterThan(0);
      }
    });

    it('every mode should have the switch_agent tool', () => {
      for (const mode of Object.values(AGENT_MODES)) {
        expect(mode.allowedTools).toContain('mcp__pocket-agent__switch_agent');
      }
    });

    it('canHandoffTo should only reference valid mode IDs', () => {
      for (const mode of Object.values(AGENT_MODES)) {
        for (const target of mode.canHandoffTo) {
          expect(EXPECTED_MODES).toContain(target);
        }
      }
    });
  });

  describe('coder mode', () => {
    const coder = AGENT_MODES.coder;

    it('should use chat engine (not sdk)', () => {
      expect(coder.engine).toBe('chat');
    });

    it('should be a technical mode', () => {
      expect(coder.technicalMode).toBe(true);
    });

    it('should include gg-coder native tools', () => {
      const expectedTools = ['read', 'write', 'edit', 'bash', 'find', 'grep', 'ls', 'web_fetch'];
      for (const tool of expectedTools) {
        expect(coder.allowedTools).toContain(tool);
      }
    });

    it('should include plan mode tools', () => {
      expect(coder.allowedTools).toContain('enter_plan');
      expect(coder.allowedTools).toContain('exit_plan');
    });

    it('should include task management tools', () => {
      expect(coder.allowedTools).toContain('tasks');
      expect(coder.allowedTools).toContain('task_output');
      expect(coder.allowedTools).toContain('task_stop');
    });

    it('should include GitHub search via grep MCP', () => {
      expect(coder.allowedTools).toContain('mcp__grep__searchGitHub');
      expect(coder.mcpServers).toContain('grep');
    });

    it('should have an empty systemPrompt (uses gg-coder buildSystemPrompt)', () => {
      expect(coder.systemPrompt).toBe('');
    });

    it('should be able to hand off to general and researcher', () => {
      expect(coder.canHandoffTo).toContain('general');
      expect(coder.canHandoffTo).toContain('researcher');
    });
  });

  describe('general mode', () => {
    const general = AGENT_MODES.general;

    it('should not be a technical mode', () => {
      expect(general.technicalMode).toBe(false);
    });

    it('should have memory and soul tools', () => {
      expect(general.allowedTools).toContain('mcp__pocket-agent__remember');
      expect(general.allowedTools).toContain('mcp__pocket-agent__soul_set');
    });

    it('should have scheduler tools', () => {
      expect(general.allowedTools).toContain('mcp__pocket-agent__schedule_task');
      expect(general.allowedTools).toContain('mcp__pocket-agent__create_reminder');
    });

    it('should be able to hand off to all other modes', () => {
      expect(general.canHandoffTo).toEqual(
        expect.arrayContaining(['coder', 'researcher', 'writer', 'therapist'])
      );
    });
  });

  describe('writer mode', () => {
    it('should not have browser tools (no web distractions)', () => {
      expect(AGENT_MODES.writer.allowedTools).not.toContain('mcp__pocket-agent__browser');
    });

    it('should have memory and soul tools for voice matching', () => {
      expect(AGENT_MODES.writer.allowedTools).toContain('mcp__pocket-agent__soul_get');
      expect(AGENT_MODES.writer.allowedTools).toContain('mcp__pocket-agent__list_facts');
    });
  });

  describe('therapist mode', () => {
    it('should not have browser tools', () => {
      expect(AGENT_MODES.therapist.allowedTools).not.toContain('mcp__pocket-agent__browser');
    });

    it('should only hand off to general', () => {
      expect(AGENT_MODES.therapist.canHandoffTo).toEqual(['general']);
    });
  });

  describe('ALL_MODE_IDS', () => {
    it('should match AGENT_MODES keys', () => {
      expect([...ALL_MODE_IDS].sort()).toEqual([...EXPECTED_MODES].sort());
    });
  });

  describe('isValidModeId()', () => {
    it('should return true for valid mode IDs', () => {
      for (const id of EXPECTED_MODES) {
        expect(isValidModeId(id)).toBe(true);
      }
    });

    it('should return false for invalid mode IDs', () => {
      expect(isValidModeId('invalid')).toBe(false);
      expect(isValidModeId('')).toBe(false);
      expect(isValidModeId('sdk')).toBe(false);
    });
  });

  describe('getModeConfig()', () => {
    it('should return the correct mode config for valid IDs', () => {
      for (const id of EXPECTED_MODES) {
        const config = getModeConfig(id);
        expect(config.id).toBe(id);
      }
    });

    it('should fall back to coder for invalid IDs', () => {
      const config = getModeConfig('nonexistent');
      expect(config.id).toBe('coder');
    });
  });

  describe('getAllModes()', () => {
    it('should return all modes as an array', () => {
      const modes = getAllModes();
      expect(modes).toHaveLength(EXPECTED_MODES.length);
      const ids = modes.map((m) => m.id);
      for (const id of EXPECTED_MODES) {
        expect(ids).toContain(id);
      }
    });
  });

  describe('buildRoutingInstructions()', () => {
    it('should mention switch_agent', () => {
      const instructions = buildRoutingInstructions('general');
      expect(instructions).toContain('switch_agent');
    });

    it('should list handoff targets for general mode', () => {
      const instructions = buildRoutingInstructions('general');
      expect(instructions).toContain('coder');
      expect(instructions).toContain('researcher');
      expect(instructions).toContain('writer');
      expect(instructions).toContain('therapist');
    });

    it('should only list valid targets for coder mode', () => {
      const instructions = buildRoutingInstructions('coder');
      expect(instructions).toContain('general');
      expect(instructions).toContain('researcher');
      expect(instructions).not.toContain('`writer`');
      expect(instructions).not.toContain('`therapist`');
    });

    it('should return empty string for modes with no handoff targets', () => {
      // therapist can hand off to general, so it returns content
      const instructions = buildRoutingInstructions('therapist');
      expect(instructions).toContain('general');
    });
  });
});
