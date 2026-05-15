import { ipcMain } from 'electron';
import { AgentManager } from '../../agent';
import type { IPCDependencies } from './types';

export function registerFactsIPC(deps: IPCDependencies): void {
  const { getMemory } = deps;

  // Facts
  ipcMain.handle('facts:list', async () => {
    return AgentManager.getAllFacts();
  });

  ipcMain.handle('facts:search', async (_, query: string) => {
    return AgentManager.searchFacts(query);
  });

  ipcMain.handle('facts:categories', async () => {
    return getMemory()?.getFactCategories() || [];
  });

  ipcMain.handle('facts:delete', async (_, id: number) => {
    const memory = getMemory();
    if (!memory) return { success: false };
    const success = memory.deleteFact(id);
    return { success };
  });

  // Soul (Self-Knowledge)
  ipcMain.handle('soul:list', async () => {
    const memory = getMemory();
    if (!memory) return [];
    return memory.getAllSoulAspects();
  });

  ipcMain.handle('soul:get', async (_, aspect: string) => {
    const memory = getMemory();
    if (!memory) return null;
    return memory.getSoulAspect(aspect);
  });

  ipcMain.handle('soul:delete', async (_, id: number) => {
    const memory = getMemory();
    if (!memory) return { success: false };
    const success = memory.deleteSoulAspectById(id);
    return { success };
  });

  // Memory usage stats
  ipcMain.handle('facts:memoryUsage', async () => {
    const memory = getMemory();
    if (!memory) return { usedChars: 0, budgetChars: 3000, pct: 0 };
    return memory.getFactsMemoryUsage();
  });

  ipcMain.handle('soul:memoryUsage', async () => {
    const memory = getMemory();
    if (!memory) return { usedChars: 0, budgetChars: 1500, pct: 0 };
    return memory.getSoulMemoryUsage();
  });

  ipcMain.handle('dailyLogs:memoryUsage', async () => {
    const memory = getMemory();
    if (!memory) return { usedChars: 0, budgetChars: 2000, pct: 0 };
    return memory.getDailyLogsMemoryUsage();
  });

  // Daily Logs
  ipcMain.handle('dailyLogs:list', async () => {
    return AgentManager.getDailyLogsSince(3);
  });

  ipcMain.handle('dailyLogs:delete', async (_, id: number) => {
    const memory = getMemory();
    if (!memory) return { success: false };
    const success = memory.deleteDailyLog(id);
    return { success };
  });
}
