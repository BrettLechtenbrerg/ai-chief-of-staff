import { parentPort, workerData } from 'node:worker_threads';
import { stream, type Provider, type ThinkingLevel } from '@kenkaiiii/gg-ai';

export interface FinanceAiJob {
  kind:'finance-ai'; provider:Provider; model:string; apiKey:string; baseUrl?:string; accountId?:string;
  origin:string; summary:string; thinking?:ThinkingLevel;
}
export interface FinanceAiResult { text:string; complete:boolean; }
const SYSTEM='Interpret only the supplied redacted accounting-preparation aggregates. All totals are already computed; do not invent or recompute missing values. Give at most five prioritized, evidence-linked review suggestions. Category labels are anonymous. Never claim complete books, audited statements, verified bank balances, tax treatment, investments or predictions. No tools, browsing, external actions or requests for raw statements. State uncertainty and recommend accountant review for formal requirements.';

/** Dedicated worker only: the global guard also covers gg-ai Codex's global fetch path. */
export async function runFinanceAi(job:FinanceAiJob, transport:typeof fetch=globalThis.fetch):Promise<FinanceAiResult> {
  if (job.kind!=='finance-ai' || typeof job.summary!=='string' || Buffer.byteLength(job.summary)>32768 ||
      typeof job.model!=='string' || job.model.length>160 || typeof job.apiKey!=='string' || !job.apiKey) throw new Error('Invalid approved AI job.');
  const origin=new URL(job.origin);
  if (origin.protocol!=='https:' || origin.origin!==job.origin || origin.username || origin.password) throw new Error('Invalid approved provider destination.');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),90000);
  const previousFetch=globalThis.fetch;let attempts=0,received=0,codexBytes=0;
  // gg-ai's Codex adapter reports end_turn even when SSE ends without completion.
  // simplification: retain at most 2 MiB for terminal-event validation; use incremental parsing if that cap grows.
  const codexBody=job.provider==='openai' && job.accountId ? Buffer.alloc(2*1024*1024) : null;
  const guarded:typeof fetch=async(input,init)=>{
    const url=new URL(typeof input==='string' || input instanceof URL ? String(input) : input.url);
    const method=init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (controller.signal.aborted || ++attempts>3 || url.origin!==job.origin || url.username || url.password || method.toUpperCase()!=='POST') throw new Error('Unapproved AI destination or request limit.');
    const response=await transport(input,{...init,redirect:'error',signal:controller.signal});
    if (response.status>=300 && response.status<400) throw new Error('Provider redirects are not approved.');
    if (!response.body) return response;
    codexBytes=0;let previousCR=false;
    const body=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,sink){
      received+=chunk.byteLength;if(received>2*1024*1024){controller.abort();throw new Error('AI response limit.');}
      if(codexBody){
        // Codex's adapter only recognizes LF frames; normalize SSE line endings across chunks.
        const normalized=new Uint8Array(chunk.byteLength);let size=0;
        for(const byte of chunk){
          const skip=byte===10 && previousCR;previousCR=byte===13;
          if(!skip) normalized[size++]=previousCR ? 10 : byte;
        }
        chunk=normalized.subarray(0,size);codexBody.set(chunk,codexBytes);codexBytes+=chunk.byteLength;
      }
      sink.enqueue(chunk);
    }}));
    return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  };
  globalThis.fetch=guarded;
  try {
    const events=stream({provider:job.provider,model:job.model,apiKey:job.apiKey,baseUrl:job.baseUrl,accountId:job.accountId,
      messages:[{role:'system',content:SYSTEM},{role:'user',content:job.summary}],maxTokens:16384,thinking:job.thinking,
      tools:[],serverTools:[],toolChoice:'none',webSearch:false,compaction:false,clearToolUses:false,cacheRetention:'none',fetch:guarded,signal:controller.signal});
    // gg-ai exposes both an iterator and a rejecting completion promise; observe both.
    void events.response.catch(()=>undefined);
    let text='',bytes=0,eventCount=0;
    for await(const event of events){
      if (++eventCount>20000) throw new Error('AI event limit.');
      if (event.type==='text_delta' || event.type==='thinking_delta') {
        bytes+=Buffer.byteLength(event.text);if(bytes>131072) throw new Error('AI text limit.');
        if(event.type==='text_delta') text+=event.text;
      } else if(event.type!=='done' && event.type!=='keepalive') throw new Error('Unexpected AI output.');
    }
    const response=await events.response;
    if (!text.trim()) throw new Error('AI returned no analysis.');
    let terminalComplete=!codexBody;
    if(codexBody){
      // Only terminated SSE frames count; a connection closing is not completion.
      for(const frame of codexBody.toString('utf8',0,codexBytes).split(/\r?\n\r?\n/).slice(0,-1)){
        const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');
        if(!data || data==='[DONE]') continue;
        const event=JSON.parse(data);
        if(event.type==='response.completed' || event.type==='response.done') terminalComplete=event.response?.status==='completed';
        else if(event.type==='response.incomplete' || event.type==='response.failed' || event.type==='error') terminalComplete=false;
      }
    }
    return {text,complete:terminalComplete && (response.stopReason==='end_turn' || response.stopReason==='stop_sequence')};
  } finally {controller.abort();clearTimeout(timer);globalThis.fetch=previousFetch;}
}

if(parentPort && workerData?.kind==='finance-ai'){
  const port=parentPort;
  void runFinanceAi(workerData).then(result=>port.postMessage({result})).catch(()=>{
    port.postMessage({error:'AI analysis did not finish. Local records are unchanged; provider usage may already have been charged.'});
  }).finally(()=>port.close());
}
