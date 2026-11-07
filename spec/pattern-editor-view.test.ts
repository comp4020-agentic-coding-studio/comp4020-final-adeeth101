// @vitest-environment jsdom
import {afterEach,expect,it} from 'vitest';
import {PatternEditor} from '../client/pattern-editor.ts';
import {readPattern} from '../shared/steps.ts';

afterEach(()=>document.body.replaceChildren());
function editor(initial:string){
  let source=initial;
  const root=document.createElement('div');document.body.append(root);
  const view=new PatternEditor(root,{source:()=>source,change:s=>{source=s;},editable:()=>true});view.render();
  const click=(selector:string)=>{const button=root.querySelector<HTMLButtonElement>(selector);expect(button,selector).not.toBeNull();button!.click();};
  return {root,click,source:()=>source};
}

it.each(['sound','note'])('four bars of a blank %s remain editable at 8 and 16 steps per bar',kind=>{
  const initial=kind==='sound'?`s("${Array(16).fill('~').join(' ')}")`:`note("${Array(16).fill('~').join(' ')}").s("triangle")`;
  const e=editor(initial);
  e.click('[data-pe="bars"][data-n="4"]');
  expect(readPattern(e.source()).lanes[0].bars).toBe(4);
  expect(readPattern(e.source()).problem).toBeNull();
  const saved=e.source();
  for(const n of [8,16,8,16]){
    e.click(`[data-pe="target"][data-n="${n}"]`);
    expect(e.root.querySelector(`[data-pe="target"][data-n="${n}"]`)!.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(e.root.querySelector(`[data-pe="target"][data-n="${n}"]`));
    expect(e.source()).toBe(saved);
    expect(e.root.textContent).not.toContain('more than the grid');
    expect(e.root.querySelectorAll('.cell').length).toBeGreaterThan(0);
  }
  // Placing music in the final bar must change the source, not a detached grid.
  const last=e.root.querySelector<HTMLButtonElement>('.cell[data-c="63"]')!;
  expect(last).not.toBeNull();last.click();
  expect(e.source()).not.toBe(saved);
  expect(readPattern(e.source()).lanes[0].events.some(hit=>hit.col/readPattern(e.source()).lanes[0].columns>=.75)).toBe(true);
  e.click('[data-pe="undo"]');expect(e.source()).toBe(saved);
  e.click('[data-pe="bars"][data-n="1"]');expect(e.source()).toBe(initial);
});

it('an existing four-bar pattern keeps its exact source when its grid detail changes',()=>{
  const source=`// keep my spacing\ns("${Array.from({length:64},(_,i)=>i===48?'bd':'~').join(' ')}").slow(4).gain(0.3);`;
  const e=editor(source);
  expect(e.root.textContent).not.toContain('more than the grid');
  e.click('[data-pe="target"][data-n="8"]');e.click('[data-pe="target"][data-n="16"]');
  expect(e.source()).toBe(source);
  expect(e.root.querySelector('.cell[data-token="bd"][data-c="48"]')!.getAttribute('aria-pressed')).toBe('true');
});
