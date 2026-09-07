import { app, BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FinanceClient } from '../../finance/client.js';
import { decimalMoney } from '../../finance/analysis.js';
import type { FinanceLedger } from '../../finance/ledger.js';
import type { FinanceCatalog } from '../../finance/types.js';
import { financeDelimiter, financePeriod, financeReceiptInput, financeRequest, FINANCE_READ_ACTIONS } from '../../finance/ipc-input.js';
import { runApprovedFinanceAi } from '../../finance/ai-client.js';
import { ApprovalManager } from '../../security/approval-manager.js';
import { SettingsManager } from '../../settings/index.js';
import { getProviderForModel, PROVIDER_CONFIGS } from '../../agent/providers.js';
import { getStreamConfig, THINKING_LEVEL_MAP } from '../../agent/chat-providers.js';
import { trustedHandle, assertTrustedIpcSender } from './trusted-ipc.js';
import type { IPCDependencies } from './types.js';

let cleanup:(()=>Promise<void>)|null=null;
export async function closeFinanceIPC():Promise<void> {await cleanup?.();}

function selectedModel() {
  const model=SettingsManager.get('agent.model');
  if(typeof model!=='string' || !model || model.length>160) throw new Error('Choose a model in Settings before AI analysis.');
  const provider=getProviderForModel(model);
  const oauth=provider==='openai' && SettingsManager.get('openai.auth.method')==='oauth';
  const accountId=oauth ? SettingsManager.get('openai.accountId') : undefined;
  if(oauth && !accountId) throw new Error('Re-authenticate OpenAI in Settings before AI analysis.');
  const defaults={anthropic:'https://api.anthropic.com',openai:oauth ? 'https://chatgpt.com/backend-api' : 'https://api.openai.com/v1',
    moonshot:'https://api.moonshot.ai/v1',glm:'https://api.z.ai/api/coding/paas/v4',xiaomi:'https://token-plan-sgp.xiaomimimo.com/v1',
    minimax:'https://api.minimax.io/anthropic',deepseek:'https://api.deepseek.com/v1'};
  const baseUrl=PROVIDER_CONFIGS[provider].baseUrl ?? defaults[provider];
  const origin=new URL(baseUrl).origin;
  const level=SettingsManager.get('agent.thinkingLevel') || 'normal';
  const thinking=level in THINKING_LEVEL_MAP ? THINKING_LEVEL_MAP[level] : THINKING_LEVEL_MAP.normal;
  return {model,provider,origin,baseUrl,thinking,accountId};
}

