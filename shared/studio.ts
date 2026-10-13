import type {ClipDocument} from './music.ts';
import type {Plan,Slot} from './performance.ts';
export type Clip = {id:string;revision:number;document:ClipDocument;source:string|null;history:{revision:number;createdAt:number}[];provenance:Record<string,unknown>};
export type Track = {id:string;ownerId:string;handle:string;name:string;revision:number;archivedAt:number|null;clips:Partial<Record<Slot,Clip>>};
export type Arrangement = {entries:{scene:Slot;bars:number}[];loop:boolean};
export type Snapshot = {
  id:string;title:string;revision:number;eventId:number;serverNowMs:number;
  you:{id:string;handle:string};tracks:Track[];
  settings:{bpm:number;sceneNames:Record<Slot,string>;arrangement:Arrangement;revision:number};
  transport:{generation:number;status:'stopped'|'playing';epochMs:number|null;conductorId:string|null;leaseUntil:number;revision:number};
  plans:Plan[];presence:{id:string;handle:string;route:string}[];
};
