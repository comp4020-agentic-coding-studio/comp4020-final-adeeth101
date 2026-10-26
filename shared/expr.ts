// Version 2 of the musical model: a Strudel expression parsed from source.
// The source text is the truth and is kept verbatim; the expression tree is
// derived from it, validated with every bound before anything is expanded, and
// is what the browser turns into Strudel patterns with allowlisted calls. The
// server imports this file (Acorn only), never Strudel.
import {parse} from 'acorn';

export const DRUMS = ['bd','sd','hh','cp'] as const;
export const VOICES = ['sine','triangle','square','sawtooth'] as const;
export const CONTROLS = ['gain','lpf','room','pan','release'] as const;
export type Drum = typeof DRUMS[number];
export type Voice = typeof VOICES[number];
export type Control = typeof CONTROLS[number];

export const LIMITS = {
  sourceBytes: 8192,
  astNodes: 600,
  depth: 12,
  miniNodes: 1024,
  stackItems: 8,
  sequenceItems: 64,
  repeat: 16,
  onsetsPerCycle: 64,
  periodCycles: 64,
  noteMin: 24,
  noteMax: 96,
} as const;
// Ranges follow Strudel's own units: gain is linear, lpf is Hz, room is the
// reverb send, pan runs 0 (left) to 1 (right), release is seconds.
export const CONTROL_RANGE: Record<Control,[number,number]> = {gain:[0,1],lpf:[60,16000],room:[0,1],pan:[0,1],release:[0.01,4]};
// fast/slow by whole numbers, or by a half or quarter: every legal piece then
// repeats after a whole number of bars, which is what makes the bounds exact.
export const TIME_FACTORS = [0.25,0.5,1,2,3,4,5,6,7,8];

export type Mini =
  | {t:'word'; v:number|Drum}
  | {t:'rest'}
  | {t:'seq'; items:{node:Mini; weight:number}[]}
  | {t:'stack'; items:Mini[]}
  | {t:'alt'; layers:Mini[]}
  | {t:'fast'|'slow'; n:number; node:Mini};
export type Expr =
  | {k:'sound'; mini:Mini}
  | {k:'note'; mini:Mini; voice:Voice}
  | {k:'stack'; items:Expr[]}
  | {k:'set'; ctl:Control; value:number; child:Expr}
  | {k:'time'; op:'fast'|'slow'; value:number; child:Expr}
  | {k:'rev'; child:Expr};
export type ExprDocument = {schemaVersion:2; root:Expr};

export class ExprError extends Error {
  at?: number;
  constructor(message:string, at?:number){super(at===undefined?message:`${message} (character ${at+1})`);this.at=at;}
}
const fail=(message:string,at?:number):never=>{throw new ExprError(message,at);};

