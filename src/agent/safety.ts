/**
 * Pre-tool-use safety validation for Pocket Agent
 *
 * Blocks dangerous commands that should NEVER be executed under any circumstances.
 * These patterns represent catastrophic operations with no legitimate use case.
 *
 * Pattern data lives in ./safety-patterns.ts; this file contains only logic.
 */

import path from 'path';

import {
  DANGEROUS_BASH_PATTERNS,
  DANGEROUS_BROWSER_PATTERNS,
  DANGEROUS_WRITE_PATHS,
} from './safety-patterns';

interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate a Bash command against dangerous patterns
 */
export function validateBashCommand(command: string): ValidationResult {
  const normalizedCommand = command.trim();

  for (const { pattern, reason } of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(normalizedCommand)) {
      console.warn(`[Safety] BLOCKED bash command: ${reason}`);
      console.warn(`[Safety] Command was: ${normalizedCommand.slice(0, 100)}...`);
      return { allowed: false, reason };
    }
  }

  return { allowed: true };
}

/**
 * Validate a file path for write operations
 */
export function validateWritePath(filePath: string): ValidationResult {
  // Expand ~ to home directory for pattern matching (cross-platform)
  const homeDir =
    process.env.HOME ||
    process.env.USERPROFILE ||
    (process.platform === 'win32' ? 'C:\\Users\\user' : '/home/user');
  const expandedPath = filePath.replace(/^~/, homeDir);

  // Normalize to resolve ../ traversal attempts and canonicalize separators
  const normalizedPath = path.resolve(expandedPath);

  for (const { pattern, reason } of DANGEROUS_WRITE_PATHS) {
    if (pattern.test(filePath) || pattern.test(expandedPath) || pattern.test(normalizedPath)) {
      console.warn(`[Safety] BLOCKED write path: ${reason}`);
      console.warn(`[Safety] Path was: ${filePath}`);
      return { allowed: false, reason };
    }
  }

  return { allowed: true };
}

/**
 * Validate a browser URL
 */
export function validateBrowserUrl(url: string): ValidationResult {
  for (const { pattern, reason } of DANGEROUS_BROWSER_PATTERNS) {
    if (pattern.test(url)) {
      console.warn(`[Safety] BLOCKED browser URL: ${reason}`);
      console.warn(`[Safety] URL was: ${url}`);
      return { allowed: false, reason };
    }
  }

  return { allowed: true };
}

/**
 * Main validation function for tool calls
 */
export function validateToolCall(
  toolName: string,
  input: Record<string, unknown>
): ValidationResult {
  // Bash command validation
  if (toolName === 'Bash' || toolName === 'bash') {
    const command = (input.command as string) || '';
    return validateBashCommand(command);
  }

  // Write/Edit file validation
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'write' || toolName === 'edit') {
    const filePath = (input.file_path as string) || '';
    return validateWritePath(filePath);
  }

  // Browser URL validation
  if (toolName === 'mcp__pocket-agent__browser') {
    const url = (input.url as string) || '';
    const action = (input.action as string) || '';

    if (action === 'navigate' && url) {
      return validateBrowserUrl(url);
    }
  }

  // All other tools pass through
  return { allowed: true };
}

// Status emitter type for UI updates
type StatusEmitter = (status: {
  type: 'tool_blocked';
  toolName: string;
  message: string;
  blockedReason: string;
}) => void;

// Module-level status emitter (set by agent)
let _statusEmitter: StatusEmitter | null = null;

/**
 * Set the status emitter for UI updates when tools are blocked
 */
export function setStatusEmitter(emitter: StatusEmitter): void {
  _statusEmitter = emitter;
}

/**
 * Get the current status emitter (if set)
 */
export function getStatusEmitter(): StatusEmitter | null {
  return _statusEmitter;
}
