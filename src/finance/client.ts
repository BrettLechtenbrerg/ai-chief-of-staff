import { Worker } from 'node:worker_threads';
import type { FinanceCommand } from './worker.js';

/** One lazy worker for the app lifetime; closing panels only releases their previews. */
export class FinanceClient {
  private worker:Worker|null=null;
  private pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private sequence=0;
  private closing:Promise<void>|null=null;
  private stopped=false;
  constructor(private readonly userDataDirectory:string) {}
  private start():Worker {
    if (this.stopped) throw new Error('Finance is closing.');
    if (this.worker) return this.worker;
    const worker=new Worker(new URL('./worker.js',import.meta.url),{workerData:{kind:'finance',userDataDirectory:this.userDataDirectory},resourceLimits:{maxOldGenerationSizeMb:256}});
    this.worker=worker;
    const fail=()=>{
      if (this.worker!==worker) return;
      this.worker=null;
      for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(new Error('Finance worker stopped. Reopen and inspect the ledger before retrying; exact requests are idempotent.'));}
      this.pending.clear();
    };
    worker.on('error',fail);worker.on('exit',fail);
    worker.on('message',(message:{id:number;result?:unknown;error?:string})=>{
      if (this.worker!==worker) return;
      const request=this.pending.get(message.id);if (!request) return;
      this.pending.delete(message.id);clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result);
    });
    return worker;
  }
  request<T=unknown>(command:FinanceCommand):Promise<T> {
    if (this.closing || this.stopped) return Promise.reject(new Error('Finance is closing.'));
    return this.send<T>(command);
  }
  private send<T>(command:FinanceCommand):Promise<T> {
    if (this.pending.size>=8) return Promise.reject(new Error('Finance is busy. Wait for the current operation.'));
    const worker=this.start();const id=++this.sequence;
    return new Promise<T>((resolve,reject)=>{
      const timer=setTimeout(()=>{
        // Never report a timed-out write as definitely rolled back. Killing the owned
        // worker releases SQLite; the next open/retry verifies durable/idempotent state.
        void worker.terminate();
      },120000);
      this.pending.set(id,{resolve:value=>resolve(value as T),reject,timer});
      try {worker.postMessage({id,command});} catch {clearTimeout(timer);this.pending.delete(id);reject(new Error('Finance request could not be delivered.'));}
    });
  }
  close():Promise<void> {
    if (this.closing) return this.closing;
    if (!this.worker) {this.stopped=true;return Promise.resolve();}
    const worker=this.worker;
    this.closing=(async()=>{
      try {await this.send({action:'close'});} finally {this.stopped=true;await worker.terminate();}
    })();
    return this.closing;
  }
}
