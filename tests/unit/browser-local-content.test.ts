import { beforeEach, describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({url:'https://example.test',read:vi.fn(async()=> 'synthetic content'),capture:vi.fn(async()=>({toPNG:()=>Buffer.from('synthetic image')}))}));
vi.mock('electron',()=>({
  app:{getPath:()=>'/tmp/synthetic-downloads'},
  BrowserWindow:class {
    webContents={getURL:()=>state.url,loadURL:vi.fn(async(url:string)=>{state.url=url;}),executeJavaScript:state.read,capturePage:state.capture,session:{on:vi.fn()}};
    on=vi.fn();isDestroyed=()=>false;hide=vi.fn();close=vi.fn();
  },
}));
import { ElectronTier } from '../../src/browser/electron-tier.js';

beforeEach(()=>{state.url='https://example.test';vi.clearAllMocks();});
describe('Electron browser local-document boundary',()=>{
  it.each(['screenshot','extract'] as const)('does not expose local content through %s',async(action)=>{
    const tier=new ElectronTier();await tier.navigate('https://example.test',1);
    state.read.mockClear();state.capture.mockClear();state.url='file:///tmp/synthetic-finance.html';
    try {
      const result=await tier.execute({action});expect(result.success).toBe(false);expect(result.error).toContain('blocked');
      expect(state.read).not.toHaveBeenCalled();expect(state.capture).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty('data');expect(result).not.toHaveProperty('screenshot');
    }finally{tier.close();}
  });
});
