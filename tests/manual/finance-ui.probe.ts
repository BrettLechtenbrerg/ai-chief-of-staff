import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { FinanceDatabase } from '../../src/finance/database.js';
import { FinanceRuntime } from '../../src/finance/worker.js';
import { financeRequest } from '../../src/finance/ipc-input.js';
import { THEMES } from '../../src/settings/themes.js';
import { readWebPage } from '../../src/browser/web-read.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const directory=fs.mkdtempSync(path.join(root,'.gg/finance-ui-'));
const evidence=path.join(directory,'screens');fs.mkdirSync(evidence);
const csv=path.join(directory,'synthetic.csv');
fs.writeFileSync(csv,'Date,Description,Amount,Currency\n2026-01-02,Synthetic rent,-1200.00,USD\n2026-01-02,Synthetic rent,-1200.00,USD\n2026-02-02,Foreign currency,-5.00,EUR\n');
const errors:string[]=[];
const calls:string[]=[];
let runtime:FinanceRuntime,browser:Browser,page:Page,electron:ChildProcess|undefined;
const native=process.env.FINANCE_ELECTRON_FIXTURE==='1';
const humanReview=native && process.env.FINANCE_VOICEOVER_CHECK==='1';
let humanReviewOpened=false;
let fixtureLaunchMs=0;
let rejectNext=false,failReport=false;
const proxy=http.createServer((_request,response)=>response.writeHead(403).end());
proxy.on('connect',(_request,socket)=>socket.destroy());proxy.on('clientError',(_error,socket)=>socket.destroy());
const idle=async()=>{await page.waitForFunction(()=>document.getElementById('budget-view')?.getAttribute('aria-busy')==='false');};
const click=async(selector:string)=>{await page.click(selector);await idle();expect(await page.$eval('#budget-error',e=>(e as HTMLElement).hidden ? '' : e.textContent)).toBe('');};
const fill=async(selector:string,value:string)=>{await page.$eval(selector,(e,value)=>{(e as HTMLInputElement).value=value;e.dispatchEvent(new Event('input',{bubbles:true}));},value);};
const tab=async(name:string)=>click(`[data-budget-tab="${name}"]`);
const submit=async(id:string)=>click(`button[form="budget-form-${id}"]`);
const requestApproval=async()=>page.evaluate("fixtureApproval({id:'synthetic-review',sessionId:'synthetic-only',toolName:'send_message',capability:'external-write',summary:'Synthetic approval. No message can be sent.',details:'Destination: example.invalid. Message: synthetic only.',expiresAt:Date.now()+900000})");

