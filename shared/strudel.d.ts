declare module '@strudel/core' {
  export type Hap = {value:Record<string,any>;whole:{begin:{valueOf():number}};duration:number;hasOnset():boolean};
  export interface Pattern {queryArc(begin:number,end:number,controls?:Record<string,unknown>):Hap[];s(value:unknown):Pattern;note(value:unknown):Pattern;gain(value:number):Pattern;fast(value:number):Pattern;slow(value:number):Pattern;rev():Pattern;lpf(value:number):Pattern;room(value:number):Pattern;}
  export function s(value:unknown):Pattern;
  export function note(value:unknown):Pattern;
  export function stack(...values:Pattern[]):Pattern;
}
declare module '@strudel/mini' { import type { Pattern } from '@strudel/core'; export function mini(value:string):Pattern; }
