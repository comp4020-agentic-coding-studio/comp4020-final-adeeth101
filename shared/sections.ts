// A plain build-up from the characters already on stage. This is arithmetic on
// their roles, not a model: the same band always gets the same suggestion, it
// only ever uses material that is already in the mix, and it changes nothing
// until a person has read it and pressed Use this.
import type {Slot} from './performance.ts';
import type {Arrangement} from './studio.ts';

export type Suggestion={assignments:Record<Slot,Record<string,'A'|null>>;arrangement:Arrangement;who:Record<Slot,string[]>};
type Member={id:string;name:string;role:string};
// Texture and melody open; bass arrives; the beat lands; then it thins out again.
const PLAN:Record<Slot,string[]>={A:['texture','melody'],B:['texture','melody','bass'],C:['texture','melody','bass','beats','custom'],D:['texture','beats']};
export function suggestSections(parts:Member[]):Suggestion{
  const assignments={A:{},B:{},C:{},D:{}} as Suggestion['assignments'],who={A:[],B:[],C:[],D:[]} as Suggestion['who'];
  for(const scene of Object.keys(PLAN) as Slot[]){
    // A band with nobody in those roles still gets a section with people in it.
    const chosen=parts.filter(p=>PLAN[scene].includes(p.role)),playing=new Set((chosen.length?chosen:parts).map(p=>p.id));
    for(const p of parts){assignments[scene][p.id]=playing.has(p.id)?'A':null;if(playing.has(p.id))who[scene].push(p.name);}
  }
  return {assignments,who,arrangement:{entries:[{scene:'A',bars:4},{scene:'B',bars:8},{scene:'C',bars:8},{scene:'B',bars:4},{scene:'C',bars:8},{scene:'D',bars:4}],loop:false}};
}