beforeAll(async()=>{
  runtime=new FinanceRuntime(await FinanceDatabase.open(directory));
  await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const address=proxy.address();if(!address || typeof address==='string')throw new Error('Proxy unavailable');
  const environment={HOME:directory,TMPDIR:'/private/tmp',PATH:'/usr/bin:/bin:/usr/sbin:/sbin'};
  const launchStarted=performance.now();
  if(native){
    electron=spawn(path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[path.join(root,'tests/manual/finance-electron.cjs')],{
      env:{...environment,FINANCE_VOICEOVER_CHECK:humanReview ? '1' : '0',FINANCE_UI_PROFILE:directory,FINANCE_UI_PROXY:`http://127.0.0.1:${address.port}`},stdio:['ignore','ignore','pipe']});
    const endpoint=await new Promise<string>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Isolated Electron debugger did not start.')),15000);let output='';
      electron!.once('error',error=>{clearTimeout(timer);reject(error);});
      electron!.once('exit',()=>{clearTimeout(timer);reject(new Error('Isolated Electron exited before connection.'));});
      electron!.stderr!.on('data',chunk=>{output=(output+chunk.toString()).slice(-8192);const match=output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    });
    browser=await puppeteer.connect({browserWSEndpoint:endpoint});
    const target=await browser.waitForTarget(target=>target.type()==='page');const nativePage=await target.page();
    if(!nativePage)throw new Error('Isolated Electron page unavailable');page=nativePage;
  }else{
    browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,pipe:true,
      userDataDir:path.join(directory,'profile'),env:environment,
      args:[`--proxy-server=http://127.0.0.1:${address.port}`,'--disable-background-networking','--disable-component-update']});
    page=await browser.newPage();
  }
  page.setDefaultTimeout(5000);await page.setViewport({width:1280,height:900});
  page.on('pageerror',error=>errors.push(String(error)));
  await page.setRequestInterception(true);page.on('request',request=>/^(file:|data:|about:)/.test(request.url()) ? void request.continue() : void request.abort());
  await page.exposeFunction('fixtureFinance',async(method:string,value:unknown)=>{
    try {
      if(rejectNext){rejectNext=false;throw new Error('Synthetic canceled confirmation.');}
      if(method==='selectCsv') return {success:true,data:await runtime.execute({action:'loadCsv',filePath:csv,delimiter:','})};
      if(method==='cancel')return {success:true,data:await runtime.execute({action:'cancelImport'})};
      if(method==='analyze') {calls.push('analyze');throw new Error('Synthetic AI approval denied. Nothing sent.');}
      if(method!=='request')throw new Error('Unsupported fixture operation');
      const command=financeRequest(value);calls.push(command.action);
      if(command.action==='report' && failReport){failReport=false;throw new Error('Synthetic unavailable ledger scope.');}
      return {success:true,data:await runtime.execute(command)};
    }catch(error){return {success:false,error:error instanceof Error ? error.message : 'Synthetic failure'};}
  });
  let html=fs.readFileSync(path.join(root,'ui/chat.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
  const bridge=`<script>for(const name of ['playNormalClick','rejectPlan','approvePlan','handleSearchInput','handleSearchKeydown','handleKeydown','handleInput','handleSendClick','handleFileSelect'])window[name]=()=>{};window.pocketAgent={approval:{onRequested:callback=>window.fixtureApproval=callback,resolve:async(_id,decision)=>{window.fixtureApprovalDecision=decision;return {success:true};}},connectTools:{listSupported:async()=>[{id:'fixture',name:'Synthetic connector',description:'Fixture only. No real service or credentials.',authType:'api-key',fields:[{key:'token',label:'Synthetic token',secret:true,placeholder:'Never enter real credentials'}]}],getStatus:async()=>[{id:'fixture',status:'disconnected'}],detectMigratable:async()=>[]},finance:Object.fromEntries(['request','selectCsv','selectReceipt','cancel','analyze','export'].map(method=>[method,value=>fixtureFinance(method,value)])),themes:{list:async()=>(${JSON.stringify(THEMES)}),getSkin:async()=>'orbital-command',onSkinChanged:callback=>window.changeSkin=callback}};</script><script src="shared/theme-loader.js"></script><script src="chat/sidebar.js"></script><script src="chat/settings-panel.js"></script><script src="chat/budget-panel.js"></script><script src="chat/connect-tools-panel.js"></script><script src="chat/approval.js"></script><script src="chat/event-bindings.js"></script>`;
  html=html.replace('<head>',`<head><base href="${pathToFileURL(path.join(root,'ui/')).href}">`).replace('</body>',bridge+'</body>');
  const fixture=path.join(directory,'fixture.html');fs.writeFileSync(fixture,html);
  await page.goto(pathToFileURL(fixture).href);
  await page.evaluate(()=>{document.body.classList.add('app-ready');});
  await page.waitForFunction(()=>typeof (window as unknown as {showBudgetPanel?:unknown}).showBudgetPanel==='function');
  await click('#sidebar-budget-btn');
  fixtureLaunchMs=Math.round(performance.now()-launchStarted);
});

afterAll(async()=>{
  if(page && !page.isClosed())await page.screenshot({path:path.join(evidence,'last-state.png')});
  if(browser?.connected && !page?.isClosed())await browser.close();
  if(electron && electron.exitCode===null){
    const ended=new Promise<void>(resolve=>electron!.once('exit',()=>resolve()));
    const force=setTimeout(()=>electron!.kill('SIGKILL'),5000);electron.kill('SIGTERM');await ended;clearTimeout(force);
  }
  if(runtime)await runtime.execute({action:'close'});
  proxy.closeAllConnections();await new Promise<void>(resolve=>proxy.close(()=>resolve()));
  fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({native,errors,calls,humanReview:humanReviewOpened ? 'opened; human verdict pending' : humanReview ? 'requested but not opened' : 'not requested'},null,2));
  console.info('Synthetic finance UI evidence:',directory);
  // All artifacts contain synthetic records only and remain in the ignored .gg directory.
});

