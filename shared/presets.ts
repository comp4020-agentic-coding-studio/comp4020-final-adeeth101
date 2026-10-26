// The factory sound catalogue. Every preset is an exact Strudel expression in
// the version 2 grammar (shared/expr.ts) with a stable id and version. A part
// copies the source when it is added, so a later catalogue version never
// changes a saved mix; editing a part's code makes a variation, not a new
// factory preset.
//
// Status: candidate patterns. They compile and play through the bounded audio
// output; whether they sound good together is decided by listening, which is
// recorded separately in docs/verification.md, not asserted here.
//
// Pan: the candidate catalogue wrote pan on a -1..1 scale. Strudel 1.2.6 takes
// pan from 0 (left) to 1 (right), so those values are mapped (x + 1) / 2 below:
// -0.25 -> 0.375, 0.2 -> 0.6, 0.3 -> 0.65.
export const ROLES = ['beats','bass','melody','texture'] as const;
export type Role = typeof ROLES[number];
export type Macro = 'gain'|'lpf'|'room'|'pan'|'release';
export type Preset = {
  id:string; version:number; name:string; role:Role; source:string;
  macros:Macro[]; bpm:number; key:string; pack:string;
  attribution:string; preview:{bars:number};
};
export type Pack = {id:string;name:string;suggestedBpm:number;mood:string;presets:Preset[]};

export const CATALOG_VERSION = 1;
export const ATTRIBUTION = 'Original Ensemble pattern, prepared 26 October 2026. No Incredibox audio or artwork.';
export const KEY = 'A minor';

type Row = [id:string,name:string,role:Role,source:string,macros:Macro[],previewBars?:number];
function pack(id:string,name:string,suggestedBpm:number,mood:string,rows:Row[]):Pack{
  return {id,name,suggestedBpm,mood,presets:rows.map(([pid,pname,role,source,macros,bars])=>({id:pid,version:1,name:pname,role,source,macros,bpm:suggestedBpm,key:KEY,pack:id,attribution:ATTRIBUTION,preview:{bars:bars??(source.includes('slow(2)')||source.includes('<')?2:1)}}))};
}

export const PACKS: Pack[] = [
  pack('warm-circuit','Warm Circuit',100,'Relaxed electronic groove',[
    ['warm-pocket','Pocket','beats','stack(s("bd ~ bd ~"), s("~ sd ~ sd").gain(0.45), s("hh*8").gain(0.16))',['gain','lpf']],
    ['warm-shuffle','Side Step','beats','stack(s("bd ~ [~ bd] ~"), s("~ cp ~ cp").gain(0.35), s("hh ~ hh hh").gain(0.18))',['gain','lpf']],
    ['warm-anchor','Anchor','bass','note("33 ~ 33 40").s("triangle").lpf(850).gain(0.48)',['gain','lpf','release']],
    ['warm-walk','Soft Walk','bass','note("33 36 ~ 40 43 ~ 40 36").s("sine").gain(0.5)',['gain','release']],
    ['warm-sunbeam','Sunbeam','melody','note("69 ~ 72 76 ~ 72 71 ~").s("triangle").room(0.2).gain(0.3)',['gain','lpf','room']],
    ['warm-question','Little Question','melody','note("[69 72] ~ 76 ~ <74 71> ~ 72 ~").s("sine").room(0.15).gain(0.3)',['gain','room']],
    ['warm-glow','Glow','texture','note("[57,60,64] ~").s("triangle").slow(2).release(1.2).lpf(1300).room(0.3).gain(0.13)',['gain','lpf','room']],
    ['warm-spark','Dust','texture','note("81 ~ ~ 88 ~ ~ 84 ~").s("sine").slow(2).pan(0.375).room(0.35).gain(0.15)',['gain','pan','room']],
  ]),
  pack('pocket-arcade','Pocket Arcade',120,'Bright, short, rhythmic parts',[
    ['arcade-four','Quarter Drop','beats','stack(s("bd*4").gain(0.7), s("~ cp ~ cp").gain(0.35), s("[~ hh]*4").gain(0.16))',['gain','lpf']],
    ['arcade-skip','Skip','beats','stack(s("bd ~ ~ bd ~ sd bd sd").gain(0.55), s("hh*8").gain(0.12))',['gain','lpf']],
    ['arcade-bounce','Bounce','bass','note("33 45 33 ~ 40 52 40 ~").s("square").lpf(950).release(0.08).gain(0.2)',['gain','lpf','release']],
    ['arcade-engine','Engine','bass','note("33*4 40*4").s("sawtooth").lpf(700).gain(0.2)',['gain','lpf']],
    ['arcade-pixel','Pixel Hop','melody','note("69 72 76 81 76 72 71 67").s("square").lpf(2600).release(0.06).gain(0.12)',['gain','lpf','release']],
    ['arcade-comet','Comet','melody','note("[81 79 76] ~ [72 71 69] ~").s("triangle").room(0.12).gain(0.25)',['gain','room']],
    ['arcade-orbit','Orbit','texture','note("<81 84 88 86>").s("sine").release(0.3).pan(0.65).room(0.25).gain(0.18)',['gain','pan','room'],4],
    ['arcade-chime','Level Light','texture','note("[72,76] ~ ~ [76,81]").s("triangle").slow(2).room(0.3).gain(0.12)',['gain','lpf','room']],
  ]),
  pack('after-hours','After Hours',80,'Spacious and slower patterns',[
    ['night-heart','Heartbeat','beats','stack(s("bd ~ ~ ~ bd ~ bd ~").gain(0.55), s("~ ~ sd ~").gain(0.25))',['gain','lpf']],
    ['night-ticks','Rain Ticks','beats','stack(s("hh ~ hh [hh hh]").gain(0.12), s("~ cp ~ ~").gain(0.2)).room(0.15)',['gain','lpf','room']],
    ['night-floor','Deep Floor','bass','note("33 ~ 40 ~").s("sine").slow(2).release(0.8).gain(0.5)',['gain','release']],
    ['night-drift','Drift','bass','note("<33 36 38 40> ~").s("triangle").lpf(600).release(0.5).gain(0.35)',['gain','lpf','release'],4],
    ['night-lantern','Lantern','melody','note("69 ~ ~ 76 ~ 74 ~ ~").s("sine").slow(2).room(0.35).gain(0.28)',['gain','room']],
    ['night-window','Window','melody','note("72 ~ 71 ~ 69 ~ 64 ~").s("triangle").slow(2).lpf(1800).room(0.3).gain(0.22)',['gain','lpf','room']],
    ['night-velvet','Velvet','texture','note("<[57,60,64] [55,59,62]>").s("sine").slow(2).release(1.8).room(0.4).gain(0.12)',['gain','release','room'],4],
    ['night-stars','Far Stars','texture','note("88 ~ ~ ~ 84 ~ ~ ~").s("sine").slow(2).pan(0.6).room(0.4).gain(0.14)',['gain','pan','room']],
  ]),
];
export const PRESETS: Preset[] = PACKS.flatMap(p=>p.presets);
export const presetById = (id:string, version?:number) => PRESETS.find(p=>p.id===id&&(version===undefined||p.version===version));
export const ROLE_LABEL: Record<Role,string> = {beats:'Beats',bass:'Bass',melody:'Melody',texture:'Texture'};
// A part with no factory role (old tracks, saved sounds) reads as Custom.
export const roleOf = (r:unknown):Role|'custom' => (ROLES as readonly unknown[]).includes(r) ? r as Role : 'custom';