// --- mini-notation -------------------------------------------------------
// Supported: words, ~ rests, spaces for sequences, [ ] subdivisions,
// < > one-per-cycle alternation, commas for layers/chords, *n and /n with
// whole n from 1 to 16, !n repetition (or a bare !) and @n weights.
const NOTE_NAME=/^([a-gA-G])([#b]*)(-?\d*)$/;
const CHROMA:Record<string,number>={c:0,d:2,e:4,f:5,g:7,a:9,b:11};
export function noteValue(token:string):number|null{
  if(/^\d+$/.test(token))return Number(token);
  const m=token.match(NOTE_NAME);if(!m)return null;
  // Strudel's noteToMidi: octave 3 when none is written, so a3 = a = 57.
  const octave=m[3]===''?3:Number(m[3]);
  return (octave+1)*12+CHROMA[m[1].toLowerCase()]+[...m[2]].reduce((n,c)=>n+(c==='#'?1:-1),0);
}
export function parseMini(text:string, kind:'sound'|'note', offset=0):Mini{
  let i=0,nodes=0;
  const count=(n:number)=>{nodes+=n;if(nodes>LIMITS.miniNodes)fail(`This pattern expands to more than ${LIMITS.miniNodes} steps. Shorten it or repeat less.`,offset+i);};
  const ws=()=>{while(i<text.length&&/\s/.test(text[i]))i++;};
  const int=(min:number,max:number,what:string)=>{const start=i;while(/\d/.test(text[i]??''))i++;const s=text.slice(start,i);if(!s||text[i]==='.')fail(`${what} needs a whole number from ${min} to ${max}.`,offset+start);const n=Number(s);if(n<min||n>max)fail(`${what} needs a whole number from ${min} to ${max}.`,offset+start);return n;};
  function word():Mini{
    const start=i;while(i<text.length&&/[A-Za-z0-9#\-]/.test(text[i]))i++;
    const w=text.slice(start,i);
    if(!w)fail(text[i]===undefined?'The pattern ends too early.':`“${text[i]}” is not supported in this pattern.`,offset+start);
    count(1);
    if(kind==='sound'){if(!(DRUMS as readonly string[]).includes(w))fail(`Unknown sound “${w}”. Use bd, sd, hh, cp or ~ for a rest.`,offset+start);return {t:'word',v:w as Drum};}
    const v=noteValue(w);
    if(v===null)fail(`“${w}” is not a note. Use MIDI numbers or names like a3, c#4, eb2.`,offset+start);
    if(v!<LIMITS.noteMin||v!>LIMITS.noteMax)fail(`Note ${w} is outside MIDI ${LIMITS.noteMin}–${LIMITS.noteMax}.`,offset+start);
    return {t:'word',v:v!};
  }
  function term(depth:number):Mini{
    if(depth>LIMITS.depth)fail('This pattern is nested too deeply.',offset+i);
    const c=text[i];
    if(c==='~'){i++;count(1);return {t:'rest'};}
    if(c==='['){i++;const node=layers(depth+1,']');return node.length===1?node[0]:{t:'stack',items:node};}
    if(c==='<'){i++;return {t:'alt',layers:layers(depth+1,'>')};}
    return word();
  }
  function step(depth:number):{node:Mini;weight:number;copies:number}{
    let node=term(depth),weight=1,copies=1;
    for(;;){
      const c=text[i];
      if(c==='*'){i++;node={t:'fast',n:int(1,16,'*'),node};}
      else if(c==='/'){i++;node={t:'slow',n:int(1,16,'/'),node};}
      else if(c==='!'){i++;copies=/\d/.test(text[i]??'')?int(2,LIMITS.repeat,'!'):copies+1;}
      else if(c==='@'){i++;weight=int(1,16,'@');}
      else break;
    }
    if(copies>1)count(size(node)*(copies-1));
    return {node,weight,copies};
  }
  function sequence(depth:number,end:string):Mini{
    const items:{node:Mini;weight:number}[]=[];
    for(ws();i<text.length&&text[i]!==end&&text[i]!==',';ws()){
      if(text[i]==='!'&&items.length){i++;items.push(items.at(-1)!);count(size(items.at(-1)!.node));continue;}
      const s=step(depth);for(let n=0;n<s.copies;n++)items.push({node:s.node,weight:s.weight});
      if(items.length>LIMITS.sequenceItems)fail(`A sequence holds at most ${LIMITS.sequenceItems} steps.`,offset+i);
    }
    if(!items.length)fail('Add a sound, note or rest (~) here.',offset+i);
    return items.length===1&&items[0].weight===1?items[0].node:{t:'seq',items};
  }
  function layers(depth:number,end:string):Mini[]{
    const out=[sequence(depth,end)];
    while(text[i]===','){i++;out.push(sequence(depth,end));if(out.length>LIMITS.stackItems)fail(`Layer at most ${LIMITS.stackItems} patterns with commas.`,offset+i);}
    if(end){if(text[i]!==end)fail(`Close this with “${end}”.`,offset+i);i++;}
    return out;
  }
  const top=layers(0,'');
  if(i<text.length)fail(`“${text[i]}” is not supported in this pattern.`,offset+i);
  return top.length===1?top[0]:{t:'stack',items:top};
}
function size(m:Mini):number{
  switch(m.t){case 'word':case 'rest':return 1;case 'seq':return m.items.reduce((n,x)=>n+size(x.node),0);case 'stack':return m.items.reduce((n,x)=>n+size(x),0);case 'alt':return m.layers.reduce((n,x)=>n+size(x),0);default:return size(m.node);}
}

// --- exact bounds, computed on the tree before any pattern exists ---------
// onsets: the most note/sound starts any one bar can hold. period: the number
// of bars after which the pattern repeats exactly. Both are exact upper bounds
// for the grammar above because every speed factor is a whole number or a
// whole-number fraction, so a bar never straddles two child cycles.
const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
const lcm=(a:number,b:number)=>a/gcd(a,b)*b;
const stepCount=(m:Mini)=>m.t==='seq'?m.items.reduce((n,x)=>n+x.weight,0):1;
export function miniBounds(m:Mini):{onsets:number;period:number}{
  switch(m.t){
    case 'word':return {onsets:1,period:1};
    case 'rest':return {onsets:0,period:1};
    case 'seq':case 'stack':{const parts=(m.t==='seq'?m.items.map(x=>x.node):m.items).map(miniBounds);return {onsets:parts.reduce((n,x)=>n+x.onsets,0),period:parts.reduce((p,x)=>lcm(p,x.period),1)};}
    case 'alt':{
      // Each layer advances one step per bar: a bar holds one step's worth.
      const parts=m.layers.map(layer=>{const steps=layer.t==='seq'?layer.items.map(x=>miniBounds(x.node)):[miniBounds(layer)];return {onsets:Math.max(...steps.map(x=>x.onsets)),period:stepCount(layer)*steps.reduce((p,x)=>lcm(p,x.period),1)};});
      return {onsets:parts.reduce((n,x)=>n+x.onsets,0),period:parts.reduce((p,x)=>lcm(p,x.period),1)};
    }
    case 'fast':{const b=miniBounds(m.node);return {onsets:b.onsets*m.n,period:b.period/gcd(b.period,m.n)};}
    case 'slow':{const b=miniBounds(m.node);return {onsets:b.onsets,period:b.period*m.n};}
  }
}
function timeBounds(b:{onsets:number;period:number},op:'fast'|'slow',f:number){
  const speed=op==='fast'?f:1/f;
  if(speed>=1)return {onsets:b.onsets*speed,period:b.period/gcd(b.period,speed)};
  return {onsets:b.onsets,period:b.period*Math.round(1/speed)};
}
export function exprBounds(e:Expr):{onsets:number;period:number}{
  switch(e.k){
    case 'sound':case 'note':return miniBounds(e.mini);
    case 'stack':{const parts=e.items.map(exprBounds);return {onsets:parts.reduce((n,x)=>n+x.onsets,0),period:parts.reduce((p,x)=>lcm(p,x.period),1)};}
    case 'time':return timeBounds(exprBounds(e.child),e.op,e.value);
    default:return exprBounds(e.child);
  }
}
function checkBounds(e:Expr){
  const b=exprBounds(e);
  if(b.onsets>LIMITS.onsetsPerCycle)fail(`This part could start ${b.onsets} sounds in one bar; the limit is ${LIMITS.onsetsPerCycle}. Remove steps or a speed-up.`);
  if(b.period>LIMITS.periodCycles)fail(`This part only repeats after ${b.period} bars; the limit is ${LIMITS.periodCycles}. Use fewer alternations or less slowing.`);
  return b;
}

// --- the expression grammar, read from an Acorn AST -----------------------
type Node={type:string;start:number;end:number;[key:string]:any};
export type ParsedSource={document:ExprDocument;bounds:{onsets:number;period:number}};
export function parseSource(source:string):ParsedSource{
  if(typeof source!=='string')fail('Code must be text.');
  if(new TextEncoder().encode(source).length>LIMITS.sourceBytes)fail('Keep code under 8 KB.');
  let ast:Node;
  try{ast=parse(source,{ecmaVersion:2023,sourceType:'script',allowReturnOutsideFunction:false}) as unknown as Node;}
  catch(e){const err=e as {message:string;pos?:number};fail(`Syntax error: ${err.message.replace(/\s*\(\d+:\d+\)$/,'')}`,err.pos);}
  let nodes=0;
  const body=ast!.body as Node[];
  if(body.length!==1||body[0].type!=='ExpressionStatement')fail('Write one Strudel expression, like s("bd ~ sd ~"). Variables, functions and several statements are not supported.',body[1]?.start??body[0]?.start);
  if(body[0].directive)fail('Write a pattern such as s("bd ~ sd ~"), not a bare string.',body[0].start);
  function str(n:Node,what:string):{text:string;offset:number}{
    if(n?.type==='Literal'&&typeof n.value==='string')return {text:n.value,offset:n.start+1};
    if(n?.type==='TemplateLiteral'){if(n.expressions.length)fail('Template strings cannot contain ${…}.',n.start);return {text:n.quasis[0].value.cooked,offset:n.start+1};}
    return fail(`${what} takes a quoted pattern.`,n?.start);
  }
  function num(n:Node,what:string):number{
    if(n?.type==='Literal'&&typeof n.value==='number'&&Number.isFinite(n.value))return n.value;
    return fail(`${what}() takes a plain number.`,n?.start);
  }
  function args(n:Node,count:number,name:string){
    if(n.optional||n.arguments.some((a:Node)=>a.type==='SpreadElement'))fail(`Write ${name}(…) plainly.`,n.start);
    if(n.arguments.length!==count)fail(`${name}() takes ${count===0?'nothing':count===1?'one value':`${count} values`}.`,n.start);
    return n.arguments as Node[];
  }
  function walk(n:Node,depth:number):Expr{
    if(++nodes>LIMITS.astNodes)fail('This expression is too long.',n.start);
    if(depth>LIMITS.depth)fail('This expression is nested too deeply.',n.start);
    if(n.type!=='CallExpression')fail(n.type==='Identifier'?`“${n.name}” is not a pattern here. Call s(…), note(…) or stack(…).`:'Only pattern calls like s(…), note(…).s(…) and stack(…) are supported.',n.start);
    const callee=n.callee as Node;
    if(callee.type==='Identifier'){
      if(callee.name==='s'){const [a]=args(n,1,'s'),{text,offset}=str(a,'s()');return {k:'sound',mini:parseMini(text,'sound',offset)};}
      if(callee.name==='stack'){
        if(!n.arguments.length||n.arguments.length>LIMITS.stackItems)fail(`stack() takes 1 to ${LIMITS.stackItems} patterns.`,n.start);
        args(n,n.arguments.length,'stack');return {k:'stack',items:(n.arguments as Node[]).map(x=>walk(x,depth+1))};
      }
      if(callee.name==='note')fail('Give the notes a synth: note("…").s("triangle"). Choose sine, triangle, square or sawtooth.',n.end);
      return fail(`${callee.name}() is not supported. Use s, note, stack, gain, lpf, room, pan, release, fast, slow or rev.`,callee.start);
    }
    if(callee.type!=='MemberExpression'||callee.computed||callee.optional||callee.property.type!=='Identifier')fail('Use plain method calls like .gain(0.5).',callee.start);
    const name=callee.property.name as string,base=callee.object as Node;
    if(name==='s'){
      if(base.type!=='CallExpression'||base.callee.type!=='Identifier'||base.callee.name!=='note')fail('.s("synth") goes straight after note("…").',callee.property.start);
      const [b]=args(base,1,'note'),[v]=args(n,1,'s'),{text,offset}=str(b,'note()'),voice=str(v,'.s()').text;
      if(!(VOICES as readonly string[]).includes(voice))fail(`Unknown synth “${voice}”. Choose sine, triangle, square or sawtooth.`,v.start);
      return {k:'note',mini:parseMini(text,'note',offset),voice:voice as Voice};
    }
    if(name==='rev'){args(n,0,'rev');return {k:'rev',child:walk(base,depth+1)};}
    if(name==='fast'||name==='slow'){
      const [a]=args(n,1,name),value=num(a,name);
      if(!TIME_FACTORS.includes(value))fail(`${name}() takes 0.25, 0.5 or a whole number from 1 to 8.`,a.start);
      return {k:'time',op:name,value,child:walk(base,depth+1)};
    }
    if((CONTROLS as readonly string[]).includes(name)){
      const [a]=args(n,1,name),value=num(a,name),[lo,hi]=CONTROL_RANGE[name as Control];
      if(value<lo||value>hi)fail(`${name}() takes ${lo} to ${hi}.`,a.start);
      return {k:'set',ctl:name as Control,value,child:walk(base,depth+1)};
    }
    return fail(`.${name}() is not supported. Use gain, lpf, room, pan, release, fast, slow or rev.`,callee.property.start);
  }
  const root=walk(body[0].expression,0);
  return {document:{schemaVersion:2,root},bounds:checkBounds(root)};
}

// Documents also arrive from the network (plans, imports); they are checked
// structurally with the same bounds the parser applies.
export function validateExpr(input:unknown):ExprDocument{
  const doc=input as ExprDocument;
  if(!doc||typeof doc!=='object'||doc.schemaVersion!==2)fail('Unknown expression format.');
  let count=0;
  const isNum=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
  function mini(m:any,kind:'sound'|'note',depth:number):void{
    if(++count>LIMITS.miniNodes||depth>LIMITS.depth*2||!m||typeof m!=='object')fail('Pattern is too large.');
    switch(m.t){
      case 'word':if(kind==='sound'?!(DRUMS as readonly unknown[]).includes(m.v):!(Number.isInteger(m.v)&&m.v>=LIMITS.noteMin&&m.v<=LIMITS.noteMax))fail('Unsupported step.');return;
      case 'rest':return;
      case 'seq':if(!Array.isArray(m.items)||!m.items.length||m.items.length>LIMITS.sequenceItems)fail('Bad sequence.');for(const x of m.items){if(!Number.isInteger(x.weight)||x.weight<1||x.weight>16)fail('Bad weight.');mini(x.node,kind,depth+1);}return;
      case 'stack':case 'alt':{const list=m.t==='stack'?m.items:m.layers;if(!Array.isArray(list)||!list.length||list.length>LIMITS.stackItems)fail('Bad layers.');list.forEach((x:unknown)=>mini(x,kind,depth+1));return;}
      case 'fast':case 'slow':if(!Number.isInteger(m.n)||m.n<1||m.n>16)fail('Bad speed.');mini(m.node,kind,depth+1);return;
      default:fail('Unsupported pattern node.');
    }
  }
  function expr(e:any,depth:number):void{
    if(++count>LIMITS.astNodes+LIMITS.miniNodes||depth>LIMITS.depth||!e||typeof e!=='object')fail('Expression is too large.');
    switch(e.k){
      case 'sound':mini(e.mini,'sound',0);return;
      case 'note':if(!(VOICES as readonly unknown[]).includes(e.voice))fail('Unknown synth.');mini(e.mini,'note',0);return;
      case 'stack':if(!Array.isArray(e.items)||!e.items.length||e.items.length>LIMITS.stackItems)fail('Bad stack.');e.items.forEach((x:unknown)=>expr(x,depth+1));return;
      case 'set':{if(!(CONTROLS as readonly unknown[]).includes(e.ctl)||!isNum(e.value))fail('Bad control.');const [lo,hi]=CONTROL_RANGE[e.ctl as Control];if(e.value<lo||e.value>hi)fail('Control out of range.');expr(e.child,depth+1);return;}
      case 'time':if(!['fast','slow'].includes(e.op)||!TIME_FACTORS.includes(e.value))fail('Bad speed.');expr(e.child,depth+1);return;
      case 'rev':expr(e.child,depth+1);return;
      default:fail('Unsupported expression node.');
    }
  }
  expr(doc.root,0);checkBounds(doc.root);
  return {schemaVersion:2,root:structuredClone(doc.root)};
}

// --- Shape: edit one outer control without disturbing the rest -------------
// A control written on the outermost chain applies to the whole part, so its
// number can be replaced in place. A control that is absent everywhere can be
// appended. A control set only inside (one layer of a stack, say) cannot be
// changed from outside without overriding what was written there, so Shape
// declines and points to Code. The rest of the source is never rewritten.
export type ShapeState={available:boolean;value:number|null;reason?:string};
function outerChain(source:string){
  const ast=parse(source,{ecmaVersion:2023}) as unknown as Node;
  const root=(ast.body as Node[])[0].expression as Node;
  const chain:{name:string;arg:Node}[]=[];let n=root;
  while(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.property.name!=='s'){chain.push({name:n.callee.property.name,arg:n.arguments[0]});n=n.callee.object;}
  return {root,chain,base:n};
}
function containsControl(e:Expr,ctl:Control):boolean{
  if(e.k==='set'&&e.ctl===ctl)return true;
  if(e.k==='stack')return e.items.some(x=>containsControl(x,ctl));
  return e.k==='set'||e.k==='time'||e.k==='rev'?containsControl(e.child,ctl):false;
}
export function shapeState(source:string,ctl:Control):ShapeState{
  const {document}=parseSource(source),{chain}=outerChain(source);
  const outer=chain.find(x=>x.name===ctl);
  if(outer)return {available:true,value:outer.arg.value};
  if(containsControl(document.root,ctl))return {available:false,value:null,reason:`This part sets ${ctl} inside the pattern. Change it in Code.`};
  return {available:true,value:null};
}
export function applyShape(source:string,ctl:Control,value:number):string{
  const [lo,hi]=CONTROL_RANGE[ctl];
  if(!Number.isFinite(value)||value<lo||value>hi)fail(`${ctl} takes ${lo} to ${hi}.`);
  const state=shapeState(source,ctl);if(!state.available)fail(state.reason!);
  const text=String(Math.round(value*1000)/1000),{root,chain}=outerChain(source);
  const outer=chain.find(x=>x.name===ctl);
  const next=outer?source.slice(0,outer.arg.start)+text+source.slice(outer.arg.end):source.slice(0,root.end)+`.${ctl}(${text})`+source.slice(root.end);
  parseSource(next);return next;
}
