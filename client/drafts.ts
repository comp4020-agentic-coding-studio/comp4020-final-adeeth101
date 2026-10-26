// Local, recoverable drafts in IndexedDB. Stream's tree drafts stay in their
// original store (stream-drafts) untouched. Ensemble's code drafts use a
// second store keyed by visitor, project, part and slot, so a different
// profile on the same browser never sees another's draft.
import type {ClipDocument} from '../shared/music.ts';
export type Draft={document:ClipDocument;source:string;invalid:string|null;baseRevision:number;workspace?:object;provenance?:Record<string,unknown>;undo?:Draft[]};
export type CodeDraft={source:string;baseRevision:number;baseSource:string;savedAt:number};
function open(name:string,store:string):Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const req=indexedDB.open(name,1);req.onupgradeneeded=()=>req.result.createObjectStore(store);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function get<T>(name:string,store:string,key:string):Promise<T|undefined>{const db=await open(name,store);try{return await new Promise((resolve,reject)=>{const req=db.transaction(store).objectStore(store).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{db.close();}}
async function put(name:string,store:string,key:string,value:unknown){const db=await open(name,store);try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
async function del(name:string,store:string,key:string){const db=await open(name,store);try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
export const readDraft=(key:string)=>get<Draft>('stream-drafts','drafts',key);
export const writeDraft=(key:string,value:Draft)=>put('stream-drafts','drafts',key,value);
export const deleteDraft=(key:string)=>del('stream-drafts','drafts',key);
export const codeKey=(visitor:string,project:string,part:string,slot:string)=>`v2:${visitor}:${project}:${part}:${slot}`;
export const readCode=(key:string)=>get<CodeDraft>('ensemble-drafts','code',key);
export const writeCode=(key:string,value:CodeDraft)=>put('ensemble-drafts','code',key,value);
export const deleteCode=(key:string)=>del('ensemble-drafts','code',key);