it('completes local setup, exact manual entry, drafts, currency-checked CSV and denied AI',async()=>{
  expect(await page.$eval('#budget-body',e=>e.textContent)).toContain('Start a local personal ledger');
  await tab('plan');await fill('#budget-form-entity-name','Synthetic Personal');await submit('entity');
  await page.$eval('#budget-form-account',e=>{e.closest('details')!.open=true;});
  await fill('#budget-form-account-alias','Synthetic checking');await fill('#budget-form-account-date','2026-01-01');await submit('account');
  await fill('#budget-year','2026');await page.$eval('#budget-year',e=>e.dispatchEvent(new Event('change',{bubbles:true})));await idle();
  await tab('transactions');
  await page.$eval('#budget-form-entry-new',e=>{e.closest('details')!.open=true;});
  await fill('#budget-form-entry-new-date','2026-01-03');await fill('#budget-form-entry-new-description','Synthetic exact entry');
  await fill('#budget-form-entry-new-amount','-12.34');await fill('#budget-form-entry-new-split-amount-0','-12.34');
  rejectNext=true;await page.click('button[form="budget-form-entry-new"]');await idle();
  expect(await page.$eval('#budget-error',e=>e.textContent)).toContain('Synthetic canceled');
  expect(await page.$eval('#budget-form-entry-new-amount',e=>(e as HTMLInputElement).value)).toBe('-12.34');
  await submit('entry-new');
  expect(await page.$eval('#budget-body',e=>e.textContent)).toContain('USD -12.34');
  await fill('#budget-form-entry-new-description','Unsaved local draft');await tab('overview');await tab('transactions');
  expect(await page.$eval('#budget-form-entry-new-description',e=>(e as HTMLInputElement).value)).toBe('Unsaved local draft');
  await tab('import');await page.$$eval('#budget-body button',buttons=>(buttons.find(e=>e.textContent==='Choose CSV') as HTMLButtonElement).click());await idle();
  await page.select('#budget-form-import-map-dateColumn','0');await page.select('#budget-form-import-map-descriptionColumn','1');await page.select('#budget-form-import-map-amountColumn','2');await page.select('#budget-form-import-map-currencyColumn','3');
  await submit('import-map');
  expect(await page.$eval('#budget-body',e=>e.textContent)).toContain('1 invalid');
  await page.select('select[aria-label="Decision for source row 1"]','keep');
  await page.select('select[aria-label="Decision for source row 2"]','skip');
  await page.select('select[aria-label="Decision for source row 3"]','skip');
  expect(await page.$eval('#budget-body',e=>e.textContent)).toContain('USD -1200.00');
  await page.$$eval('#budget-body button',buttons=>{(buttons.find(e=>e.textContent==='Review totals and import') as HTMLButtonElement).click();});await idle();
  expect(await page.$eval('#budget-error',e=>(e as HTMLElement).hidden)).toBe(true);
  await tab('overview');
  expect(await page.$eval('#budget-body',e=>e.textContent)).toContain('2 included transactions');
  await page.click('#budget-analyze');await idle();
  expect(await page.$eval('#budget-error',e=>e.textContent)).toContain('approval denied');
  expect(calls.filter(value=>value==='analyze')).toHaveLength(1);
  expect(await page.evaluate(()=>Object.keys(localStorage).some(key=>/finance|budget/.test(key)))).toBe(false);
  expect(errors).toEqual([]);
});

it('keeps keyboard focus at the reviewed action when confirmation is canceled',async()=>{
  await tab('transactions');
  await page.$eval('#budget-form-entry-new',e=>{e.closest('details')!.open=true;});
  await fill('#budget-form-entry-new-description','Synthetic rejected keyboard edit');
  await fill('#budget-form-entry-new-amount','-12.00');await fill('#budget-form-entry-new-split-amount-0','-12.00');
  await page.focus('button[form="budget-form-entry-new"]');rejectNext=true;
  await page.keyboard.press('Enter');await idle();
  expect(await page.evaluate(()=>document.activeElement?.getAttribute('form'))).toBe('budget-form-entry-new');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(()=>document.activeElement?.textContent)).toBe('Add split');
});

