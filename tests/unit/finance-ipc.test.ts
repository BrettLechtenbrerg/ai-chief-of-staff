import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPCDependencies } from '../../src/main/ipc/types.js';
import { financeRequest, FINANCE_READ_ACTIONS } from '../../src/finance/ipc-input.js';

const mocks = vi.hoisted(() => ({
  handlers:new Map<string,(event:unknown,value?:unknown)=>Promise<{success:boolean;data?:unknown;error?:string}>>(),
  request:vi.fn(),close:vi.fn(),dialog:vi.fn(),select:vi.fn(),visible:vi.fn(),trusted:vi.fn(),
  approval:vi.fn(),ai:vi.fn(),config:vi.fn(),setting:vi.fn(),save:vi.fn(),session:vi.fn(),rename:vi.fn(),
}));
vi.mock('electron',() => ({app:{getPath:()=>'/synthetic-private'},BrowserWindow:{fromWebContents:()=>({isDestroyed:()=>false,isVisible:mocks.visible})},dialog:{showMessageBox:mocks.dialog,showOpenDialog:mocks.select}}));
vi.mock('../../src/finance/client.js',() => ({FinanceClient:class {request=mocks.request;close=mocks.close;}}));
vi.mock('../../src/finance/ai-client.js',() => ({runApprovedFinanceAi:mocks.ai}));
vi.mock('../../src/main/ipc/trusted-ipc.js',() => ({trustedHandle:(name:string,handler:typeof mocks.handlers extends Map<string,infer T> ? T : never)=>mocks.handlers.set(name,handler),assertTrustedIpcSender:mocks.trusted}));
vi.mock('../../src/security/approval-manager.js',() => ({ApprovalManager:{request:mocks.approval}}));
vi.mock('../../src/settings/index.js',() => ({SettingsManager:{get:mocks.setting}}));
vi.mock('../../src/agent/providers.js',() => ({getProviderForModel:()=> 'anthropic',PROVIDER_CONFIGS:{anthropic:{}}}));
vi.mock('../../src/agent/chat-providers.js',() => ({getStreamConfig:mocks.config,THINKING_LEVEL_MAP:{normal:undefined}}));
import { registerFinanceIPC } from '../../src/main/ipc/finance-ipc.js';

const period={entityId:'personal',currency:'USD',year:2026};
const mutation={action:'createEntity',id:'new-personal',name:'Personal',kind:'personal'};
let sender:EventEmitter;
const call=(name:string,value?:unknown)=>mocks.handlers.get(`finance:${name}`)!({sender},value);
beforeEach(()=>{
  vi.resetAllMocks();mocks.handlers.clear();sender=new EventEmitter();mocks.visible.mockReturnValue(true);
  mocks.setting.mockImplementation((key:string)=>key==='agent.model' ? 'synthetic-model' : 'normal');
  mocks.request.mockImplementation(async(command:{action:string})=>command.action==='aiSummary' ? 'Anonymous aggregate only: USD income 100.00; no identifiers.' : {result:'saved'});
  mocks.dialog.mockResolvedValue({response:0});mocks.approval.mockResolvedValue(false);
  mocks.config.mockResolvedValue({provider:'anthropic',apiKey:'inert-test-token'});
  mocks.ai.mockResolvedValue({text:'Synthetic interpretation',complete:true});
  // Only getMemory is consumed by this module; no real app, schedules or providers are initialized.
  registerFinanceIPC({getMemory:()=>({ensureSession:mocks.session,renameSession:mocks.rename,saveMessage:mocks.save})} as unknown as IPCDependencies);
});

