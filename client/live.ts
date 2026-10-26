import {request} from './api.ts';
// One live connection to a scope's stream. The server beats every 5 s; eight
// silent seconds means the connection died without closing, so it reconnects.
// A refused stream (capacity) falls back to polling every second and says so.
export type LiveState='live'|'reconnecting'|'busy'|'revoked';
export function connect(url:()=>string,handlers:{change:(kind:string,data:any)=>void;state:(s:LiveState)=>void;poll:()=>Promise<unknown>}){
  let source:EventSource|null=null,watchdog:ReturnType<typeof setTimeout>,poller:ReturnType<typeof setInterval>|null=null,closed=false,retry:ReturnType<typeof setTimeout>;
  const alive=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>{source?.close();handlers.state('reconnecting');retry=setTimeout(open,1000);},8000);};
  const stopPolling=()=>{if(poller)clearInterval(poller);poller=null;};
  function open(){
    if(closed)return;source?.close();const s=source=new EventSource(url());
    s.addEventListener('open',()=>{alive();stopPolling();handlers.state('live');void handlers.poll().catch(()=>{});});
    s.addEventListener('beat',alive);
    s.addEventListener('change',e=>{alive();let data:any={};try{data=JSON.parse((e as MessageEvent).data);}catch{}handlers.change(data.kind??'change',data);});
    s.addEventListener('reset',()=>{alive();handlers.change('reset',{});});
    s.addEventListener('revoked',()=>{closed=true;s.close();clearTimeout(watchdog);handlers.state('revoked');});
    s.addEventListener('error',()=>{if(closed)return;if(s.readyState===EventSource.CLOSED){clearTimeout(watchdog);handlers.state('busy');if(!poller)poller=setInterval(()=>{if(!document.hidden)void handlers.poll().catch(()=>handlers.state('reconnecting'));},1000);clearTimeout(retry);retry=setTimeout(open,10000);}else handlers.state('reconnecting');});
  }
  open();
  return {close(){closed=true;source?.close();clearTimeout(watchdog);clearTimeout(retry);stopPolling();},reopen(){closed=false;open();}};
}
// Clock calibration against the server: the lowest round trip of five wins.
export async function calibrate(){let best=Infinity,offset=0;for(let i=0;i<5;i++){const a=Date.now(),x=await request('/api/time'),b=Date.now();if(b-a<best){best=b-a;offset=x.serverNowMs-(a+b)/2;}}return offset;}
