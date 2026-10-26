import type {AnyDocument} from './clip.ts';
import type {Plan,Slot} from './performance.ts';
import type {Role} from './presets.ts';

export type Clip = {id:string;slot:Slot;revision:number;schemaVersion:1|2;document:AnyDocument;source:string;provenance:Record<string,unknown>;editedBy:{id:string;handle:string};editedAt:number;history?:{revision:number;createdAt:number;by:string}[]};
export type Lease = {visitorId:string;handle:string;until:number};
export type Part = {id:string;name:string;role:Role|'custom';presetId:string|null;presetVersion:number|null;addedBy:{id:string;handle:string};revision:number;archivedAt:number|null;guest:boolean;clips:Partial<Record<Slot,Clip>>;lease:Lease|null};
export type Member = {id:string;handle:string;code:string;role:'owner'|'member';online:boolean;here:boolean};
export type Arrangement = {entries:{scene:Slot;bars:number}[];loop:boolean};
export type Visibility = 'private'|'unlisted'|'public';
export type Transport = {generation:number;status:'stopped'|'playing';epochMs:number|null;hostId:string|null;hostHandle:string|null;leaseUntil:number;revision:number};
export type RoomSnapshot = {
  access:'member';id:string;title:string;visibility:Visibility;migratedPublic:boolean;revision:number;eventId:number;serverNowMs:number;
  you:{id:string;handle:string;code:string;role:'owner'|'member'};members:Member[];parts:Part[];
  settings:{bpm:number;sceneNames:Record<Slot,string>;arrangement:Arrangement;revision:number};
  transport:Transport;plans:Plan[];presence:{id:string;handle:string}[];
  performance:null|{id:string;title:string;visibility:'public'|'unlisted';hostId:string;startedAt:number;listenToken?:string};
  editors:{count:number;limit:number;youCanEdit:boolean;reason?:string};
  viewToken:string|null;
};
export type ViewPart = {id:string;name:string;role:Role|'custom';addedBy:string;document:AnyDocument;source:string;gain:number;mute:boolean};
export type ViewSnapshot = {access:'view';id:string;title:string;visibility:Visibility;bpm:number;parts:ViewPart[];performance:null|{id:string;title:string}};
// What an audience sees: the performance's active plan, credits and audience
// presence. Never the project snapshot.
export type AudienceSnapshot = {
  id:string;projectId:string|null;title:string;projectTitle:string;visibility:'public'|'unlisted';status:'live'|'ended';endReason:string|null;
  serverNowMs:number;eventId:number;bpm:number;transport:{status:'stopped'|'playing';epochMs:number|null;generation:number};
  plans:Plan[];performers:{id:string;handle:string;role:string}[];
  parts:{id:string;name:string;role:Role|'custom';addedBy:string;guest:boolean}[];
  audience:number;capacity:number;full:boolean;
  you:{id:string;handle:string;code:string;role:'host'|'member'|'performer'|'listener';muted:boolean;request:string|null};
  requests?:{visitorId:string;handle:string}[];
  hostHandle:string;
};
export type Snapshot = RoomSnapshot;