it('does not show old-year totals under a failed new-year selection',async()=>{
  await tab('overview');failReport=true;
  await fill('#budget-year','2027');await page.$eval('#budget-year',e=>e.dispatchEvent(new Event('change',{bubbles:true})));await idle();
  expect(await page.$eval('#budget-error',e=>e.textContent)).toContain('unavailable ledger scope');
  expect(await page.$eval('#budget-body',e=>e.textContent)).not.toContain('2 included transactions');
  expect(await page.$eval('#budget-analyze',e=>(e as HTMLButtonElement).disabled)).toBe(true);
  await fill('#budget-year','2026');await page.$eval('#budget-year',e=>e.dispatchEvent(new Event('change',{bubbles:true})));await idle();
  expect(await page.$eval('#budget-body',e=>e.textContent)).toContain('2 included transactions');
});

it('restores keyboard focus and clears unrelated import notices after a successful save',async()=>{
  await tab('transactions');await page.$eval('#budget-form-entry-new',e=>{e.closest('details')!.open=true;});
  await page.focus('button[form="budget-form-entry-new"]');await page.keyboard.press('Enter');await idle();
  expect(await page.$eval('#budget-error',e=>(e as HTMLElement).hidden)).toBe(true);
  expect(await page.evaluate(()=>document.activeElement!==document.body && document.getElementById('budget-view')?.contains(document.activeElement))).toBe(true);
  expect(await page.$eval('#budget-notice',e=>e.textContent)).toBe('');
});

