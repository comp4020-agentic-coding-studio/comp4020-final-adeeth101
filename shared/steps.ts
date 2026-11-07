// The step editor's view of a part. There is no second pattern here: this file
// reads the Strudel source into a grid, and a change to the grid is written back
// as a change to the source's own text. Only the tokens a person actually
// touched are replaced; everything else, including comments, spacing, effects
// and any token the grid cannot represent, stays byte for byte.
//
// What the grid holds exactly: steps, rests, subdivisions, chords, repeats and
// weights. What it cannot hold, it locks: a step that changes each bar, one that
// spans several bars, or layers inside a step. A locked step keeps its text and
// its time, says why, and stays editable in Code. Nothing is ever approximated.
import {parse} from 'acorn';
import {parseMini,parseSource,TIME_FACTORS,DRUMS,VOICES,LIMITS,ExprError,type Mini,type Voice} from './expr.ts';

export const MAX_COLUMNS=32;
// The limit is per bar, not per literal: four bars at 16 steps need 64
// columns. Keep a separate total bound so long code patterns cannot grow the DOM.
export const MAX_PATTERN_COLUMNS=128;
export const columnLimit=(bars:number)=>Math.min(MAX_PATTERN_COLUMNS,MAX_COLUMNS*Math.max(1,bars));
export type Token=string|number;       // a drum name, or a MIDI note
export type GridEvent={col:number;len:number;tokens:Token[]};
export type LockedStep={col:number;len:number;text:string;reason:string};
type Span={start:number;end:number};
// One whitespace-separated piece of the literal; a!3 is one piece, three slots.
type Piece=Span&{text:string;col:number;len:number;weight:number;locked:boolean};
type TimeCall={op:'slow'|'fast';value:number;call:Span;arg:Span};
export type Lane={
  index:number;kind:'sound'|'note';voice:Voice|null;
  columns:number;events:GridEvent[];locked:LockedStep[];
  bars:number;reversed:boolean;alternates:boolean;numeric:boolean;
  problem:string|null;                 // set when the grid cannot show this layer at all
  literal:Span;text:string;voiceSpan:Span|null;leafEnd:number;ownTime:TimeCall[];outerBars:number;pieces:Piece[];
};
export type PatternView={lanes:Lane[];problem:string|null};

const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
const lcm=(a:number,b:number)=>a/gcd(a,b)*b;
const NAMES=['c','c#','d','d#','e','f','f#','g','g#','a','a#','b'];
export const noteName=(midi:number)=>`${NAMES[midi%12]}${Math.floor(midi/12)-1}`;
const tokenText=(t:Token,numeric:boolean)=>typeof t==='number'&&!numeric?noteName(t):String(t);

