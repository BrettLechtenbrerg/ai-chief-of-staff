import { ipcMain } from 'electron';
import type { IPCDependencies } from './types';
import type { BrandInput, BrandUpdate } from '../../memory';
import { listPublishProfiles } from '../brand-profiles';

/**
 * IPC for the first-class multi-brand feature. Brands live in the shared
 * SQLite DB (brands table) and are resolved per-session via sessions.brand_id.
 * Mirrors the CRUD shape of sessions-ipc.
 */
export function registerBrandsIPC(deps: IPCDependencies): void {
  const { getMemory } = deps;

  ipcMain.handle('brands:list', async () => {
    return getMemory()?.listBrands() || [];
  });

  // Publishing profiles from ~/dev/_brand-profiles ([] when the dir is absent).
  ipcMain.handle('brands:listPublishProfiles', async () => {
    return listPublishProfiles();
  });

  ipcMain.handle('brands:create', async (_, input: BrandInput) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not ready' };
      const brand = memory.createBrand(input);
      return { success: true, brand };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('brands:update', async (_, id: string, update: BrandUpdate) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not ready' };
      const brand = memory.updateBrand(id, update);
      if (!brand) return { success: false, error: 'Brand not found' };
      return { success: true, brand };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('brands:delete', async (_, id: string) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not ready' };
      const success = memory.deleteBrand(id);
      return { success };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('brands:setDefault', async (_, id: string) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not ready' };
      const success = memory.setDefaultBrand(id);
      return { success };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Target a session at a specific brand (null clears → uses default brand).
  ipcMain.handle('sessions:setBrand', async (_, sessionId: string, brandId: string | null) => {
    try {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not ready' };
      const success = memory.setSessionBrandId(sessionId, brandId);
      return { success };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
