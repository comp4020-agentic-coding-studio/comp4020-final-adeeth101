import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function newPiece(page:Page,title:string){
  await page.goto('/');await page.getByLabel('Name your piece').fill(title);
  await page.getByRole('button',{name:/Create a piece/}).click();await page.waitForURL(/\/p\/.*\/compose/);
  return page.url();
}
const snapshot=(page:Page)=>page.evaluate(()=>(window as any).streamDebug.snapshot());
const noSideScroll=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

test('a stale draft is kept and the owner chooses how to resolve the conflict',async({browser})=>{
  const context=await browser.newContext({viewport:{width:1920,height:1080}});
  const a=await context.newPage();const url=await newPiece(a,'Conflict proof');
  await a.getByRole('button',{name:'+ Drums',exact:true}).click();await a.getByRole('button',{name:'Apply to piece'}).click();await expect(a.locator('#draft-status')).toContainText('Saved');
  // A second tab of the same person edits the same clip from the same revision.
  const b=await context.newPage();await b.goto(url);await b.getByRole('button',{name:'Snare step 5',exact:true}).click();
  await a.getByRole('button',{name:'Kick step 1',exact:true}).click();await a.getByRole('button',{name:'Apply to piece'}).click();await expect(a.locator('#draft-status')).toContainText('Saved');
  await expect(b.locator('#draft-status')).toContainText('Saved version changed');
  await expect(b.getByRole('button',{name:'Apply to piece'})).toBeDisabled();
  await expect(b.getByRole('alert')).toContainText('Someone saved this clip');
  await expect(b.getByRole('button',{name:'Snare step 5',exact:true})).toHaveAttribute('aria-pressed','true');
  // Save as another clip moves the draft to an empty slot and publishes it there.
  await b.getByRole('button',{name:'Save as another clip'}).click();await expect(b.locator('#slot-B')).toHaveAttribute('aria-pressed','true');
  await b.getByRole('button',{name:'Apply to piece'}).click();await expect(b.locator('#draft-status')).toContainText('Saved');
  let s=await snapshot(b);expect(s.tracks[0].clips.B.document.root.children[1].steps[4]).toBe('sd');expect(s.tracks[0].clips.A.document.root.children[0].steps[0]).toBe('bd');
  // Keep my draft rebases onto the newer revision, then overwrites it explicitly.
  await b.locator('#slot-A').click();await b.getByRole('button',{name:'Hi-hat step 3',exact:true}).click();
  await a.getByRole('button',{name:'Clap step 2',exact:true}).click();await a.getByRole('button',{name:'Apply to piece'}).click();await expect(a.locator('#draft-status')).toContainText('Saved');
  await expect(b.getByRole('alert')).toBeVisible();await b.getByRole('button',{name:'Keep my draft'}).click();
  await b.getByRole('button',{name:'Apply to piece'}).click();await expect(b.locator('#draft-status')).toContainText('Saved');
  s=await snapshot(b);const kit=s.tracks[0].clips.A.document.root.children;expect(kit[2].steps[2]).toBe('hh');expect(kit[3].steps[1]).toBe(null);
  expect(s.tracks[0].clips.A.revision).toBe(5);
  // Load saved asks first, and Undo brings the discarded draft back.
  await b.getByRole('button',{name:'Kick step 7',exact:true}).click();
  b.once('dialog',d=>void d.accept());await b.getByRole('button',{name:'Load saved'}).click();
  await expect(b.getByRole('button',{name:'Kick step 7',exact:true})).toHaveAttribute('aria-pressed','false');
  await b.getByRole('button',{name:'Undo',exact:true}).click();await expect(b.getByRole('button',{name:'Kick step 7',exact:true})).toHaveAttribute('aria-pressed','true');
  await context.close();
});

test('compose and perform work from the keyboard at phone size without sideways scrolling',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});const page=await context.newPage();
  await page.goto('/');await page.getByLabel('Name your piece').focus();await page.keyboard.press('Control+A');await page.keyboard.type('Keyboard piece');await page.keyboard.press('Enter');
  await page.waitForURL(/\/compose/);
  await page.getByRole('button',{name:'+ Drums',exact:true}).focus();await page.keyboard.press('Enter');
  const kick=page.getByRole('button',{name:'Kick step 1',exact:true});await kick.focus();await page.keyboard.press('Space');await expect(kick).toHaveAttribute('aria-pressed','true');
  // The form editor is the non-drag route through Blocks.
  await page.locator('#mode-blocks').focus();await page.keyboard.press('Enter');
  await page.locator('#effect-op').selectOption('slow');await page.locator('#add-effect').focus();await page.keyboard.press('Enter');
  await expect(page.locator('.block-form legend').first()).toHaveText('slow');
  await page.locator('#mode-code').focus();await page.keyboard.press('Enter');await expect(page.locator('#clip-code')).toHaveValue(/\.slow\(2\)$/);
  await page.locator('#track-name').fill('Kit on a phone');await page.locator('#track-name').press('Enter');await expect(page.locator('#track-list')).toContainText('Kit on a phone');
  await page.locator('#apply').focus();await page.keyboard.press('Enter');await expect(page.locator('#draft-status')).toContainText('Saved');
  expect(await noSideScroll(page)).toBe(true);
  const compose=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).disableRules(['color-contrast']).exclude('#block-workspace').analyze();
  expect(compose.violations.map(v=>`${v.id}: ${v.nodes.length}`)).toEqual([]);
  await page.getByRole('link',{name:'Perform',exact:true}).click();await page.waitForURL(/\/perform/);
  const claim=page.getByRole('button',{name:'Take conductor role'});await claim.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'Release podium'})).toBeVisible();
  const scene=page.locator('[data-scene="C"]');await scene.focus();await page.keyboard.press('Enter');
  await expect.poll(async()=>(await snapshot(page)).plans.at(-1).scene).toBe('C');
  expect(await noSideScroll(page)).toBe(true);
  const perform=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).disableRules(['color-contrast']).analyze();
  expect(perform.violations.map(v=>`${v.id}: ${v.nodes.length}`)).toEqual([]);
  await context.close();
});

