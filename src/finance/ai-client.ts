import { Worker } from 'node:worker_threads';
import type { FinanceAiJob, FinanceAiResult } from './ai-worker.js';

export function runApprovedFinanceAi(job:FinanceAiJob, signal:AbortSignal):Promise<FinanceAiResult> {
  if(signal.aborted) return Promise.reject(new Error('AI analysis canceled.'));
  const worker=new Worker(new URL('./ai-worker.js',import.meta.url),{
    workerData:job,resourceLimits:{maxOldGenerationSizeMb:128},
    env:{PATH:process.env.PATH ?? '',HOME:process.env.HOME ?? '',TMPDIR:process.env.TMPDIR ?? ''},
  });
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error:Error|null,result?:FinanceAiResult)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
      void worker.terminate().then(()=>{if(error)reject(error);else resolve(result!);},()=>reject(new Error('AI worker shutdown failed.')));
    };
    const abort=()=>finish(new Error('AI analysis canceled; provider usage may already have been charged.'));
    const timer=setTimeout(()=>finish(new Error('AI analysis timed out; local records are unchanged.')),95000);
    signal.addEventListener('abort',abort,{once:true});
    worker.once('error',()=>finish(new Error('AI worker failed; local reports remain available.')));
    worker.once('exit',()=>{if(!settled)finish(new Error('AI worker stopped before returning an analysis.'));});
    worker.once('message',(message:{result?:FinanceAiResult;error?:string})=>{
      if(message.result && typeof message.result.text==='string' && Buffer.byteLength(message.result.text)<=131072 && typeof message.result.complete==='boolean') finish(null,message.result);
      else finish(new Error(message.error || 'Invalid AI analysis response.'));
    });
    if(signal.aborted)abort();
  });
}