describe('finance IPC validation and approval boundaries',()=>{
  it('rejects worker-only commands, path injection and extra top-level fields',()=>{
    for(const value of [{action:'close'},{action:'loadCsv',filePath:'/private/raw.csv'},{action:'export',...period,destination:'/tmp'},{action:'report',...period,filePath:'/tmp'}]) expect(()=>financeRequest(value)).toThrow();
    for(const action of ['manualEntry','commitImport','void','saveStatement','saveBudget','saveRule','saveScenario','createEntity','backup']) expect(FINANCE_READ_ACTIONS.has(action)).toBe(false);
  });
  it('rejects non-integer money, oversized decisions and invalid ranges',()=>{
    expect(()=>financeRequest({action:'saveBudget',...period,categoryId:'food',start:'2026-01-01',months:1,amount:0.01,expected:null})).toThrow();
    expect(()=>financeRequest({action:'transactions',...period,offset:-1})).toThrow();
    expect(()=>financeRequest({action:'commitImport',entityId:'personal',id:'preview',decisions:Array(50001).fill({row:1,action:'keep'})})).toThrow();
  });
  it('validates optional currency mapping and does not accept a renderer summary',()=>{
    expect(()=>financeRequest({action:'previewImport',entityId:'personal',accountId:'checking',mapping:{delimiter:',',dateColumn:0,descriptionColumn:1,amountColumn:2,currencyColumn:64,amountMode:'signed',dateOrder:'ymd',decimal:'.'}})).toThrow();
    expect(()=>financeRequest({action:'aiSummary',...period,summary:'raw rows'})).toThrow();
  });
  it('names the exact ledger, account and request in a manual confirmation',async()=>{
    mocks.request.mockResolvedValue({entity:'Synthetic Personal',account:'Synthetic checking',accountId:'checking',currency:'USD',minorDigits:2,date:'2026-01-01',amountMinor:-100,description:'Synthetic entry',existingMatches:0,allocations:[]});
    await call('request',{action:'manualEntry',entityId:'personal',accountId:'checking',id:'exact-entry',date:'2026-01-01',amount:-100,description:'Synthetic entry',allocations:[{categoryId:'uncategorized',amountMinor:-100}]});
    const detail=mocks.dialog.mock.calls[0][1].detail;
    for(const value of ['Synthetic Personal','Synthetic checking','personal','checking','exact-entry'])expect(detail).toContain(value);
    expect(mocks.request).not.toHaveBeenCalledWith(expect.objectContaining({action:'manualEntry'}));
  });
  it('defaults local writes to Cancel and performs no write after rejection',async()=>{
    expect(await call('request',mutation)).toMatchObject({success:false});
    expect(mocks.dialog).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({defaultId:0,cancelId:0,buttons:['Cancel','Confirm']}));
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('binds the native confirmation to the exact validated mutation',async()=>{
    mocks.dialog.mockResolvedValue({response:1});expect(await call('request',mutation)).toMatchObject({success:true});
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(mutation);
  });
  it('denies a write when canceled while its confirmation is open',async()=>{
    let answer!:(value:{response:number})=>void;mocks.dialog.mockImplementation(()=>new Promise(resolve=>{answer=resolve;}));
    const pending=call('request',mutation);await vi.waitFor(()=>expect(mocks.dialog).toHaveBeenCalled());
    await call('cancel');answer({response:1});expect(await pending).toMatchObject({success:false});
    expect(mocks.request.mock.calls.map(([command])=>command.action)).toEqual(['cancelImport']);
  });
  it('requires a visible trusted desktop owner',async()=>{
    mocks.visible.mockReturnValue(false);expect(await call('request',mutation)).toMatchObject({success:false});
    expect(mocks.dialog).not.toHaveBeenCalled();mocks.visible.mockReturnValue(true);
    mocks.trusted.mockImplementation(()=>{throw new Error('Untrusted fixture');});
    expect(await call('request',mutation)).toMatchObject({success:false});expect(mocks.request).not.toHaveBeenCalled();
  });
  it('does not fetch credentials, contact AI or save chat before aggregate approval',async()=>{
    expect(await call('analyze',period)).toMatchObject({success:false});
    expect(mocks.approval).toHaveBeenCalledWith(expect.objectContaining({toolName:'finance.analyze_summary',capability:'external-write',channel:'desktop',args:expect.objectContaining({summary:expect.stringContaining('Anonymous aggregate'),destination:'https://api.anthropic.com',model:'synthetic-model'})}));
    expect(mocks.config).not.toHaveBeenCalled();expect(mocks.ai).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
  });
  it('runs only the approved aggregate with its pinned provider/model and fresh session',async()=>{
    mocks.approval.mockResolvedValue(true);expect(await call('analyze',period)).toMatchObject({success:true});
    expect(mocks.ai).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({summary:expect.stringContaining('Anonymous aggregate'),provider:'anthropic',model:'synthetic-model',origin:'https://api.anthropic.com'}),expect.any(AbortSignal));
    const approved=mocks.approval.mock.calls[0][0];expect(mocks.session).toHaveBeenCalledWith(approved.sessionId,'general');
    expect(mocks.ai.mock.calls[0][0]).not.toHaveProperty('messages');expect(mocks.ai.mock.calls[0][0]).not.toHaveProperty('tools');
  });
  it('rejects changed model settings after approval and stops on renderer loss',async()=>{
    mocks.approval.mockImplementation(async()=>{mocks.setting.mockReturnValue('changed');return true;});
    expect(await call('analyze',period)).toMatchObject({success:false});expect(mocks.ai).not.toHaveBeenCalled();
    mocks.setting.mockImplementation((key:string)=>key==='agent.model'?'synthetic-model':'normal');
    mocks.approval.mockImplementation(async()=>{sender.emit('destroyed');return true;});
    expect(await call('analyze',period)).toMatchObject({success:false});expect(mocks.ai).not.toHaveBeenCalled();
    expect(sender.listenerCount('destroyed')).toBe(0);
  });
  it('requires a Cancel-default receipt confirmation after file selection',async()=>{
    mocks.select.mockResolvedValue({canceled:false,filePaths:['/synthetic/receipt.pdf']});
    expect(await call('selectReceipt',{entityId:'personal',transactionId:'entry',id:'receipt'})).toMatchObject({success:false});
    expect(mocks.request).not.toHaveBeenCalled();expect(mocks.dialog).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({defaultId:0,detail:expect.stringContaining('/synthetic/receipt.pdf')}));
  });
});