export function registerFinanceIPC(deps:IPCDependencies):void {
  const client=new FinanceClient(app.getPath('userData'));
  let epoch=0,busy=false,ai:AbortController|null=null;
  const owner=(event:IpcMainInvokeEvent)=>{
    assertTrustedIpcSender(event,'finance:request');
    const window=BrowserWindow.fromWebContents(event.sender);
    if(!window || window.isDestroyed() || !window.isVisible()) throw new Error('Open the desktop finance panel to continue.');
    return window;
  };
  const current=(event:IpcMainInvokeEvent,started:number)=>{
    owner(event);if(started!==epoch) throw new Error('Finance action canceled.');
  };
  const confirm=async(event:IpcMainInvokeEvent,started:number,title:string,detail:string)=>{
    const window=owner(event);
    const answer=await dialog.showMessageBox(window,{type:'warning',title:'Budget & Books',message:title,
      detail,buttons:['Cancel','Confirm'],defaultId:0,cancelId:0,noLink:true});
    current(event,started);return answer.response===1;
  };
  const handle=(channel:string,run:(event:IpcMainInvokeEvent,value:unknown,started:number)=>Promise<unknown>)=>{
    trustedHandle(channel,async(event,value:unknown)=>{
      const started=epoch;
      try {owner(event);return {success:true,data:await run(event,value,started)};}
      catch(error){return {success:false,error:error instanceof Error && !('code' in error) ? error.message : 'Finance operation failed. Check the selected location and available storage.'};}
    });
  };
  const exclusive=async<T>(run:()=>Promise<T>):Promise<T>=>{
    if(busy) throw new Error('Finish the current finance action first.');busy=true;
    try{return await run();}finally{busy=false;}
  };
  cleanup=async()=>{epoch++;ai?.abort();await client.close();};

  handle('finance:request',async(event,value,started)=>{
    const command=financeRequest(value);
    if(FINANCE_READ_ACTIONS.has(command.action)) return client.request(command);
    return exclusive(async()=>{
      let detail:unknown=command;
      if(command.action==='commitImport') detail=await client.request({...command,action:'reviewImport'});
      if(command.action==='manualEntry' || command.action==='allocate') {
        const preview=await client.request<ReturnType<FinanceLedger['previewManualEntry']>>('revision' in command ? {...command,action:'reviewAllocation'} : {...command,action:'reviewManual'});
        const formatted=(amount:number)=>`${preview.currency} ${decimalMoney(amount,preview.minorDigits)}`;
        detail={...command,entity:preview.entity,account:preview.account,accountId:preview.accountId,date:preview.date,description:preview.description,amount:formatted(preview.amountMinor),
          existingMatches:command.action==='manualEntry' ? preview.existingMatches : undefined,
          allocations:preview.allocations.map(row=>({categoryId:row.categoryId,category:row.category,amount:formatted(row.amountMinor)}))};
      }
      if(command.action==='void') detail=await client.request({...command,action:'reviewVoid'});
      if(command.action==='saveBudget' || command.action==='saveStatement' || command.action==='createAccount') {
        const catalog=await client.request<FinanceCatalog>({action:'catalog'});
        const account=command.action==='saveStatement' ? catalog.accounts.find(row=>row.entity_id===command.entityId && row.id===command.accountId) : undefined;
        const currency=command.action==='saveStatement' ? account?.currency : command.currency;
        const precision=command.action==='createAccount' ? command.precision : account?.minor_digits ?? catalog.accounts.find(row=>row.entity_id===command.entityId && row.currency===currency)?.minor_digits;
        if(!currency || precision===undefined) throw new Error('Account currency unavailable.');
        const value=command.action==='saveBudget' ? command.amount : command.balance;
        detail={...command,amount:undefined,balance:undefined,formattedAmount:`${currency} ${decimalMoney(value,precision)}`,
          entity:catalog.entities.find(row=>row.id===command.entityId)?.name,account:account?.alias,
          category:command.action==='saveBudget' ? catalog.categories.find(row=>row.id===command.categoryId && row.entity_id===command.entityId)?.name : undefined};
      }
      if(!await confirm(event,started,'Confirm this local financial change',JSON.stringify(detail,null,2)+'\n\nOnly the local ledger changes. Originals and edit history are preserved. No message or payment will be sent.')) throw new Error('Finance action canceled.');
      return client.request(command);
    });
  });
  handle('finance:selectCsv',async(event,value,started)=>exclusive(async()=>{
    const delimiter=financeDelimiter(value);
    const selected=await dialog.showOpenDialog(owner(event),{title:'Select a bank/card CSV to review locally',properties:['openFile'],filters:[{name:'CSV',extensions:['csv']}]});
    current(event,started);if(selected.canceled || selected.filePaths.length!==1) return null;
    return client.request({action:'loadCsv',filePath:selected.filePaths[0],delimiter});
  }));
  handle('finance:selectReceipt',async(event,value,started)=>exclusive(async()=>{
    const input=financeReceiptInput(value);
    const selected=await dialog.showOpenDialog(owner(event),{title:'Select a local receipt reference (not copied or sent)',properties:['openFile'],filters:[{name:'Receipts',extensions:['pdf','png','jpg','jpeg','webp','txt']}]});
    current(event,started);if(selected.canceled || selected.filePaths.length!==1) return null;
    if(!await confirm(event,started,'Save this local receipt reference?',JSON.stringify({...input,filePath:selected.filePaths[0]},null,2)+'\n\nOnly a pointer is saved. The file is not copied, backed up or sent.')) throw new Error('Receipt selection canceled.');
    return client.request({action:'addReceipt',...input,filePath:selected.filePaths[0]});
  }));
  handle('finance:export',async(event,value,started)=>exclusive(async()=>{
    const period=financePeriod(value);
    // Initialize/validate the local scope before offering the private default folder.
    await client.request({action:'report',...period});current(event,started);
    const selected=await dialog.showOpenDialog(owner(event),{title:'Choose a private local accountant-packet folder',
      defaultPath:path.join(app.getPath('userData'),'finance'),properties:['openDirectory','createDirectory']});
    current(event,started);if(selected.canceled || selected.filePaths.length!==1) return null;
    const destination=selected.filePaths[0];
    if(!await confirm(event,started,'Export a sensitive accountant-preparation packet?',
      `${period.year}, ${period.currency}\nDestination: ${destination}\n\nIncludes original transaction details, allocations, receipt paths and review exceptions. Files are unencrypted. A synced/shared folder may copy them off this Mac. Choose a private folder unless you explicitly intend that sharing. Existing packets are never overwritten.\n\nNo bank access, email, audited statements or tax filing is included.`)) throw new Error('Export canceled.');
    return client.request({action:'export',...period,destination});
  }));
  handle('finance:cancel',async()=>{
    epoch++;ai?.abort();return client.request({action:'cancelImport'});
  });
  handle('finance:analyze',async(event,value,started)=>{
    if(ai) throw new Error('An AI analysis is already pending.');
    const controller=new AbortController();ai=controller;
    const destroyed=()=>controller.abort();event.sender.once('destroyed',destroyed);
    try {
      const period=financePeriod(value);const target=selectedModel();
      const summary=await client.request<string>({action:'aiSummary',...period});
      current(event,started);controller.signal.throwIfAborted();
      const sessionId=randomUUID();
      const approved=await ApprovalManager.request({toolName:'finance.analyze_summary',capability:'external-write',sessionId,channel:'desktop',signal:controller.signal,
        args:{notice:'Only this redacted aggregate will be sent and saved in a new chat. No names, source rows, receipt text, identifiers, tools or prior chat history. The saved chat follows normal retention and future routing you choose. Provider charges/retention apply. Up to three HTTP attempts, a 90-second deadline; token limits vary by transport.',
          provider:target.provider,model:target.model,destination:target.origin,thinking:target.thinking ?? 'disabled',summary}});
      current(event,started);controller.signal.throwIfAborted();
      if(!approved) throw new Error('AI analysis not approved. Nothing was sent.');
      if(JSON.stringify(selectedModel())!==JSON.stringify(target)) throw new Error('Model or destination changed; review a new approval.');
      const config=await getStreamConfig(target.model).catch(()=>{throw new Error('Provider authentication unavailable. Check Settings and review a new approval.');});
      current(event,started);controller.signal.throwIfAborted();
      if(JSON.stringify(selectedModel())!==JSON.stringify(target) || config.provider!==target.provider || config.accountId!==target.accountId || !config.apiKey) throw new Error('Provider configuration changed; review a new approval.');
      const memory=deps.getMemory();if(!memory) throw new Error('Chat storage unavailable; AI analysis was not sent.');
      memory.ensureSession(sessionId,'general');memory.renameSession(sessionId,'Budget analysis (approved aggregates)');
      memory.saveMessage('user',summary,sessionId,{source:'finance-approved-aggregate',provider:target.provider,model:target.model});
      const result=await runApprovedFinanceAi({kind:'finance-ai',...target,apiKey:config.apiKey,summary},controller.signal);
      const response=(result.complete ? '' : 'Partial AI response; do not treat this as complete.\n\n')+result.text;
      let saved=true;
      try {memory.saveMessage('assistant',response,sessionId,{source:'finance-analysis',provider:target.provider,model:target.model});}
      catch {saved=false;}
      return {response,sessionId,saved,complete:result.complete,notice:saved ? 'AI interpretation saved separately from the authoritative local ledger.' : 'Analysis returned, but its response could not be saved to chat. Preserve the displayed response before closing.'};
    } finally {event.sender.removeListener('destroyed',destroyed);controller.abort();if(ai===controller)ai=null;}
  });
}
