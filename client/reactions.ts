// Audience reactions on the stage. They arrive as small totals. A few float up,
// never more than a fixed number at once; a running tally always shows the same
// thing without motion, and it is what reduced motion gets. Nothing here takes
// focus, and a screen reader hears a summary at most every thirty seconds.
export const REACTION_FACE:Record<string,string>={clap:'👏',heart:'❤️',fire:'🔥',wave:'👋'};
const MOST_AT_ONCE=10,SPOKEN_EVERY=30000;
const WORD:Record<string,string>={clap:'claps',heart:'hearts',fire:'flames',wave:'waves'};
export class ReactionStage{
  private totals:Record<string,number>={};
  private spoken=0;
  constructor(private layer:HTMLElement,private tally:HTMLElement,private voice:HTMLElement){}
  add(counts:Record<string,number>){
    const still=matchMedia('(prefers-reduced-motion: reduce)').matches;
    for(const [kind,n] of Object.entries(counts)){
      if(!REACTION_FACE[kind]||!Number.isFinite(n)||n<=0)continue;
      this.totals[kind]=(this.totals[kind]??0)+n;
      if(!still&&!document.hidden&&this.layer.childElementCount<MOST_AT_ONCE)this.float(kind,n);
    }
    this.drawTally();
    const now=Date.now();
    if(now-this.spoken>SPOKEN_EVERY){this.spoken=now;this.voice.textContent=`Audience so far: ${Object.entries(this.totals).map(([k,n])=>`${n} ${WORD[k]}`).join(', ')}.`;}
  }
  private float(kind:string,n:number){
    const span=document.createElement('span');span.textContent=n>1?`${REACTION_FACE[kind]} ×${n}`:REACTION_FACE[kind];
    span.style.left=`${6+Math.random()*80}%`;this.layer.append(span);
    const flight=span.animate([{transform:'translateY(0) scale(.8)',opacity:0},{transform:'translateY(-12vh) scale(1.1)',opacity:1,offset:.18},{transform:'translateY(-46vh) scale(1)',opacity:0}],{duration:1700,easing:'ease-out'});
    flight.onfinish=()=>span.remove();flight.oncancel=()=>span.remove();
  }
  private drawTally(){
    const entries=Object.entries(this.totals);this.tally.hidden=!entries.length;
    this.tally.innerHTML=entries.map(([k,n])=>`<span>${REACTION_FACE[k]} ${n}</span>`).join('');
  }
  // A performance that has ended, or that this person can no longer see.
  clear(){this.totals={};this.layer.replaceChildren();this.tally.replaceChildren();this.tally.hidden=true;this.voice.textContent='';}
}