test('solo stays on this device while the shared mix is unchanged',async({browser})=>{
  const context=await browser.newContext({viewport:{width:1920,height:1080}});const page=await context.newPage();
  const url=await newPiece(page,'Solo proof');await page.getByRole('button',{name:'+ Drums',exact:true}).click();await page.getByRole('button',{name:'Apply to piece'}).click();
  await page.goto(url.replace('/compose','/perform'));await expect(page.getByRole('button',{name:'Solo here'})).toBeVisible();const before=(await snapshot(page)).plans.at(-1).mix;
  const solo=page.getByRole('button',{name:'Solo here'});await solo.click();
  await expect(page.getByRole('button',{name:'Unsolo'})).toHaveAttribute('aria-pressed','true');
  await page.reload();await expect(page.getByRole('button',{name:'Solo here'})).toBeVisible();expect((await snapshot(page)).plans.at(-1).mix).toEqual(before);
  await context.close();
});

async function compose(context:BrowserContext,url:string){const p=await context.newPage();await p.goto(url);await expect(p.locator('#live-status')).not.toHaveText('Connecting…');return p;}
test('a refused live stream falls back to polling and still publishes',async({browser})=>{
  const context=await browser.newContext();const first=await context.newPage();const url=await newPiece(first,'Capacity proof');
  await first.getByRole('button',{name:'+ Melody',exact:true}).click();await expect(first.locator('#live-status')).toHaveText('● Live together');
  // Two streams per person and piece; the third tab polls instead.
  const second=await compose(context,url),third=await compose(context,url);
  await expect(second.locator('#live-status')).toHaveText('● Live together');
  await expect(third.locator('#live-status')).toContainText('Live updates busy');
  await third.getByRole('button',{name:/C4 step 1$/}).click();await expect(third.getByRole('button',{name:'Apply to piece'})).toBeEnabled();
  await third.getByRole('button',{name:'Apply to piece'}).click();await expect(third.locator('#draft-status')).toContainText('Saved');
  await expect.poll(async()=>(await snapshot(first)).tracks[0].clips.A.revision).toBe(2);
  await third.close();await second.close();
  await context.close();
});

// A server of our own, so the test can kill it: the shared APP_URL server (or
// container) must keep running for the other flows.
test('losing the server keeps the draft, refuses to publish, and recovers after a restart',async({browser})=>{
  const port=9100+Math.floor(Math.random()*400),base=`http://127.0.0.1:${port}`,dir=mkdtempSync(join(tmpdir(),'pw-restart-'));
  let server:ChildProcess|null=null;
  const boot=async()=>{server=spawn(process.execPath,['src/server.ts'],{env:{...process.env,PORT:String(port),DB_PATH:join(dir,'app.db')},stdio:'ignore'});
    for(let i=0;i<150;i++){try{await fetch(`${base}/healthz`);return;}catch{await new Promise(r=>setTimeout(r,100));}}throw new Error('server did not start');};
  const kill=()=>new Promise<void>(r=>{const s=server!;server=null;s.on('exit',()=>r());s.kill('SIGKILL');});
  await boot();const context=await browser.newContext({baseURL:base});
  try{
    const page=await context.newPage();await newPiece(page,'Restart proof');
    await page.getByRole('button',{name:'+ Melody',exact:true}).click();await page.getByRole('button',{name:'Apply to piece'}).click();await expect(page.locator('#draft-status')).toContainText('Saved');
    await page.getByRole('button',{name:/E4 step 2$/}).click();
    await kill();
    await expect(page.locator('#live-status')).toHaveText('○ Reconnecting');
    await expect(page.getByRole('button',{name:'Apply to piece'})).toBeDisabled({timeout:6000});
    await expect(page.locator('#draft-status')).toContainText('Draft');
    await boot();
    await expect(page.locator('#live-status')).toHaveText('● Live together',{timeout:15000});
    await expect(page.getByRole('button',{name:/E4 step 2$/})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'Apply to piece'}).click();await expect(page.locator('#draft-status')).toContainText('Saved');
    // The reload path restores the same saved piece for the same identity.
    await page.reload();await expect(page.getByRole('button',{name:/E4 step 2$/})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.editor-head .eyebrow')).toHaveText('YOUR TRACK');
  }finally{await context.close();if(server)await kill();rmSync(dir,{recursive:true,force:true});}
});
