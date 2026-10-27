// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {GuestEditor} from '../client/guest-editor.ts';
import {readCode} from '../client/drafts.ts';
import type {CodeDraft} from '../client/drafts.ts';
vi.mock('../client/drafts.ts',()=>({
  codeKey:(_v:string,_p:string,id:string)=>id,
  readCode:vi.fn(),writeCode:vi.fn().mockResolvedValue(undefined),deleteCode:vi.fn().mockResolvedValue(undefined),
}));
it('a late draft read cannot overwrite the other performer the guest has just opened',async()=>{
  const dialog=document.createElement('dialog');document.body.append(dialog);
  dialog.showModal=()=>{dialog.setAttribute('open','');};
  let finishA!:(draft:CodeDraft)=>void;
  vi.mocked(readCode).mockImplementation(key=>key==='a'?new Promise(resolve=>{finishA=resolve;}):Promise.resolve(undefined));
  const editor=new GuestEditor(dialog,'guest','performance',{preview:async()=>{},stopPreview:()=>{},changed:async()=>{}});
  editor.update([
    {id:'a',name:'First part',role:'beats',presetId:null,source:'s("bd")',revision:1},
    {id:'b',name:'Second part',role:'beats',presetId:null,source:'s("hh")',revision:1},
  ],true,'');
  const first=editor.open('a');await vi.waitFor(()=>expect(readCode).toHaveBeenCalledWith('a'));
  await editor.open('b');
  finishA({source:'s("cp")',baseSource:'s("bd")',baseRevision:1,savedAt:Date.now()});await first;
  expect(dialog.querySelector('h2')!.textContent).toBe('Second part');
  expect(dialog.querySelector<HTMLTextAreaElement>('#guest-code')!.value).toBe('s("hh")');
  dialog.remove();
});