it('measures primary-action and empty-money-field contrast in the rendered theme',async()=>{
  const measurements=await page.$$eval('#budget-view .budget-primary, #budget-view input[placeholder]',elements=>elements.filter(e=>(e as HTMLElement).offsetParent!==null).map(e=>({
    control:e.id || e.textContent,foreground:getComputedStyle(e,e.hasAttribute('placeholder')?'::placeholder':null).color,
    background:getComputedStyle(e).backgroundColor,
  })));
  const luminance=(color:string)=>{
    const rgb=color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(c=>c/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
    return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
  };
  const ratios=measurements.map(row=>{const a=luminance(row.foreground),b=luminance(row.background);return {control:row.control,ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};});
  fs.writeFileSync(path.join(directory,'contrast.json'),JSON.stringify(ratios,null,2));
  expect(ratios.filter(row=>row.ratio<4.5)).toEqual([]);
});

it('hides chat-only clearing controls while a ledger is active',async()=>{
  expect(await page.$eval('#fresh-start-btn',e=>getComputedStyle(e).display)).toBe('none');
});

it('keeps secondary actions visually separate from primary confirmation',async()=>{
  const colors=await page.evaluate(()=>({
    secondary:getComputedStyle(document.getElementById('budget-refresh')!).backgroundColor,
    field:getComputedStyle(document.getElementById('budget-currency')!).backgroundColor,
  }));
  expect(colors.secondary).toBe(colors.field);
});

it('renders all budget sections at desktop and narrow sizes with named controls',async()=>{
  for(const width of [1600,1280,800,640,320]) {
    await page.setViewport({width,height:900});
    await page.$eval('#sidebar',(e,width)=>e.classList.toggle('collapsed',width<=800),width);
    for(const name of ['overview','transactions','import','plan']) {
      await tab(name);await page.evaluate(()=>document.fonts.ready);
      const issues=await page.$eval('#budget-view',view=>({
        overflow:view.scrollWidth>view.clientWidth+1,
        unnamed:[...view.querySelectorAll('input,select,button')].filter(e=>{
          if((e as HTMLElement).offsetParent===null)return false;
          return !e.getAttribute('aria-label') && !e.textContent?.trim() && !(e as HTMLInputElement).labels?.length;
        }).map(e=>e.id),
      }));
      expect(issues).toEqual({overflow:false,unnamed:[]});
      await page.screenshot({path:path.join(evidence,`${width}-${name}.png`)});
    }
  }
  expect(errors).toEqual([]);
});

it('exposes named regions and supports keyboard, reduced motion, forced colors and RTL',async()=>{
  await page.setViewport({width:1280,height:900});await tab('overview');
  const cdp=await page.createCDPSession();
  const tree=await cdp.send('Accessibility.getFullAXTree');
  expect(tree.nodes.some(node=>node.role?.value==='region' && node.name?.value==='Budget & Books')).toBe(true);
  fs.writeFileSync(path.join(directory,'accessibility-tree.json'),JSON.stringify(tree,null,2));
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  expect(await page.$eval('#budget-refresh',e=>getComputedStyle(e).transitionDuration)).toBe('0s');
  await page.focus('#budget-year');await page.keyboard.press('Tab');
  expect(await page.evaluate(()=>document.activeElement?.matches(':focus-visible'))).toBe(true);
  expect(await page.evaluate(()=>getComputedStyle(document.activeElement!).outlineWidth)).toBe('2px');
  await page.click('#budget-title');expect(await page.evaluate(()=>document.activeElement?.matches(':focus-visible'))).toBe(false);
  await page.click('#budget-currency');await page.keyboard.press('Escape');await page.click('#budget-title');
  expect(await page.$eval('#budget-currency',e=>e.matches(':focus-visible'))).toBe(false);
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
  expect(await page.evaluate(()=>matchMedia('(forced-colors: active)').matches)).toBe(true);
  await page.focus('#budget-year');await page.keyboard.press('Tab');
  expect(await page.evaluate(()=>getComputedStyle(document.activeElement!).outlineStyle)).toBe('solid');
  await page.screenshot({path:path.join(evidence,'forced-colors.png')});
  await cdp.send('Emulation.setEmulatedMedia',{features:[]});
  await page.evaluate(()=>document.documentElement.dir='rtl');await page.setViewport({width:640,height:900});
  expect(await page.$eval('#budget-view',e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await page.screenshot({path:path.join(evidence,'rtl.png')});await page.evaluate(()=>document.documentElement.dir='ltr');
  await cdp.detach();
});

it('keeps connector disclosure state accessible when returning from finance',async()=>{
  await click('#sidebar-connect-tools-btn');await page.waitForSelector('.ct-card [data-action="toggle"]');
  const toggle='.ct-card [data-action="toggle"]';
  expect(await page.$eval(toggle,e=>e.getAttribute('aria-expanded'))).toBe('true');
  await page.focus(toggle);await page.keyboard.press('Enter');
  expect(await page.$eval(toggle,e=>e.getAttribute('aria-expanded'))).toBe('false');
  expect(await page.$eval(toggle,e=>e.textContent)).toBe('Edit');
  await page.keyboard.press('Enter');expect(await page.$eval(toggle,e=>e.textContent)).toBe('Hide');
  await page.screenshot({path:path.join(evidence,'connections.png')});
});

it('stops connector polling when another panel replaces it',async()=>{
  await click('#sidebar-budget-btn');
  expect(await page.evaluate('_ctPollTimer')).toBe(null);
  await page.evaluate('_ctStartPolling()');
  expect(await page.evaluate('_ctPollTimer')).toBe(null);
});

it('refuses to feed this real local ledger page into an unattended browser read',async()=>{
  let reads=0;
  await expect(readWebPage(()=>page.url(),()=>{reads++;return page.$eval('#budget-body',e=>e.textContent);})).rejects.toThrow('blocked');
  expect(reads).toBe(0);
});

it('contains approval keyboard focus and returns it after denial',async()=>{
  await page.setViewport({width:1280,height:900});await tab('overview');await page.focus('#budget-backup');
  await requestApproval();
  expect(await page.$eval('#budget-view',e=>e.closest('[inert]')!==null)).toBe(true);
  expect(await page.evaluate(()=>document.activeElement?.id)).toBe('approval-deny-btn');
  await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
  expect(await page.evaluate(()=>document.activeElement?.id)).toBe('approval-details');
  await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
  expect(await page.evaluate(()=>document.activeElement?.closest('.approval-actions')!==null)).toBe(true);
  expect(await page.evaluate(()=>document.activeElement?.id)).not.toBe('approval-deny-btn');
  await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.activeElement?.id)).toBe('approval-details');
  await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.activeElement?.id)).toBe('approval-deny-btn');
  await page.keyboard.press('Escape');
  expect(await page.evaluate('fixtureApprovalDecision')).toBe('deny');
  expect(await page.$eval('#budget-view',e=>e.closest('[inert]')!==null)).toBe(false);
  expect(await page.evaluate(()=>document.activeElement?.id)).toBe('budget-backup');
});

