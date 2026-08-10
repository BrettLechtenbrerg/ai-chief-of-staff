import { trustedHandle } from './trusted-ipc.js';
import { AgentManager } from '../../agent';
import type { IPCDependencies } from './types';

export function registerFactsIPC(deps: IPCDependencies): void {
  const { getMemory } = deps;

  // Facts
  trustedHandle('facts:list', async () => {
    return AgentManager.getAllFacts();
  });

  trustedHandle('facts:search', async (_, query: string) => {
    return AgentManager.searchFacts(query);
  });

  trustedHandle('facts:categories', async () => {
    return getMemory()?.getFactCategories() || [];
  });

  trustedHandle('facts:delete', async (_, id: number) => {
    const memory = getMemory();
    if (!memory) return { success: false };
    const success = memory.deleteFact(id);
    return { success };
  });

  // Soul (Self-Knowledge)
  trustedHandle('soul:list', async () => {
    const memory = getMemory();
    if (!memory) return [];
    return memory.getAllSoulAspects();
  });

  trustedHandle('soul:get', async (_, aspect: string) => {
    const memory = getMemory();
    if (!memory) return null;
    return memory.getSoulAspect(aspect);
  });

  trustedHandle('soul:delete', async (_, id: number) => {
    const memory = getMemory();
    if (!memory) return { success: false };
    const success = memory.deleteSoulAspectById(id);
    return { success };
  });

  // Memory usage stats
  trustedHandle('facts:memoryUsage', async () => {
    const memory = getMemory();
    if (!memory) return { usedChars: 0, budgetChars: 3000, pct: 0 };
    return memory.getFactsMemoryUsage();
  });

  trustedHandle('soul:memoryUsage', async () => {
    const memory = getMemory();
    if (!memory) return { usedChars: 0, budgetChars: 1500, pct: 0 };
    return memory.getSoulMemoryUsage();
  });

  trustedHandle('dailyLogs:memoryUsage', async () => {
    const memory = getMemory();
    if (!memory) return { usedChars: 0, budgetChars: 2000, pct: 0 };
    return memory.getDailyLogsMemoryUsage();
  });

  // Daily Logs
  trustedHandle('dailyLogs:list', async () => {
    return AgentManager.getDailyLogsSince(3);
  });

  trustedHandle('dailyLogs:delete', async (_, id: number) => {
    const memory = getMemory();
    if (!memory) return { success: false };
    const success = memory.deleteDailyLog(id);
    return { success };
  });
}
