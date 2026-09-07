import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function fixture(financeOpen:boolean) {
  const handlers=new Map<string,(event:unknown)=>Promise<void>>();const reads=vi.fn();const added=vi.fn();
  const classes={add:vi.fn(),remove:vi.fn(),contains:(name:string)=>name==='hidden' && financeOpen};
  const context=vm.createContext({
    document:{addEventListener:(name:string,handler:(event:unknown)=>Promise<void>)=>handlers.set(name,handler),getElementById:(name:string)=>{
      if(name==='budget-view')return {classList:{contains:()=>financeOpen}};
      if(name==='chat-view')return {classList:classes};
      if(name==='drag-overlay')return {classList:classes};return null;
    }},
    input:{addEventListener:vi.fn(),focus:vi.fn()},mentionHighlight:{},fileInput:{value:''},
    IMAGE_EXTENSIONS:new Set(['png']),BINARY_EXTENSIONS:new Set(),EXTRACTABLE_EXTENSIONS:new Set(),ALLOWED_EXTENSIONS:new Set(['png','csv']),MAX_FILE_SIZE:10000,
    getPendingAttachments:()=>[],setPendingAttachments:added,addMessage:vi.fn(),
    File:class {name:string;type:string;size=1;constructor(_parts:unknown[],name:string,options:{type:string}){this.name=name;this.type=options.type;}},
    FileReader:class {onload!: (event:unknown)=>void;readAsDataURL(){reads();this.onload({target:{result:'data:image/png;base64,AA=='}});}readAsText(){reads();this.onload({target:{result:'Synthetic CSV'}});}},
  });
  vm.runInContext(fs.readFileSync(new URL('../../ui/chat/attachments.js',import.meta.url),'utf8'),context);
  return {handlers,reads,added,openFinance:()=>{financeOpen=true;}};
}
const event=()=>({preventDefault:vi.fn(),stopPropagation:vi.fn(),clipboardData:{items:[{type:'image/png',getAsFile:()=>({type:'image/png'})}]},dataTransfer:{files:[{name:'synthetic.csv',type:'text/csv',size:20}]}});
describe('finance data does not become a chat attachment implicitly',()=>{
  it('does not copy pasted receipt images from the finance workspace',async()=>{
    const test=fixture(true);await test.handlers.get('paste')!(event());expect(test.reads).not.toHaveBeenCalled();expect(test.added).not.toHaveBeenCalled();
  });
  it('does not copy dropped CSVs from the finance workspace',async()=>{
    const test=fixture(true);await test.handlers.get('drop')!(event());expect(test.reads).not.toHaveBeenCalled();expect(test.added).not.toHaveBeenCalled();
  });
  it('drops an in-flight attachment when finance replaces chat',async()=>{
    const test=fixture(false);const pending=test.handlers.get('paste')!(event());test.openFinance();await pending;
    expect(test.reads).toHaveBeenCalledOnce();expect(test.added).not.toHaveBeenCalled();
  });
  it('retains deliberate image paste in visible chat',async()=>{
    const test=fixture(false);await test.handlers.get('paste')!(event());expect(test.reads).toHaveBeenCalledOnce();expect(test.added).toHaveBeenCalledOnce();
  });
});