if(native)it('reflows the real Electron window at 200 percent zoom',async()=>{
  await page.setViewport({width:1280,height:900});
  await page.evaluate(()=>(window as unknown as {fixtureWindow:{zoom:(factor:number)=>Promise<void>}}).fixtureWindow.zoom(2));
  expect(await page.evaluate(()=>window.innerWidth)).toBeLessThanOrEqual(640);
  for(const name of ['overview','transactions','import','plan']){
    await tab(name);expect(await page.$eval('#budget-view',e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
    await page.screenshot({path:path.join(evidence,`zoom200-${name}.png`)});
  }
  await page.evaluate(()=>(window as unknown as {fixtureWindow:{zoom:(factor:number)=>Promise<void>}}).fixtureWindow.zoom(1));
});

if(process.env.FINANCE_PERFORMANCE_CHECK==='1')it('bounds renderer retention across repeated panel cycles',async()=>{
  const cdp=await page.createCDPSession();
  const samples:Array<{cycle:number;openMs:number;nodes:number;listeners:number;heapBytes:number;taskSeconds:number}>=[];
  try{
    await page.setViewport({width:1280,height:900});
    await click('#budget-back');
    for(let cycle=0;cycle<40;cycle++){
      const start=performance.now();await click('#sidebar-budget-btn');
      const openMs=Math.round(performance.now()-start);
      for(const view of ['transactions','import','plan','overview'])await tab(view);
      await page.click('#sidebar-connect-tools-btn');
      const card=await page.waitForSelector('#ct-cards .ct-card');
      await card?.dispose();
      await click('#sidebar-budget-btn');await click('#budget-back');
      expect(await page.$eval('#budget-view',e=>getComputedStyle(e).display)).toBe('none');
      expect(await page.evaluate('_ctPollTimer===null')).toBe(true);
      if(cycle%5===0 || cycle===39){
        await cdp.send('HeapProfiler.collectGarbage');
        const {Nodes:nodes,JSEventListeners:listeners,JSHeapUsedSize:heapBytes,TaskDuration:taskSeconds}=await page.metrics();
        if(typeof nodes!=='number'||typeof listeners!=='number'||typeof heapBytes!=='number'||typeof taskSeconds!=='number'||![nodes,listeners,heapBytes,taskSeconds].every(Number.isFinite))throw new Error('Renderer metrics unavailable');
        samples.push({cycle,openMs,nodes,listeners,heapBytes,taskSeconds});
      }
    }
    fs.writeFileSync(path.join(directory,'renderer-performance.json'),JSON.stringify({native,fixtureLaunchMs,cycles:40,forcedRendererGC:true,samples},null,2));
    const first=samples[0],last=samples[samples.length-1];
    expect(last.nodes).toBeLessThanOrEqual(first.nodes);
    expect(last.listeners).toBeLessThanOrEqual(first.listeners);
    // Local regression ceiling above warmed-up heap, not a leak-freedom claim.
    expect(last.heapBytes-first.heapBytes).toBeLessThan(1024*1024);
    expect(errors).toEqual([]);
    console.info('Synthetic renderer lifecycle:',JSON.stringify({native,fixtureLaunchMs,first,last}));
    await click('#sidebar-budget-btn');
  }finally{await cdp.detach();}
});

if(humanReview)it('opens the isolated human review session, without asserting a VoiceOver verdict',async()=>{
  await page.setViewport({width:1280,height:900});await tab('overview');
  await page.evaluate(()=>{document.title='SYNTHETIC ONLY - VoiceOver review';});
  if(process.env.FINANCE_APPROVAL_REVIEW==='1') {
    await page.focus('#budget-body [role="region"]');await requestApproval();
  } else await page.focus('#budget-entity');
  const closed=new Promise<void>(resolve=>page.once('close',()=>resolve()));
  await page.evaluate(()=>(window as unknown as {fixtureWindow:{review:()=>Promise<void>}}).fixtureWindow.review());
  humanReviewOpened=true;
  console.info('VOICEOVER READY: synthetic window open. Close this test window after the listening check. No VoiceOver verdict is inferred.');
  await closed;
},3600000);