// --- reading one literal ---------------------------------------------------
// How many equal columns a node needs, or null when it has no fixed grid.
function resolution(m:Mini):number|null{
  switch(m.t){
    case 'word':case 'rest':return 1;
    case 'seq':{
      const total=m.items.reduce((n,x)=>n+x.weight,0);let k=1;
      for(const x of m.items){const r=resolution(x.node);if(r===null)return null;k=lcm(k,r/gcd(r,x.weight));}
      return total*k;
    }
    case 'stack':return m.items.every(x=>x.t==='word')?1:null;
    case 'fast':{const r=resolution(m.node);return r===null?null:r*m.n;}
    default:return null;
  }
}
function lockReason(m:Mini):string{
  switch(m.t){
    case 'alt':return 'This step changes each bar.';
    case 'slow':return 'This step spans several bars.';
    case 'stack':return 'This step layers patterns on top of each other.';
    case 'seq':for(const x of m.items)if(resolution(x.node)===null)return lockReason(x.node);return 'This step is too fine for the grid.';
    case 'fast':return lockReason(m.node);
    default:return 'This step cannot be shown on the grid.';
  }
}
function place(m:Mini,col:number,cols:number,out:GridEvent[]):void{
  switch(m.t){
    case 'word':out.push({col,len:cols,tokens:[m.v]});return;
    case 'rest':return;
    case 'stack':out.push({col,len:cols,tokens:m.items.map(x=>(x as {v:Token}).v)});return;
    case 'seq':{const total=m.items.reduce((n,x)=>n+x.weight,0);let at=col;for(const x of m.items){const span=cols*x.weight/total;place(x.node,at,span,out);at+=span;}return;}
    case 'fast':for(let i=0;i<m.n;i++)place(m.node,col+i*cols/m.n,cols/m.n,out);return;
  }
}
// Top-level pieces of a literal, with their positions in its text. Brackets are
// tracked so a space inside [a b] does not split it; a bare ! belongs to the
// piece before it.
function splitPieces(text:string,base:number):{pieces:Span[];comma:boolean}{
  const pieces:Span[]=[];let depth=0,start=-1,comma=false;
  for(let i=0;i<=text.length;i++){
    const c=text[i],space=c===undefined||/\s/.test(c);
    if(c==='['||c==='<')depth++;else if(c===']'||c==='>')depth--;
    if(depth===0&&c===',')comma=true;
    if(space&&depth===0){if(start>=0){pieces.push({start:start+base,end:i+base});start=-1;}}
    else if(start<0)start=i;
  }
  const merged:Span[]=[];
  for(const p of pieces){const t=text.slice(p.start-base,p.end-base);if(/^!+$/.test(t)&&merged.length)merged.at(-1)!.end=p.end;else merged.push({...p});}
  return {pieces:merged,comma};
}
// A piece as the slots it fills: a@2 is one slot of weight 2, a!3 three of one.
// It is read after a leading rest so the parser sees it as part of a sequence;
// alone, [a b] would come back as the two slots inside it.
function slotsOf(piece:string,kind:'sound'|'note'):{node:Mini;weight:number}[]{return (parseMini(`~ ${piece}`,kind) as Extract<Mini,{t:'seq'}>).items.slice(1);}

function readLiteral(text:string,kind:'sound'|'note',maxColumns:number){
  const trimmed=text.trim(),lead=text.length-text.trimStart().length;
  const empty={columns:1,events:[] as GridEvent[],locked:[] as LockedStep[],pieces:[] as Piece[],alternates:false};
  // <a b c>: one step per bar, the whole literal one long sequence.
  const wrapped=trimmed.startsWith('<')&&trimmed.endsWith('>')&&splitPieces(trimmed,0).pieces.length===1;
  const inner=wrapped?trimmed.slice(1,-1):text,base=wrapped?lead+1:0;
  const {pieces:spans,comma}=splitPieces(inner,base);
  if(comma)return {...empty,problem:'This layer stacks patterns with commas, which the grid cannot show.'};
  if(!spans.length)return {...empty,problem:'This layer has no steps.'};
  const parsed=spans.map(s=>{const piece=text.slice(s.start,s.end);return {...s,text:piece,slots:slotsOf(piece,kind)};});
  const total=parsed.reduce((n,p)=>n+p.slots.reduce((w,x)=>w+x.weight,0),0);
  let k=1;
  for(const p of parsed)for(const x of p.slots){const r=resolution(x.node);if(r!==null)k=lcm(k,r/gcd(r,x.weight));}
  const columns=total*k;
  if(columns>maxColumns)return {...empty,problem:`This layer needs ${columns} steps, more than the grid’s ${maxColumns} for this length.`};
  const events:GridEvent[]=[],locked:LockedStep[]=[],pieces:Piece[]=[];
  let col=0;
  for(const p of parsed){
    const weight=p.slots.reduce((w,x)=>w+x.weight,0),len=weight*k;
    let isLocked=false;
    for(const x of p.slots)if(resolution(x.node)===null)isLocked=true;
    // Inside <…> a step must be one sound or chord: it lasts a whole bar.
    if(wrapped&&p.slots.some(x=>!['word','rest','stack'].includes(x.node.t)))isLocked=true;
    if(isLocked)locked.push({col,len,text:p.text,reason:wrapped?'This step has its own rhythm inside the bar.':lockReason(p.slots.find(x=>resolution(x.node)===null)?.node??p.slots[0].node)});
    else{let at=col;for(const x of p.slots){const span=x.weight*k;place(x.node,at,span,events);at+=span;}}
    pieces.push({start:p.start,end:p.end,text:p.text,col,len,weight,locked:isLocked});
    col+=len;
  }
  return {columns,events,locked,pieces,alternates:wrapped,problem:null as string|null};
}

