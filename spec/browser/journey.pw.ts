// The whole creative journey in three separate browsers, on a server of its own so
// it can be restarted at the end: create a character from nothing, draw it, write
// its music on the grid and in code, save it, share it, bring independent copies
// into a shared mix, resolve a conflict, perform to a stranger, feel their
// reactions, run a sequence, export real audio, remove a listing, and find
// everything still there after a restart.
import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const snapshot=(page:Page)=>page.evaluate(()=>(window as any).ensembleDebug.snapshot());
const creator=(page:Page)=>page.evaluate(()=>(window as any).ensembleCreator.state());
const cell=(page:Page,note:number,col:number)=>page.locator(`.cell[data-note="${note}"][data-c="${col}"]`);
// The canonical WAV reader for these checks: fmt and data, then the sample level.
function readWav(path:string){
  const b=readFileSync(path),data=b.subarray(44);let peak=0,sum=0;const n=data.length/2;
  for(let i=0;i<n;i++){const v=Math.abs(data.readInt16LE(i*2))/32768;if(v>peak)peak=v;sum+=v*v;}
  return {riff:b.toString('latin1',0,4),wave:b.toString('latin1',8,12),channels:b.readUInt16LE(22),rate:b.readUInt32LE(24),bits:b.readUInt16LE(34),seconds:n/2/b.readUInt32LE(24),peak,rms:Math.sqrt(sum/n)};
}

