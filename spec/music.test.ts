import { expect,it } from 'vitest';
import {emptyClip, validateDocument, type MusicNode} from '../shared/music.ts';
import {parseCode,printNode} from '../shared/code.ts';
import {rhythmBot,melodyBot,random} from '../shared/bots.ts';
import {compile} from '../shared/compile.ts';
import {blankPlan,sceneAt,planAt,nextBoundary,resolvePlan} from '../shared/performance.ts';
it('round-trips bounded trees without executing text',()=>{
  for(let seed=1;seed<=100;seed++) {
    for(const document of [rhythmBot(seed,'steady'),melodyBot(seed),emptyClip(),{schemaVersion:1,root:{kind:'transform',op:'slow',value:2,child:melodyBot(seed).root}}]) {
      const doc = validateDocument(document);
      expect(parseCode(printNode(doc.root))).toEqual(doc);
    }
  }
});
it.each(['fetch("/api/me")','s("bd").constructor("alert(1)")()', 's(`bd`)', 's("bd")["rev"]()', 's("bd").gain(1/2)', 's("bd"); alert(1)', 'note("999").s("sine")', 's("bd").fast(4).fast(4)', 's("bd*2")'])('rejects unsupported or executable input %s',source=>expect(()=>parseCode(source)).toThrow());
it('queries real Strudel patterns and preserves global phase',()=>{
  const p=compile(parseCode('s("bd ~ sd ~").fast(2)').root);
  const hits=p.queryArc(5,6).filter(x=>x.hasOnset()).map(x=>({begin:Number(x.whole.begin),sound:x.value.s})).sort((a,b)=>a.begin-b.begin);
  expect(hits.map(x=>x.begin)).toEqual([5,5.25,5.5,5.75]);
  expect(hits.map(x=>x.sound)).toEqual(['bd','sd','bd','sd']);
});
it('bots are reproducible, editable and bounded',()=>{
  expect(random(1)()).toBe(270369/4294967296);
  expect(rhythmBot(42,'steady')).toEqual(rhythmBot(42,'steady'));
  expect(printNode(melodyBot(1).root)).toMatch(/^note\(/);
  for(let i=0;i<100;i++) {validateDocument(rhythmBot(i,'busy'));validateDocument(melodyBot(i,i%12,true,12));}
});
it('arranger holds/loops and manual selection wins',()=>{
  const p=blankPlan();p.arrangement={entries:[{scene:'A',bars:2},{scene:'B',bars:1}],loop:false,startCycle:4};
  expect([3,4,5,6,9].map(c=>sceneAt(p,c))).toEqual(['A','A','A','B','B']);
  p.arrangement.loop=true;expect(sceneAt(p,7)).toBe('A');
  p.catalog.t={A:{revision:1,document:emptyClip('melody')}};p.sceneAssignments.A.t='A';
  expect(resolvePlan(p,4)).toHaveLength(1);p.manual.t=null;expect(resolvePlan(p,4)).toEqual([]);
  expect(planAt([p,{...p,planRevision:2}],4)?.planRevision).toBe(2);
  expect(nextBoundary(300,0,120)).toBe(1);
});
