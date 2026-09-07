import { describe, expect, it, vi } from 'vitest';
import { runFinanceAi, type FinanceAiJob } from '../../src/finance/ai-worker.js';

const job:FinanceAiJob={kind:'finance-ai',provider:'anthropic',model:'synthetic-model',apiKey:'synthetic-not-a-credential',origin:'https://api.anthropic.com',summary:'Anonymous aggregate: USD income 100.00. Coverage unverified.'};
function answer(stopReason='end_turn',text='Synthetic aggregate interpretation.') {
  const events=[
    {type:'message_start',message:{id:'synthetic',type:'message',role:'assistant',model:'synthetic-model',content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}},
    {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
    {type:'content_block_delta',index:0,delta:{type:'text_delta',text}},
    {type:'content_block_stop',index:0},
    {type:'message_delta',delta:{stop_reason:stopReason,stop_sequence:null},usage:{output_tokens:1}},
    {type:'message_stop'},
  ];
  return new Response(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
}

describe('finance AI real provider adapter with an inert transport',()=>{
  it('sends only the approved aggregate without tools, browsing, history or redirects',async()=>{
    const transport=vi.fn<typeof fetch>(async(input,init)=>{
      const request=new Request(input,init);const body=await request.json();
      expect(request.method).toBe('POST');expect(new URL(request.url).origin).toBe(job.origin);
      expect(request.redirect).toBe('error');expect(body.messages).toHaveLength(1);
      expect(JSON.stringify(body.messages)).toContain(job.summary);
      expect(body).not.toHaveProperty('tools');expect(body).not.toHaveProperty('context_management');
      return answer();
    });
    const before=globalThis.fetch;
    expect(await runFinanceAi(job,transport)).toEqual({text:'Synthetic aggregate interpretation.',complete:true});
    expect(transport).toHaveBeenCalledOnce();expect(globalThis.fetch).toBe(before);
  });
  it.each([
    ['completed', 'response.completed', 'completed', true],
    ['done', 'response.done', 'completed', true],
    ['connection closed', null, null, false],
    ['token limit', 'response.incomplete', 'incomplete', false],
    ['incomplete done', 'response.done', 'incomplete', false],
    ['missing status', 'response.completed', null, false],
    ['sentinel whitespace', 'response.completed', 'completed', true],
  ] as const)('requires an explicit successful subscription terminal event: %s',async(_label,type,status,complete)=>{
    const subscription:FinanceAiJob={...job,provider:'openai',model:'gpt-5.6-sol',accountId:'synthetic-account',baseUrl:'https://chatgpt.com/backend-api',origin:'https://chatgpt.com'};
    const transport=vi.fn<typeof fetch>(async(input,init)=>{
      const request=new Request(input,init),body=await request.json();
      expect(request.url).toBe('https://chatgpt.com/backend-api/codex/responses');
      expect(request.redirect).toBe('error');expect(body.model).toBe(subscription.model);
      expect(body.input).toHaveLength(1);expect(JSON.stringify(body.input)).toContain(subscription.summary);
      expect(body).not.toHaveProperty('tools');expect(body.store).toBe(false);
      const events=[{type:'response.output_text.delta',delta:'Synthetic € aggregate interpretation.'},...(type ? [{type,response:{status}}] : [])];
      const sentinel=_label==='sentinel whitespace'?'data: [DONE] \r\n\r\n':'';
      const bytes=new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\r\n\r\n`).join('')+sentinel);
      return new Response(new ReadableStream({start(controller){for(let offset=0;offset<bytes.length;offset+=7)controller.enqueue(bytes.slice(offset,offset+7));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
    });
    const before=globalThis.fetch;
    expect(await runFinanceAi(subscription,transport)).toEqual({text:'Synthetic € aggregate interpretation.',complete});
    expect(transport).toHaveBeenCalledOnce();expect(globalThis.fetch).toBe(before);
  });
  it('labels token-truncated output incomplete',async()=>{
    expect(await runFinanceAi(job,async()=>answer('max_tokens'))).toMatchObject({complete:false});
  });
  it('blocks another destination before any transport call',async()=>{
    const transport=vi.fn<typeof fetch>();
    await expect(runFinanceAi({...job,baseUrl:'https://other.invalid'},transport)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects oversized approved summaries and excessive generated text',async()=>{
    const transport=vi.fn<typeof fetch>();
    await expect(runFinanceAi({...job,summary:'x'.repeat(32769)},transport)).rejects.toThrow('Invalid approved AI job');
    expect(transport).not.toHaveBeenCalled();
    await expect(runFinanceAi(job,async()=>answer('end_turn','x'.repeat(131073)))).rejects.toThrow('AI text limit');
  });
});