test('create, share, collaborate, perform, react, arrange, export, unlist, restart',async({browser})=>{
  test.setTimeout(150000);
  const port=9600+Math.floor(Math.random()*300),base=`http://127.0.0.1:${port}`,dir=mkdtempSync(join(tmpdir(),'pw-journey-'));
  let server:ChildProcess|null=null;
  const boot=async()=>{server=spawn(process.execPath,['src/server.ts'],{env:{...process.env,PORT:String(port),DB_PATH:join(dir,'app.db')},stdio:'ignore'});
    for(let i=0;i<150;i++){try{await fetch(`${base}/healthz`);return;}catch{await new Promise(r=>setTimeout(r,100));}}throw new Error('server did not start');};
  const kill=()=>new Promise<void>(r=>{const s=server!;server=null;s.on('exit',()=>r());s.kill('SIGKILL');});
  await boot();
  const errors:string[]=[];
  const open=async(width:number,height:number,name:string)=>{const context=await browser.newContext({baseURL:base,viewport:{width,height},acceptDownloads:true});const page=await context.newPage();page.on('pageerror',e=>errors.push(`${name}: ${e.message}`));return {context,page};};
  const {context:makerCtx,page:maker}=await open(1920,1080,'maker'),{context:friendCtx,page:friend}=await open(390,844,'friend'),{context:thirdCtx,page:third}=await open(1920,1080,'third');
  try{
    // 1. Create a character from scratch.
    await maker.goto('/characters');await maker.getByRole('button',{name:'Create character'}).click();
    await expect(maker.getByRole('dialog')).toContainText('Start blank');
    await maker.getByRole('button',{name:'Melody',exact:true}).click();
    await expect(maker.getByRole('heading',{name:'Create a character'})).toBeVisible();
    // 2. Design its appearance: every choice must visibly change the drawing.
    const preview=maker.locator('#creator-preview');
    const before=await preview.innerHTML();
    await maker.getByRole('button',{name:'Robot',exact:true}).click();await expect(preview.locator('.figure')).toHaveAttribute('data-body','robot');
    await maker.getByRole('tab',{name:'Face'}).click();await maker.getByRole('button',{name:'Sparkle',exact:true}).click();await maker.getByRole('button',{name:'Singing',exact:true}).click();
    await maker.getByRole('tab',{name:'Headwear'}).click();await maker.getByRole('button',{name:'Crown',exact:true}).click();
    await maker.getByRole('tab',{name:'Clothes'}).click();await maker.getByRole('button',{name:'Stripes',exact:true}).click();
    await maker.getByRole('tab',{name:'Props'}).click();await maker.getByRole('button',{name:'Keytar',exact:true}).click();
    await maker.getByRole('tab',{name:'Colours'}).click();await maker.getByRole('group',{name:'Skin'}).getByRole('button',{name:'Mint'}).click();
    expect(await preview.innerHTML()).not.toBe(before);
    expect(await creator(maker)).toMatchObject({look:{body:'robot',eyes:'sparkle',mouth:'sing',top:'crown',wear:'stripes',prop:'keytar',skin:'mint'}});
    await maker.getByRole('tab',{name:'Details'}).click();await maker.locator('#creator-name-input').fill('Journey Bot');
    // 3. Make its melody on the grid, without typing code.
    await maker.getByRole('tab',{name:'Music'}).click();
    await cell(maker,57,0).click();await cell(maker,60,4).click();await cell(maker,64,8).click();
    await expect(cell(maker,60,4)).toHaveAttribute('aria-pressed','true');
    const grid=(await creator(maker)).source as string;
    expect(grid).toMatch(/^note\("a3 ~ ~ ~ c4 ~ ~ ~ e4 ~ ~ ~ ~ ~ ~ ~"\)\.s\("triangle"\)$/);
    // 4. Inspect and edit the same music as Strudel code, then see it on the grid.
    await maker.getByRole('button',{name:'Strudel code'}).click();
    const code=maker.locator('#creator-code');await expect(code).toHaveValue(grid);
    await code.fill('note("a3 ~ ~ ~ c4 ~ ~ ~ e4 ~ ~ ~ g4 ~ ~ ~").s("triangle").room(0.2)');
    await maker.getByRole('button',{name:'Steps'}).click();await expect(cell(maker,67,12)).toHaveAttribute('aria-pressed','true');
    expect((await creator(maker)).source).toBe('note("a3 ~ ~ ~ c4 ~ ~ ~ e4 ~ ~ ~ g4 ~ ~ ~").s("triangle").room(0.2)');
    // 5. Save it, reload, and find it unchanged.
    await maker.getByRole('button',{name:'Save character'}).click();await expect(maker.locator('#creator-foot')).toContainText('Saved.');
    await maker.getByRole('button',{name:'Close the creator'}).click();
    await maker.reload();await expect(maker.getByRole('button',{name:'Edit Journey Bot'})).toBeVisible();
    await maker.screenshot({path:'.playwright/library-desktop.png'});
    await maker.getByRole('button',{name:'Edit Journey Bot'}).click();await expect(maker.getByRole('heading',{name:'Edit Journey Bot'})).toBeVisible();
    expect(await creator(maker)).toMatchObject({name:'Journey Bot',source:'note("a3 ~ ~ ~ c4 ~ ~ ~ e4 ~ ~ ~ g4 ~ ~ ~").s("triangle").room(0.2)',look:{body:'robot',skin:'mint'}});
    await maker.getByRole('button',{name:'Close the creator'}).click();
    // 6. Share it with another identity, who previews it and saves their own copy.
    await maker.getByRole('button',{name:'Share Journey Bot'}).click();
    await expect(maker.getByRole('dialog')).toContainText('Strudel code');await expect(maker.getByRole('dialog')).toContainText('any mix it was used in');
    await maker.getByRole('checkbox').check();await maker.getByRole('button',{name:'Share',exact:true}).click();
    const link=await maker.locator('#share-link').inputValue();await maker.getByRole('button',{name:'Close'}).click();
    await friend.goto(link);await expect(friend.getByRole('heading',{level:1})).toHaveText('Journey Bot');
    expect(friend.url()).not.toContain('share=');
    await expect(friend.locator('pre.source')).toContainText('g4');
    await friend.getByRole('button',{name:'Save a copy'}).click();await friend.waitForURL('**/characters');
    await expect(friend.getByRole('button',{name:'Edit Journey Bot remix'})).toBeVisible();
    await expect(friend.locator('.char-card')).toContainText('remix of Journey Bot');
    // 7. Bring independent copies into one collaborative mix.
    await maker.goto('/');await maker.getByRole('button',{name:'Start a mix'}).click();await maker.waitForURL(/\/p\//);
    await maker.locator('#pack').selectOption('mine');await maker.getByRole('button',{name:/^Add( and play)? Journey Bot$/}).click();
    await expect(maker.locator('.performer[data-part]')).toHaveCount(1);
    await expect(maker.locator('.performer[data-part] .figure')).toHaveAttribute('data-body','robot');
    await maker.getByRole('button',{name:'Close the cast'}).click();
    await maker.getByRole('button',{name:'Invite'}).click();await maker.getByRole('button',{name:'Create link'}).click();
    const invite=await maker.locator('.link-out').inputValue();await maker.keyboard.press('Escape');
    await friend.goto(invite);await friend.getByRole('button',{name:'Join and enable sound'}).click();await friend.waitForURL(/\/p\//);
    await friend.getByRole('button',{name:'Cast',exact:true}).click();await friend.locator('#pack').selectOption('mine');
    await friend.getByRole('button',{name:'Add Journey Bot remix'}).click();
    await expect(maker.locator('.performer[data-part]')).toHaveCount(2);
    await friend.getByRole('button',{name:'Close the cast'}).click();
    const parts=(await snapshot(maker)).parts;expect(parts.map((p:any)=>p.clips.A.source)).toEqual([parts[0].clips.A.source,parts[0].clips.A.source]);
    // 8. Edit concurrently and resolve a conflict: a stale grid draft is refused
    // by the server, kept, and resolved by the person holding it.
    const mine=parts[1],second=await friendCtx.newPage();await second.goto(friend.url());
    await second.locator(`[data-part="${mine.id}"] .performer-btn`).click();await second.getByRole('tab',{name:'Pattern'}).click();
    await second.locator('.cell[data-note="69"][data-c="2"]').click();
    await expect(second.locator('#code-error')).toContainText('not shared yet');
    await friend.locator(`[data-part="${mine.id}"] .performer-btn`).click();await friend.getByRole('tab',{name:'Code'}).click();
    await friend.locator('#code-editor').fill('note("a3 ~ c4 ~").s("sine")');await friend.getByRole('button',{name:'Apply to mix'}).click();
    await expect.poll(async()=>(await snapshot(maker)).parts[1].clips.A.source).toBe('note("a3 ~ c4 ~").s("sine")');
    await expect(second.getByRole('alert')).toContainText('Someone saved this track');await expect(second.getByRole('button',{name:'Apply to mix'})).toBeDisabled();
    await second.getByRole('button',{name:'Keep my draft'}).click();await second.getByRole('button',{name:'Apply to mix'}).click();
    await expect.poll(async()=>(await snapshot(maker)).parts[1].clips.A.source).toContain('a3 ~ a4 ~ c4');
    expect((await snapshot(maker)).parts[0].clips.A.source).toContain('g4');
    await second.close();await friend.keyboard.press('Escape');
    // 9. Perform to a third identity.
    await maker.getByRole('button',{name:'Go live'}).click();await maker.locator('input[name="visibility"][value="public"]').check();
    await maker.getByRole('dialog').getByRole('button',{name:'Go live'}).click();await expect(maker.getByRole('dialog')).toContainText('Public: anyone can find it');await maker.keyboard.press('Escape');
    const perf=(await snapshot(maker)).performance;await third.goto(`/live/${perf.id}`);await expect(third.locator('#aud-title')).toHaveText(perf.title);
    await third.getByRole('button',{name:'▶ Listen'}).click();
    expect((await third.request.get(`/api/projects/${(await snapshot(maker)).id}`)).status()).toBe(404);
    // 10. The performers see the audience's reactions.
    await third.getByRole('button',{name:'React clap'}).click();await third.getByRole('button',{name:'React fire'}).click();
    await expect(maker.locator('#reaction-tally')).toContainText('👏 1');await expect(maker.locator('#reaction-tally')).toContainText('🔥 1');
    await expect(friend.locator('#reaction-tally')).toContainText('👏 1');
    await maker.screenshot({path:'.playwright/reactions-desktop.png'});
    // 11. Run an arrangement: the friend's character sits out section B.
    await maker.getByRole('button',{name:'Sections'}).click();
    await maker.getByRole('button',{name:'Who plays in Build'}).click();
    await maker.getByRole('button',{name:'Journey Bot remix plays in Build'}).click();
    await expect(maker.getByRole('button',{name:'Journey Bot remix is silent in Build'})).toBeVisible();
    await maker.getByRole('button',{name:'Run sequence'}).click();
    await expect(maker.locator('#now-next')).toContainText(/Sounding|Stopped/);
    await expect.poll(async()=>(await snapshot(maker)).plans.at(-1).arrangement?.entries.length,{timeout:8000}).toBe(4);
    await expect(maker.getByRole('button',{name:'Stop sequence'})).toBeVisible();
    await expect.poll(async()=>(await (await third.request.get(`/api/performances/${perf.id}`)).json()).plans.at(-1).arrangement?.entries.length).toBe(4);
    // 12. Export playable audio.
    await maker.getByRole('button',{name:'Export audio'}).first().click();
    await maker.locator('#export-bars').fill('4');await maker.getByRole('button',{name:'Render WAV'}).click();
    const [download]=await Promise.all([maker.waitForEvent('download',{timeout:30000}),maker.locator('#export-link').click({timeout:30000})]);
    const file=join(dir,'export.wav');await download.saveAs(file);
    expect(download.suggestedFilename()).toMatch(/^ensemble-.+-intro-\d+bpm\.wav$/);
    const wav=readWav(file);
    expect(wav).toMatchObject({riff:'RIFF',wave:'WAVE',channels:2,rate:44100,bits:16});expect(wav.seconds).toBeCloseTo(4*240/100+2,1);expect(wav.peak).toBeGreaterThan(0.01);expect(wav.peak).toBeLessThan(1);expect(wav.rms).toBeGreaterThan(0.001);
    await maker.getByRole('button',{name:'Close'}).click();
    // 13. Remove a listing without destroying anyone else's saved copy.
    await maker.goto('/characters');await maker.getByRole('button',{name:'Share Journey Bot'}).click();await maker.getByRole('button',{name:'Stop sharing'}).click();
    await expect(friend.request.get(link.replace(/#.*/,'').replace('/c/','/api/characters/')).then(r=>r.status())).resolves.toBe(404);
    await maker.getByRole('button',{name:'Delete Journey Bot'}).click();await expect(maker.getByRole('dialog')).toContainText('keep their own copy');await maker.getByRole('dialog').getByRole('button',{name:'Delete character'}).click();
    await expect(maker.getByRole('button',{name:'Edit Journey Bot'})).toHaveCount(0);
    await friend.goto('/characters');await expect(friend.getByRole('button',{name:'Edit Journey Bot remix'})).toBeVisible();
    // 14. Restart the server: saved work survives; sound and the show do not.
    await kill();await boot();
    await friend.reload();await expect(friend.getByRole('button',{name:'Edit Journey Bot remix'})).toBeVisible();
    await maker.goto('/');await maker.locator('.project-card').first().click();await maker.waitForURL(/\/p\//);
    await expect(maker.locator('.performer[data-part]')).toHaveCount(2);await expect(maker.locator('.performer[data-part] .figure').first()).toHaveAttribute('data-body','robot');
    await expect.poll(async()=>(await snapshot(maker)).transport.status).toBe('stopped');
    expect((await snapshot(maker)).parts[0].clips.A.source).toContain('g4');expect((await snapshot(maker)).settings.arrangement.entries).toHaveLength(4);
    expect(errors).toEqual([]);
  }finally{await makerCtx.close();await friendCtx.close();await thirdCtx.close();if(server)await kill();for(let i=0;i<20;i++){try{rmSync(dir,{recursive:true,force:true});break;}catch{await new Promise(r=>setTimeout(r,100));}}}
});