// --- reading a whole source ------------------------------------------------
type Node={type:string;start:number;end:number;[key:string]:any};
function chainOf(node:Node){
  const calls:{name:string;call:Node}[]=[];let n=node;
  for(;;){
    if(n.type!=='CallExpression'||n.callee.type!=='MemberExpression')break;
    const name=n.callee.property.name as string;
    if(name==='s'&&n.callee.object.type==='CallExpression'&&n.callee.object.callee.name==='note')break;
    calls.push({name,call:n});n=n.callee.object;
  }
  return {calls,base:n};
}
function stringSpan(n:Node):{span:Span;text:string}|null{
  const inner={start:n.start+1,end:n.end-1};
  if(n.type==='Literal'&&typeof n.value==='string'&&n.raw.slice(1,-1)===n.value)return {span:inner,text:n.value};
  if(n.type==='TemplateLiteral'&&n.quasis[0].value.raw===n.quasis[0].value.cooked)return {span:inner,text:n.quasis[0].value.cooked};
  return null;
}
// Reads every s(…) and note(…).s(…) in the source into a lane. Throws only if
// the source itself is invalid, which Code reports.
export function readPattern(source:string):PatternView{
  parseSource(source);
  const ast=parse(source,{ecmaVersion:2023}) as unknown as Node;
  const lanes:Lane[]=[];
  function walk(node:Node,outerBars:number,reversed:boolean){
    const {calls,base}=chainOf(node);
    let bars=outerBars,rev=reversed;const own:TimeCall[]=[];
    for(const {name,call} of calls){
      if(name==='rev')rev=!rev;
      if(name==='slow'||name==='fast'){
        const value=call.arguments[0].value as number;bars*=name==='slow'?value:1/value;
        own.push({op:name,value,call:{start:call.callee.object.end,end:call.end},arg:{start:call.arguments[0].start,end:call.arguments[0].end}});
      }
    }
    if(base.callee.type==='Identifier'&&base.callee.name==='stack'){for(const child of base.arguments as Node[])walk(child,bars,rev);return;}
    const isNote=base.callee.type==='MemberExpression';
    const literalNode=(isNote?base.callee.object.arguments[0]:base.arguments[0]) as Node,voiceNode=isNote?base.arguments[0] as Node:null;
    const lit=stringSpan(literalNode),kind=isNote?'note' as const:'sound' as const,index=lanes.length;
    const voice=voiceNode?(stringSpan(voiceNode)?.text as Voice):null,voiceSpan=voiceNode?stringSpan(voiceNode)?.span??null:null;
    const shared={index,kind,voice,bars,reversed:rev,voiceSpan,leafEnd:base.end,ownTime:own,outerBars,numeric:false};
    if(!lit){lanes.push({...shared,columns:1,events:[],locked:[],alternates:false,problem:'This layer’s text uses escapes the grid cannot rewrite.',literal:{start:literalNode.start,end:literalNode.end},text:'',pieces:[]});return;}
    const read=readLiteral(lit.text,kind,columnLimit(bars));
    // Inside <…> each step lasts a whole bar.
    lanes.push({...shared,...read,bars:read.alternates?bars*read.columns:bars,numeric:/(^|[\s[<,])\d/.test(lit.text),literal:lit.span,text:lit.text});
  }
  walk((ast.body as Node[])[0].expression,1,false);
  return {lanes,problem:lanes.every(l=>l.problem)?lanes[0]?.problem??'This part has nothing the grid can show.':null};
}

// --- a lane at a chosen resolution ------------------------------------------
// The grid can be shown finer than the text needs. That changes nothing until a
// step is edited.
export function viewColumns(lane:Lane,target:number){
  const options=lane.alternates?[lane.columns]:[1,2,3,4,6,8,12,16].map(m=>lane.columns*m).filter(c=>c<=columnLimit(lane.bars));
  return options.find(c=>c>=target)??options.at(-1)??lane.columns;
}
export function scaled(lane:Lane,columns:number){
  const m=columns/lane.columns;
  if(!Number.isInteger(m)||m<1)throw new ExprError('That grid does not fit this layer.');
  return {columns,events:lane.events.map(e=>({...e,col:e.col*m,len:e.len*m})),locked:lane.locked.map(l=>({...l,col:l.col*m,len:l.len*m}))};
}
const sameEvents=(a:GridEvent[],b:GridEvent[],ignoreLength:boolean)=>a.length===b.length&&a.every((x,i)=>x.col===b[i].col&&(ignoreLength||x.len===b[i].len)&&x.tokens.length===b[i].tokens.length&&[...x.tokens].sort().every((t,j)=>t===[...b[i].tokens].sort()[j]));

// --- writing ----------------------------------------------------------------
const chord=(tokens:Token[],numeric:boolean)=>tokens.length>1?`[${tokens.map(t=>tokenText(t,numeric)).join(',')}]`:tokenText(tokens[0],numeric);
// The fewest units that hold these events, as tokens with weights. Drum hits have
// a fixed length, so only where they start matters.
function flat(events:GridEvent[],span:number,kind:'sound'|'note',numeric:boolean,minUnits=1){
  const marks=[span,span/minUnits];
  for(const e of events){marks.push(e.col);if(kind==='note')marks.push(e.col+e.len);}
  const unit=marks.reduce((g,x)=>gcd(g,Math.round(x)),span)||1;
  const out:{text:string;weight:number}[]=[];
  for(let at=0;at<span;){
    const e=events.find(x=>x.col===at);
    if(e){const weight=kind==='note'?Math.max(1,Math.round(e.len/unit)):1;out.push({text:chord(e.tokens,numeric)+(weight>1?`@${weight}`:''),weight});at+=weight*unit;}
    else{out.push({text:'~',weight:1});at+=unit;}
  }
  return out;
}
function replaceLiteral(lane:Lane,columns:number,next:GridEvent[],force=false){
  const view=scaled(lane,columns),m=columns/lane.columns,kind=lane.kind,ignore=kind==='sound';
  const sorted=[...next].sort((a,b)=>a.col-b.col);
  const pieces=lane.pieces.map(p=>({...p,col:p.col*m,len:p.len*m}));
  const within=(list:GridEvent[],from:number,to:number)=>list.filter(e=>e.col>=from&&e.col<to);
  const dirty=pieces.map(p=>force&&!p.locked||!p.locked&&!sameEvents(within(view.events,p.col,p.col+p.len),within(sorted,p.col,p.col+p.len),ignore));
  // A new note that runs past its piece joins the pieces it reaches into.
  const joined=pieces.map(()=>false);
  for(const e of sorted)if(kind==='note')pieces.forEach((p,i)=>{if(e.col>=p.col&&e.col<p.col+p.len&&e.col+e.len>p.col+p.len){for(let j=i;j<pieces.length&&pieces[j].col<e.col+e.len;j++){if(pieces[j].locked)throw new ExprError('A note cannot run through a locked step.');dirty[j]=true;if(j>i)joined[j]=true;}}});
  if(!dirty.some(Boolean))return lane.text;
  const groups:number[][]=[];
  pieces.forEach((_,i)=>{if(!dirty[i])return;if(joined[i])groups.at(-1)!.push(i);else groups.push([i]);});
  const whole=!lane.alternates&&pieces.every(p=>!p.locked)&&(groups.length===1&&groups[0].length===pieces.length||pieces.length===1||dirty.every(Boolean));
  if(whole){
    const uniform=pieces.every(p=>p.len===pieces[0].len&&p.weight===1)?pieces.length:1;
    return lane.text.slice(0,pieces[0].start)+flat(sorted,columns,kind,lane.numeric,uniform).map(x=>x.text).join(' ')+lane.text.slice(pieces.at(-1)!.end);
  }
  let text=lane.text;
  for(const group of [...groups].reverse()){
    const first=pieces[group[0]],last=pieces[group.at(-1)!],span=last.col+last.len-first.col,weight=group.reduce((n,i)=>n+pieces[i].weight,0);
    const local=within(sorted,first.col,first.col+span).map(e=>({...e,col:e.col-first.col}));
    let piece:string;
    if(lane.alternates)piece=local.length?chord(local[0].tokens,lane.numeric):'~';
    else{
      const out=flat(local,span,kind,lane.numeric),units=out.reduce((n,x)=>n+x.weight,0);
      if(units===weight)piece=out.map(x=>x.text).join(' ');
      else if(out.length===1)piece=`${out[0].text.replace(/@\d+$/,'')}${weight>1?`@${weight}`:''}`;
      else piece=`[${out.map(x=>x.text).join(' ')}]${weight>1?`@${weight}`:''}`;
    }
    text=text.slice(0,first.start)+piece+text.slice(last.end);
  }
  return text;
}
const splice=(source:string,span:Span,text:string)=>source.slice(0,span.start)+text+source.slice(span.end);
// Writes a lane's new events into the source. The result is parsed and read back
// and must show exactly what was asked for, or nothing is changed.
export function writeLane(source:string,lane:Lane,columns:number,next:GridEvent[],force=false):string{
  if(lane.problem)throw new ExprError(lane.problem);
  const text=replaceLiteral(lane,columns,next,force);
  if(text===lane.text)return source;
  const result=splice(source,lane.literal,text);
  const back=readPattern(result).lanes[lane.index];
  const size=lcm(back.columns,columns);
  if(size<=MAX_PATTERN_COLUMNS*4){
    const want=[...next].sort((a,b)=>a.col-b.col).map(e=>({...e,col:e.col*size/columns,len:e.len*size/columns}));
    const got=back.events.map(e=>({...e,col:e.col*size/back.columns,len:e.len*size/back.columns}));
    if(!sameEvents(want,got,lane.kind==='sound'))throw new ExprError('That change could not be written exactly, so nothing was changed.');
  }
  return result;
}

// --- changing a grid --------------------------------------------------------
const blocked=(locked:LockedStep[],col:number)=>locked.some(l=>col>=l.col&&col<l.col+l.len);
export function hasToken(events:GridEvent[],col:number,token:Token,cover=false){
  return events.some(e=>e.tokens.includes(token)&&(cover?col>=e.col&&col<e.col+e.len:e.col===col));
}
// A drum hit on or off.
export function toggleHit(events:GridEvent[],locked:LockedStep[],col:number,token:Token):GridEvent[]{
  if(blocked(locked,col))throw new ExprError('This step is locked. Change it in Code.');
  const at=events.find(e=>e.col===col);
  if(!at)return [...events,{col,len:1,tokens:[token]}];
  const tokens=at.tokens.includes(token)?at.tokens.filter(t=>t!==token):[...at.tokens,token];
  return events.flatMap(e=>e!==at?[e]:tokens.length?[{...e,tokens}]:[]);
}
// A note on or off. Placing one trims a note that was still ringing there, and
// stops short of the next note, so a step never holds two different lengths.
export function toggleNote(events:GridEvent[],locked:LockedStep[],columns:number,col:number,note:number,length=1):GridEvent[]{
  if(blocked(locked,col))throw new ExprError('This step is locked. Change it in Code.');
  const hit=events.find(e=>e.tokens.includes(note)&&col>=e.col&&col<e.col+e.len);
  if(hit){const tokens=hit.tokens.filter(t=>t!==note);return events.flatMap(e=>e!==hit?[e]:tokens.length?[{...e,tokens}]:[]);}
  const same=events.find(e=>e.col===col);
  if(same)return events.map(e=>e===same?{...e,tokens:[...e.tokens,note]}:e);
  let len=Math.max(1,Math.min(length,columns-col));
  for(const e of events)if(e.col>col)len=Math.min(len,e.col-col);
  for(const l of locked)if(l.col>col)len=Math.min(len,l.col-col);
  const trimmed=events.map(e=>e.col<col&&e.col+e.len>col?{...e,len:col-e.col}:e);
  return [...trimmed,{col,len,tokens:[note]}];
}
// A row of the kit moved to another drum, everywhere it plays.
export function swapToken(events:GridEvent[],from:Token,to:Token):GridEvent[]{return events.map(e=>({...e,tokens:[...new Set(e.tokens.map(t=>t===from?to:t))]}));}
export function setVoice(source:string,lane:Lane,voice:Voice):string{
  if(!lane.voiceSpan)throw new ExprError('This layer has no synth to change.');
  if(!(VOICES as readonly string[]).includes(voice))throw new ExprError('Unknown synth.');
  const next=splice(source,lane.voiceSpan,voice);parseSource(next);return next;
}
// Length in bars. Lengthening repeats what is there, so nothing audible changes
// until a new step is placed; shortening keeps the opening bars and only happens
// when a person asks for it.
export function lengthOptions(lane:Lane){return [1,2,4,8].filter(b=>canSetBars(lane,b)===null);}
export function canSetBars(lane:Lane,bars:number):string|null{
  if(lane.problem)return lane.problem;
  if(lane.alternates)return 'This layer plays one step per bar. Add or remove steps in Code.';
  if(lane.ownTime.some(t=>t.op==='fast'))return 'This layer uses fast(). Change its length in Code.';
  if(lane.ownTime.length>1)return 'This layer has several speed changes. Change its length in Code.';
  const factor=bars/lane.outerBars;
  if(factor<1||!TIME_FACTORS.includes(factor))return 'The whole part is already stretched. Change its length in Code.';
  const ratio=bars/lane.bars;
  if(lane.columns*ratio>columnLimit(bars))return 'That length needs more steps than the grid can show. Keep this length or edit it in Code.';
  if(ratio<1){
    const keep=lane.columns*ratio;
    if(!Number.isInteger(keep)||!lane.pieces.some(p=>p.col===keep))return 'These bars do not divide evenly. Change the length in Code.';
  }
  if(ratio>1&&lane.pieces.length*ratio>LIMITS.sequenceItems)return 'That would make this layer too long.';
  return null;
}
export function setBars(source:string,lane:Lane,bars:number):string{
  const refused=canSetBars(lane,bars);if(refused)throw new ExprError(refused);
  const ratio=bars/lane.bars;if(ratio===1)return source;
  const factor=bars/lane.outerBars,own=lane.ownTime[0];
  let text:string;
  if(ratio>1)text=Array.from({length:ratio},()=>lane.text.trim()).join(' ');
  else{const keep=lane.columns*ratio,cut=lane.pieces.find(p=>p.col===keep)!;text=lane.text.slice(0,cut.start).trimEnd();}
  // Later text first, so earlier positions stay valid.
  let next=source;
  if(own){next=factor===1?splice(next,own.call,''):splice(next,own.arg,String(factor));}
  else if(factor!==1)next=next.slice(0,lane.leafEnd)+`.slow(${factor})`+next.slice(lane.leafEnd);
  next=splice(next,lane.literal,text);
  parseSource(next);
  const back=readPattern(next).lanes[lane.index];
  if(back.problem)throw new ExprError(back.problem);
  return next;
}
// A new layer, added to the part's stack, or a new stack if it has none.
export function addLayer(source:string,kind:'sound'|'note',steps=16):string{
  const rests=Array.from({length:steps},()=>'~').join(' ');
  const layer=kind==='sound'?`s("${rests}")`:`note("${rests}").s("triangle")`;
  const ast=parse(source,{ecmaVersion:2023}) as unknown as Node,root=(ast.body as Node[])[0].expression as Node;
  const {base}=chainOf(root);
  let next:string;
  if(base.callee.type==='Identifier'&&base.callee.name==='stack'){
    if(base.arguments.length>=LIMITS.stackItems)throw new ExprError(`A part holds at most ${LIMITS.stackItems} layers.`);
    const last=base.arguments.at(-1) as Node;next=source.slice(0,last.end)+`, ${layer}`+source.slice(last.end);
  }else next=source.slice(0,root.start)+`stack(${source.slice(root.start,root.end)}, ${layer})`+source.slice(root.end);
  parseSource(next);return next;
}
export function removeLayer(source:string,lane:Lane):string{
  const ast=parse(source,{ecmaVersion:2023}) as unknown as Node,root=(ast.body as Node[])[0].expression as Node;
  const {base}=chainOf(root);
  if(!(base.callee.type==='Identifier'&&base.callee.name==='stack')||base.arguments.length<2)throw new ExprError('A part needs at least one layer.');
  const list=base.arguments as Node[],at=list.findIndex(n=>n.start<=lane.literal.start&&lane.literal.end<=n.end);
  if(at<0)throw new ExprError('Remove this layer in Code.');
  const next=at===list.length-1?source.slice(0,list[at-1].end)+source.slice(list[at].end):source.slice(0,list[at].start)+source.slice(list[at+1].start);
  parseSource(next);return next;
}
// Rewrites alternation as plain bars. This changes how the pattern is written,
// not how it sounds, and it is only ever used to make a separate copy that a
// person has asked for: the original part is untouched.
function pickBar(text:string,bar:number):string{
  let out='',i=0;
  while(i<text.length){
    if(text[i]!=='<'){out+=text[i++];continue;}
    let depth=0,j=i;
    for(;j<text.length;j++){if(text[j]==='<'||text[j]==='[')depth++;else if(text[j]==='>'||text[j]===']'){depth--;if(depth===0)break;}}
    const {pieces}=splitPieces(text.slice(i+1,j),0),piece=pieces[bar%pieces.length];
    out+=pickBar(text.slice(i+1,j).slice(piece.start,piece.end),Math.floor(bar/pieces.length));i=j+1;
  }
  return out;
}
export function unrolledCopy(source:string):{source:string;changed:boolean}{
  const view=readPattern(source);let next=source,changed=false;
  for(const lane of [...view.lanes].reverse()){
    if(lane.problem||!(lane.alternates||lane.locked.some(l=>/changes each bar/.test(l.reason))))continue;
    if(lane.ownTime.length>1||lane.ownTime.some(t=>t.op==='fast')||/<[^>]*@/.test(lane.text))continue;
    const period=exprPeriod(lane.text,lane.kind);if(period<2||period>8)continue;
    const bars=Array.from({length:period},(_,b)=>pickBar(lane.text,b).trim());
    const text=bars.join(' ');
    const own=lane.ownTime[0],factor=(own?own.value:1)*period;
    if(!TIME_FACTORS.includes(factor))continue;
    if(own)next=splice(next,own.arg,String(factor));else next=next.slice(0,lane.leafEnd)+`.slow(${factor})`+next.slice(lane.leafEnd);
    next=splice(next,lane.literal,text);changed=true;
  }
  parseSource(next);return {source:next,changed};
}
function exprPeriod(text:string,kind:'sound'|'note'){
  const m=parseMini(text,kind);
  const walk=(x:Mini):number=>{switch(x.t){case 'alt':return x.layers.reduce((p,l)=>lcm(p,(l.t==='seq'?l.items.length:1)*walk(l)),1);case 'seq':return x.items.reduce((p,i)=>lcm(p,walk(i.node)),1);case 'stack':return x.items.reduce((p,i)=>lcm(p,walk(i)),1);case 'fast':case 'slow':return walk(x.node);default:return 1;}};
  return walk(m);
}
// Rows of a drum kit, in a stable order: each drum a lane actually plays.
export function kitRows(view:PatternView){
  const order=DRUMS as readonly string[];
  return view.lanes.filter(l=>l.kind==='sound'&&!l.problem).flatMap(l=>[...new Set(l.events.flatMap(e=>e.tokens))].sort((a,b)=>order.indexOf(String(a))-order.indexOf(String(b))).map(token=>({lane:l.index,token:String(token)})));
}
// In plain words, what the grid cannot edit in this part.
export function limitations(view:PatternView){
  const out:string[]=[];
  for(const l of view.lanes){
    const name=view.lanes.length>1?`Layer ${l.index+1}: `:'';
    if(l.problem)out.push(`${name}${l.problem}`);
    for(const reason of new Set(l.locked.map(x=>x.reason)))out.push(`${name}${reason} Those steps are locked and stay exactly as written.`);
    if(l.reversed)out.push(`${name}This layer plays backwards (rev), so the grid reads right to left.`);
    if(l.ownTime.some(t=>t.op==='fast')||l.bars<1)out.push(`${name}This layer runs faster than the grid’s bar lines.`);
  }
  return out;
}
