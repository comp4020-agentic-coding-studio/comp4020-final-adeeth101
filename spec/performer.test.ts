import {describe,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {performerSvg,type Look} from '../client/performer.ts';

describe('original performer artwork',()=>{
  it('has a torso, eyes and mouth for every role, including seeds with a high hash bit',()=>{
    const dom=new JSDOM();
    for(const role of ['beats','bass','melody','texture','custom'] as Look[]){
      for(const seed of ['review-0','review-1','review-5','a','part-ffffffff-ffff-ffff-ffff-ffffffffffff']){
        const container=dom.window.document.createElement('div');
        container.innerHTML=performerSvg(role,seed);
        const svg=container.querySelector('svg')!;
        expect(svg.textContent,`${role}/${seed}`).not.toContain('undefined');
        expect(svg.querySelector('.body > :not(.arm):not(circle)'),`${role}/${seed} torso`).not.toBeNull();
        expect(svg.querySelector('.face')!.children.length,`${role}/${seed} face`).toBeGreaterThanOrEqual(2);
      }
    }
    dom.window.close();
  });
});
