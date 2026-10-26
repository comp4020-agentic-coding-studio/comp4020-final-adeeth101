// Small DOM helpers shared by every view.
export const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]!));
export const $=<T extends Element=HTMLElement>(s:string,r:ParentNode=document)=>r.querySelector<T>(s);
export const $$=<T extends Element=HTMLElement>(s:string,r:ParentNode=document)=>[...r.querySelectorAll<T>(s)];
let toastTimer:ReturnType<typeof setTimeout>;
export function toast(s:string){const t=$('#toast');if(!t)return;t.textContent=s;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),5000);}
export const fail=(e:unknown)=>toast(e instanceof Error?e.message:'Please try again.');
export const errorText=(e:unknown)=>e instanceof Error?e.message:'Please try again.';
// One delegated listener per root: re-rendering never loses handlers.
export function on(root:HTMLElement,event:string,selector:string,fn:(el:HTMLElement,e:Event)=>unknown){
  root.addEventListener(event,e=>{const el=(e.target as HTMLElement)?.closest?.(selector) as HTMLElement|null;if(!el||!root.contains(el))return;Promise.resolve().then(()=>fn(el,e)).catch(fail);});
}
export function ago(ms:number){const s=Math.max(0,Math.round((Date.now()-ms)/1000));return s<60?'just now':s<3600?`${Math.floor(s/60)} min ago`:s<86400?`${Math.floor(s/3600)} h ago`:`${Math.floor(s/86400)} d ago`;}
// Dialogs and sheets: Escape closes, focus returns to the control that opened them.
const stack:{el:HTMLElement;trigger:HTMLElement|null;close:()=>void}[]=[];
export function openLayer(el:HTMLElement,close:()=>void){
  const trigger=document.activeElement as HTMLElement|null;stack.push({el,trigger,close});
  queueMicrotask(()=>{const first=el.querySelector<HTMLElement>('[autofocus],button,input,textarea,select,a[href]');(first??el).focus({preventScroll:true});});
}
export function closeLayer(el:HTMLElement){const i=stack.findIndex(x=>x.el===el);if(i<0)return;const [layer]=stack.splice(i,1);layer.trigger?.isConnected&&layer.trigger.focus({preventScroll:true});}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&stack.length){const top=stack.at(-1)!;e.preventDefault();top.close();}});
export const visibilityLabel:Record<string,string>={private:'Private',unlisted:'Unlisted',public:'Public'};
export const visibilityHelp:Record<string,string>={private:'Only members can open it.',unlisted:'Anyone with the view link can listen to the saved mix.',public:'Anyone can find it and listen to the saved mix.'};
