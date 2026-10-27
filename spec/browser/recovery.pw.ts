// Losing the server mid-edit: the page says so, stops sound on this device,
// keeps the code draft, reconnects when the server returns, and the same
// person can apply it. A server of its own, so killing it leaves the shared
// APP_URL server running for the other flows.
import {test,expect} from '@playwright/test';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('losing the server keeps the draft and stops shared sound; reconnecting restores the room for the same person',async({browser})=>{
  const port=9100+Math.floor(Math.random()*400),base=`http://127.0.0.1:${port}`,dir=mkdtempSync(join(tmpdir(),'pw-restart-'));
  let server:ChildProcess|null=null;
  const boot=async()=>{server=spawn(process.execPath,['src/server.ts'],{env:{...process.env,PORT:String(port),DB_PATH:join(dir,'app.db')},stdio:'ignore'});
    for(let i=0;i<150;i++){try{await fetch(`${base}/healthz`);return;}catch{await new Promise(r=>setTimeout(r,100));}}throw new Error('server did not start');};
  const kill=()=>new Promise<void>(r=>{const s=server!;server=null;s.on('exit',()=>r());s.kill('SIGKILL');});
  await boot();const context=await browser.newContext({baseURL:base,viewport:{width:1920,height:1080}});
  try{
    const page=await context.newPage();await page.goto('/');await page.getByRole('button',{name:'Start a mix'}).click();await page.waitForURL(/\/p\//);
    await page.getByRole('button',{name:'Add and play Pocket'}).click();await expect(page.locator('.performer[data-part]')).toHaveCount(1);
    await expect.poll(()=>page.evaluate(()=>(window as any).ensembleDebug.audio()?.running)).toBe(true);
    await page.locator('.performer[data-part] .performer-btn').click();await page.getByRole('tab',{name:'Code'}).click();
    await page.locator('#code-editor').fill('s("bd ~ sd [~ bd]")');await page.waitForTimeout(400);
    await kill();
    await expect(page.locator('#status-line')).toContainText(/Reconnecting|Connection lost/,{timeout:15000});
    await expect.poll(()=>page.evaluate(()=>(window as any).ensembleDebug.audio()?.running),{timeout:15000}).toBe(false);
    await expect(page.getByRole('button',{name:'Apply to mix'})).toBeDisabled({timeout:6000});
    await expect(page.locator('#code-editor')).toHaveValue('s("bd ~ sd [~ bd]")');
    await boot();
    // A restart stopped the shared mix and released the host; the draft is still here.
    await expect(page.getByRole('button',{name:'Apply to mix'})).toBeEnabled({timeout:20000});
    await expect(page.locator('#play')).toHaveText('▶ Play');
    await page.getByRole('button',{name:'Apply to mix'}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).ensembleDebug.snapshot().parts[0].clips.A.source)).toBe('s("bd ~ sd [~ bd]")');
    // A reload restores the same saved mix for the same person, and their local draft store is empty again.
    await page.reload();await expect(page.locator('.performer[data-part]')).toHaveCount(1);
    // The stage renders before clock calibration finishes and installs the
    // debug probe. Wait for that startup step rather than racing the reload.
    await expect.poll(()=>page.evaluate(()=>(window as any).ensembleDebug?.snapshot().you.role)).toBe('owner');
  }finally{await context.close();if(server)await kill();for(let i=0;i<20;i++){try{rmSync(dir,{recursive:true,force:true});break;}catch{await new Promise(r=>setTimeout(r,100));}}}
});

test('a code draft survives a reload before it is applied',async({browser})=>{
  const ctx=await browser.newContext();const page=await ctx.newPage();
  await page.goto('/');await page.getByRole('button',{name:'Start a mix'}).click();await page.waitForURL(/\/p\//);
  await page.getByRole('button',{name:'Add and play Pocket'}).click();await expect(page.locator('.performer[data-part]')).toHaveCount(1);
  await page.locator('.performer[data-part] .performer-btn').click();await page.getByRole('tab',{name:'Code'}).click();
  await page.locator('#code-editor').fill('s("bd sd bd sd").room(0.3)');await page.waitForTimeout(500);
  await page.reload();await page.locator('.performer[data-part] .performer-btn').click();await page.getByRole('tab',{name:'Code'}).click();
  await expect(page.locator('#code-editor')).toHaveValue('s("bd sd bd sd").room(0.3)');await expect(page.locator('#code-error')).toContainText('not shared yet');
  expect((await page.evaluate(()=>(window as any).ensembleDebug.snapshot())).parts[0].clips.A.revision).toBe(1);
  await ctx.close();
});

test('reduced motion stops the stage moving and still says what is playing',async({browser})=>{
  const ctx=await browser.newContext({reducedMotion:'reduce',viewport:{width:1280,height:800}});
  const page=await ctx.newPage();
  await page.goto('/');await page.getByRole('button',{name:'Start a mix'}).click();await page.waitForURL(/\/p\//);
  await page.getByRole('button',{name:/Add and play/}).first().click();
  await expect(page.locator('.performer[data-part]')).toHaveCount(1);
  await page.waitForTimeout(2000);
  const motion=await page.evaluate(()=>{
    const figure=document.querySelector('.performer[data-part] .figure')!;
    const s=getComputedStyle(figure);
    return {animation:s.animationName,transition:s.transitionDuration};
  });
  expect(motion).toEqual({animation:'none',transition:'0s'});
  // The state is still named in words, not only by movement.
  await expect(page.locator('.performer[data-part] .state-tag')).toHaveText(/Playing|Ready|Joining/);
  await ctx.close();
});

test('a slow connection still gets a newcomer to sound, and a double Apply saves once',async({browser})=>{
  const ctx=await browser.newContext({viewport:{width:1280,height:800}});
  const page=await ctx.newPage();
  // About a slow 3G link: 400 kbit down, 300 ms each way.
  const cdp=await ctx.newCDPSession(page);await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:50*1024,uploadThroughput:25*1024});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Start a mix'}).click();
  await expect(page.locator('#status-line')).toContainText(/hosting|playing|Stopped/,{timeout:60000});
  await page.getByRole('button',{name:/Add and play/}).first().click({timeout:60000});
  await expect(page.locator('.performer[data-part]')).toHaveCount(1,{timeout:60000});
  await page.getByRole('button',{name:'Close the sound tray'}).click();
  await page.locator('.performer[data-part] .performer-btn').click();
  await page.getByRole('tab',{name:'Code'}).click();
  await page.locator('#code-editor').fill('s("bd sd")');
  await expect(page.locator('#code-error')).toContainText('not shared yet');
  // Two Applies on a laggy link must leave one part at one new revision.
  const apply=page.getByRole('button',{name:'Apply to mix'});
  await apply.click();
  await apply.click({timeout:2000}).catch(()=>{});
  await expect.poll(()=>page.evaluate(()=>(window as any).ensembleDebug.snapshot().parts[0].clips.A.source),{timeout:60000}).toBe('s("bd sd")');
  const after=await page.evaluate(()=>{const s=(window as any).ensembleDebug.snapshot();return {parts:s.parts.filter((p:any)=>!p.archivedAt).length,revision:s.parts[0].clips.A.revision};});
  expect(after).toEqual({parts:1,revision:2});
  await ctx.close();
});
