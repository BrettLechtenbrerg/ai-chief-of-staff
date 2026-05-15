/**
 * Context Extraction — Temporal context building and fact extraction
 *
 * Standalone functions extracted from AgentManager for building temporal
 * context strings and extracting user facts from conversation messages.
 */

import { SettingsManager } from '../settings';
import type { MemoryManager } from '../memory';

/**
 * Parse a DB timestamp string into a Date, respecting timezone settings.
 */
export function parseDbTimestamp(timestamp: string): Date {
  // If already has timezone indicator, parse directly
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(timestamp)) {
    return new Date(timestamp);
  }

  // Check if user has configured a timezone
  const userTimezone = SettingsManager.get('profile.timezone');

  if (userTimezone) {
    // User has timezone set - treat DB timestamps as UTC
    const normalized = timestamp.replace(' ', 'T');
    return new Date(normalized + 'Z');
  } else {
    // No timezone configured - use system local time
    const normalized = timestamp.replace(' ', 'T');
    return new Date(normalized);
  }
}

/**
 * Build temporal context for the system prompt.
 * Gives the agent awareness of current time and conversation timing.
 */
export function buildTemporalContext(lastMessageTimestamp?: string): string {
  const now = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[now.getDay()];

  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const dateStr = now.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const lines = ['## Current Time', `It is ${dayName}, ${dateStr} at ${timeStr}.`];

  // Add time since last message if available
  if (lastMessageTimestamp) {
    try {
      const lastDate = parseDbTimestamp(lastMessageTimestamp);
      const diffMs = now.getTime() - lastDate.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      let timeSince = '';
      if (diffMins < 1) timeSince = 'just now';
      else if (diffMins < 60) timeSince = `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
      else if (diffHours < 24) timeSince = `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
      else if (diffDays < 7) timeSince = `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
      else timeSince = lastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      lines.push(`Last message from user was ${timeSince}.`);
    } catch {
      // Ignore timestamp parsing errors
    }
  }

  return lines.join('\n');
}

/**
 * Extract facts from a user message and store them in memory.
 * Recognizes patterns like "my name is X", "I live in Y", "I work at Z".
 */
export function extractAndStoreFacts(memory: MemoryManager | null, userMessage: string): void {
  if (!memory) return;

  const patterns: Array<{ pattern: RegExp; category: string; subject: string }> = [
    { pattern: /my name is (\w+)/i, category: 'user_info', subject: 'name' },
    { pattern: /call me (\w+)/i, category: 'user_info', subject: 'name' },
    { pattern: /i live in ([^.,]+)/i, category: 'user_info', subject: 'location' },
    { pattern: /i'm from ([^.,]+)/i, category: 'user_info', subject: 'location' },
    { pattern: /i work (?:at|for) ([^.,]+)/i, category: 'work', subject: 'employer' },
    { pattern: /i work as (?:a |an )?([^.,]+)/i, category: 'work', subject: 'role' },
    { pattern: /my job is ([^.,]+)/i, category: 'work', subject: 'role' },
  ];

  for (const { pattern, category, subject } of patterns) {
    const match = userMessage.match(pattern);
    if (match && match[1]) {
      memory.saveFact(category, subject, match[1].trim());
      console.log(`[AgentManager] Extracted fact: [${category}] ${subject}: ${match[1]}`);
    }
  }
}
