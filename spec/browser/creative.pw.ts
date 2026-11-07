// The promises of the creative tools that only a real browser can show: one
// musical truth between grid and code, keyboard use, focus surviving background
// updates, an export that leaves live playback alone, and deletion through the
// interface at both marking viewports.
import {test,expect,type Page,type Browser} from '@playwright/test';

// The stage draws before clock calibration finishes and installs this probe.
const snapshot=async(page:Page)=>{await page.waitForFunction(()=>(window as any).ensembleDebug);return page.evaluate(()=>(window as any).ensembleDebug.snapshot());};
const noSideScroll=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
async function mix(browser:Browser,viewport={width:1920,height:1080},options={}){
  const context=await browser.newContext({viewport,...options}),page=await context.newPage();
  await page.goto('/');await page.getByRole('button',{name:'Start a mix'}).click();await page.waitForURL(/\/p\//);
  await expect(page.locator('#status-line')).toContainText(/hosting|Stopped/);
  return {context,page};
}
const add=(page:Page,name:string)=>page.getByRole('button',{name:new RegExp(`^Add( and play)? ${name}$`)}).click();
const open=async(page:Page,index=0,tab='Pattern')=>{await page.locator('.performer[data-part] .performer-btn').nth(index).click();await page.getByRole('tab',{name:tab}).click();};

test('switching between Pattern, Shape and Code never rewrites the source',async({browser})=>{
  const {context,page}=await mix(browser);
  try{
    await page.getByRole('button',{name:'Add and play Little Question'}).click();await expect(page.locator('.performer[data-part]')).toHaveCount(1);await page.getByRole('button',{name:'Close the cast'}).click();
    const saved='note("[69 72] ~ 76 ~ <74 71> ~ 72 ~").s("sine").room(0.15).gain(0.3)';
    await open(page,0,'Pattern');
    // The locked step is shown and explained, and the rest stays editable.
    await expect(page.locator('.lanes-note')).toContainText('changes each bar');await expect(page.locator('.cell.locked').first()).toBeVisible();
    await page.getByRole('tab',{name:'Code'}).click();await expect(page.locator('#code-editor')).toHaveValue(saved);
    await page.getByRole('tab',{name:'Shape'}).click();await page.getByRole('tab',{name:'Pattern'}).click();await page.getByRole('tab',{name:'Code'}).click();
    await expect(page.locator('#code-editor')).toHaveValue(saved);await expect(page.getByRole('button',{name:'Apply to mix'})).toBeDisabled();
    expect((await snapshot(page)).parts[0].clips.A).toMatchObject({source:saved,revision:1});
  }finally{await context.close();}
});

test('a locked step is refused on the grid, keeps its text through an edit around it, and an explicit copy is separate',async({browser})=>{
  const {context,page}=await mix(browser);
  try{
    await page.getByRole('button',{name:'Add and play Little Question'}).click();await expect(page.locator('.performer[data-part]')).toHaveCount(1);await page.getByRole('button',{name:'Close the cast'}).click();
    await open(page);
    await page.locator('.cell.locked').first().click({force:true});await expect(page.locator('.pe-message')).toContainText('changes each bar');
    await expect(page.locator('#code-error')).toContainText('saved music');
    await page.locator('.cell[data-note="76"][data-c="12"]').click();await expect(page.locator('#code-error')).toContainText('not shared yet');
    await page.getByRole('button',{name:'Apply to mix'}).click();
    await expect.poll(async()=>(await snapshot(page)).parts[0].clips.A.source).toContain('<74 71>');
    const edited=(await snapshot(page)).parts[0].clips.A.source;expect(edited).toContain('.room(0.15).gain(0.3)');expect(edited).not.toBe('note("[69 72] ~ 76 ~ <74 71> ~ 72 ~").s("sine").room(0.15).gain(0.3)');
    await page.getByRole('button',{name:'Make an editable copy'}).click();
    await expect(page.locator('.performer[data-part]')).toHaveCount(2);
    const s=await snapshot(page);expect(s.parts[0].clips.A.source).toBe(edited);expect(s.parts[1].clips.A.source).not.toContain('<');expect(s.parts[1].clips.A.source).toContain('.slow(2)');
  }finally{await context.close();}
});

test('invalid code leaves the last valid music playing, and the grid says why it cannot show the draft',async({browser})=>{
  const {context,page}=await mix(browser);
  try{
    await add(page,'Pocket');await expect(page.locator('.performer[data-part]')).toHaveCount(1);await page.getByRole('button',{name:'Close the cast'}).click();
    await open(page,0,'Code');const saved=(await snapshot(page)).parts[0].clips.A.source;
    await page.locator('#code-editor').fill('s("bd sd"');await expect(page.locator('#code-error')).toHaveClass(/error/);await expect(page.getByRole('button',{name:'Apply to mix'})).toBeDisabled();
    await page.getByRole('tab',{name:'Pattern'}).click();await expect(page.locator('.lanes-note')).toContainText('has a mistake');
    await page.getByRole('button',{name:'Fix it in Code'}).click();await expect(page.locator('#code-editor')).toHaveValue('s("bd sd"');
    expect((await snapshot(page)).parts[0].clips.A.source).toBe(saved);
  }finally{await context.close();}
});

test('a draft made on the grid survives a reload and is the same draft in Code',async({browser})=>{
  const {context,page}=await mix(browser);
  try{
    await add(page,'Pocket');await expect(page.locator('.performer[data-part]')).toHaveCount(1);await page.getByRole('button',{name:'Close the cast'}).click();
    await open(page);await page.getByRole('button',{name:'Kick, step 3 of 16'}).click();await expect(page.locator('#code-error')).toContainText('not shared yet');await page.waitForTimeout(450);
    await page.reload();await open(page,0,'Code');
    await expect(page.locator('#code-editor')).not.toHaveValue((await snapshot(page)).parts[0].clips.A.source);await expect(page.locator('#code-error')).toContainText('not shared yet');
    expect((await snapshot(page)).parts[0].clips.A.revision).toBe(1);
  }finally{await context.close();}
});

test('the grid works by keyboard alone at phone size, and keeps its place through a background update',async({browser})=>{
  const AxeBuilder=(await import('@axe-core/playwright')).default;
  const {context,page}=await mix(browser,{width:390,height:844},{hasTouch:true});
  try{
    await add(page,'Pocket');await expect(page.locator('.performer[data-part]')).toHaveCount(1);await page.getByRole('button',{name:'Close the cast'}).click();
    await page.locator('.performer[data-part] .performer-btn').focus();await page.keyboard.press('Enter');
    await page.getByRole('tab',{name:'Pattern'}).focus();await page.keyboard.press('Enter');
    const first=page.locator('.cell[data-grid="kit"]').first();await first.focus();
    await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');
    await expect(page.locator('.cell[data-r="1"][data-c="2"]')).toBeFocused();
    await page.keyboard.press('Space');await expect(page.locator('#code-error')).toContainText('not shared yet');
    await expect(page.locator('.cell[data-r="1"][data-c="2"]')).toBeFocused();await expect(page.locator('.cell[data-r="1"][data-c="2"]')).toHaveAttribute('aria-pressed','true');
    // Something else changes in the room while a step has focus.
    const id=(await snapshot(page)).id;
    await page.evaluate(async i=>{await fetch(`/api/projects/${i}/commands`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({commandId:crypto.randomUUID(),type:'project.rename',payload:{title:'Renamed elsewhere'}})});},id);
    await expect(page.locator('#room-title')).toHaveText('Renamed elsewhere');
    await expect(page.locator('.cell[data-r="1"][data-c="2"]')).toBeFocused();
    expect(await noSideScroll(page)).toBe(true);
    const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
    expect(r.violations.map(v=>`${v.id}: ${v.nodes.map(n=>n.target.join(' ')).join(', ')}`)).toEqual([]);
    await page.keyboard.press('Escape');await expect(page.locator('#drawer')).toBeHidden();
  }finally{await context.close();}
});

test('the creator, library and sections meet the accessibility checks, with no sideways scroll, at both viewports',async({browser})=>{
  const AxeBuilder=(await import('@axe-core/playwright')).default;
  for(const viewport of [{width:1920,height:1080},{width:390,height:844}]){
    const context=await browser.newContext({viewport}),page=await context.newPage();
    const check=async(where:string)=>{const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();expect(r.violations.map(v=>`${where} ${v.id}: ${v.nodes.map(n=>n.target.join(' ')).join(', ')}`)).toEqual([]);expect(await noSideScroll(page),where).toBe(true);};
    try{
      await page.goto('/characters');await expect(page.getByRole('tab',{name:'Yours'})).toBeVisible();await check('library');
      await page.getByRole('tab',{name:'Factory cast'}).click();await check('factory');
      await page.getByRole('button',{name:'Remix Gatekeeper'}).click();await expect(page.getByRole('tab',{name:'Music'})).toBeVisible();await check('creator');
      await page.getByRole('tab',{name:'Colours'}).click();await check('colours');
      await page.getByRole('tab',{name:'Music'}).click();await check('music');
      await page.getByRole('button',{name:'Strudel code'}).click();await check('code');
      await page.keyboard.press('Escape');await page.getByRole('button',{name:'Close',exact:true}).click({timeout:1000}).catch(()=>{});
      await page.goto('/');await page.getByRole('button',{name:'Start a mix'}).click();await page.waitForURL(/\/p\//);await expect(page.locator('#status-line')).toContainText(/hosting|Stopped/);
      await check('fresh stage');
      await add(page,'Pocket');await add(page,'Anchor');await expect(page.locator('.performer[data-part]')).toHaveCount(2);await page.getByRole('button',{name:'Close the cast'}).click();
      await page.getByRole('button',{name:'Sections'}).click();await page.getByRole('button',{name:'Who plays in Build'}).click();await check('sections');
      await page.getByRole('button',{name:'Export audio'}).first().click();await check('export');await page.getByRole('button',{name:'Close'}).click();
      await page.getByRole('button',{name:'Mix settings'}).click();await check('settings');
    }finally{await context.close();}
  }
});

test('reduced motion keeps reactions as a plain tally with nothing moving',async({browser})=>{
  const {context,page}=await mix(browser,{width:1280,height:800},{reducedMotion:'reduce'}),other=await browser.newContext();
  try{
    await add(page,'Pocket');await expect(page.locator('.performer[data-part]')).toHaveCount(1);await page.getByRole('button',{name:'Close the cast'}).click();
    const s=await snapshot(page),perf=(await page.request.post(`/api/projects/${s.id}/go-live`,{data:{commandId:crypto.randomUUID(),title:'Calm show',visibility:'public'}})).status();expect(perf).toBe(201);
    await expect.poll(async()=>(await snapshot(page)).performance?.id).toBeTruthy();
    const id=(await snapshot(page)).performance.id,before=await page.evaluate(()=>document.activeElement?.tagName);
    await other.request.post(`/api/performances/${id}/react`,{data:{reaction:'heart'}});
    await expect(page.locator('#reaction-tally')).toContainText('❤️ 1');
    expect(await page.locator('#reaction-layer span').count()).toBe(0);
    expect(await page.evaluate(()=>document.activeElement?.tagName)).toBe(before);
    // The show ends: the stage stops showing it.
    await page.request.post(`/api/performances/${id}/end`,{data:{}});await expect(page.locator('#reaction-tally')).toBeHidden();
  }finally{await context.close();await other.close();}
});

test('a burst of reactions stays bounded on the stage',async({browser})=>{
  const {context,page}=await mix(browser);
  try{
    await add(page,'Pocket');await expect(page.locator('.performer[data-part]')).toHaveCount(1);await page.getByRole('button',{name:'Close the cast'}).click();
    const s=await snapshot(page);await page.request.post(`/api/projects/${s.id}/go-live`,{data:{commandId:crypto.randomUUID(),title:'Loud show',visibility:'public'}});
    await expect.poll(async()=>(await snapshot(page)).performance?.id).toBeTruthy();const id=(await snapshot(page)).performance.id;
    const crowd=await Promise.all(Array.from({length:20},()=>browser.newContext()));
    await Promise.all(crowd.flatMap(c=>['clap','fire','heart','wave'].map(reaction=>c.request.post(`/api/performances/${id}/react`,{data:{reaction}}))));
    await expect(page.locator('#reaction-tally')).toContainText('👏 20');
    expect(await page.locator('#reaction-layer span').count()).toBeLessThanOrEqual(10);
    await Promise.all(crowd.map(c=>c.close()));
  }finally{await context.close();}
});

test('exporting leaves live playback, hosting and the shared mix exactly as they were',async({browser})=>{
  const {context,page}=await mix(browser);
  try{
    await add(page,'Pocket');await add(page,'Anchor');await expect(page.locator('.performer[data-part]')).toHaveCount(2);await page.getByRole('button',{name:'Close the cast'}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).ensembleDebug.audio()?.running)).toBe(true);
    const before=await snapshot(page),engine=await page.evaluate(()=>{const a=(window as any).ensembleDebug.audio();(window as any).__context=a.context;return a.stats.scheduled;});
    await page.getByRole('button',{name:'Export audio'}).first().click();await page.locator('#export-bars').fill('2');
    await page.getByRole('button',{name:'Render WAV'}).click();await expect(page.locator('#export-link')).toBeVisible({timeout:30000});
    await expect(page.locator('#export-state')).toContainText(`revision ${before.revision}`);
    const after=await snapshot(page),same=await page.evaluate(()=>{const a=(window as any).ensembleDebug.audio();return {context:a.context===(window as any).__context,running:a.running,state:a.context.state,scheduled:a.stats.scheduled};});
    expect(same).toMatchObject({context:true,running:true,state:'running'});
    await expect.poll(()=>page.evaluate(()=>(window as any).ensembleDebug.audio().stats.scheduled),{timeout:8000}).toBeGreaterThan(engine);
    expect(after.transport).toMatchObject({status:'playing',generation:before.transport.generation,epochMs:before.transport.epochMs,hostId:before.transport.hostId});
    expect(after.revision).toBe(before.revision);
  }finally{await context.close();}
});

test('an export is not offered from the audience, and an empty choice says so',async({browser})=>{
  const {context,page}=await mix(browser),other=await browser.newContext();
  try{
    await page.getByRole('button',{name:'Close the cast'}).click();
    await page.getByRole('button',{name:'Export audio'}).first().click();await page.getByRole('button',{name:'Render WAV'}).click();
    await expect(page.locator('#export-state')).toContainText('Nothing plays');await page.getByRole('button',{name:'Close'}).click();
    await page.getByRole('button',{name:'Cast'}).click();await add(page,'Pocket');await expect(page.locator('.performer[data-part]')).toHaveCount(1);
    const s=await snapshot(page);await page.request.post(`/api/projects/${s.id}/go-live`,{data:{commandId:crypto.randomUUID(),title:'No export',visibility:'public'}});
    await expect.poll(async()=>(await snapshot(page)).performance?.id).toBeTruthy();
    const listener=await other.newPage();await listener.goto(`/live/${(await snapshot(page)).performance.id}`);await expect(listener.locator('#aud-title')).toHaveText('No export');
    await expect(listener.getByRole('button',{name:/Export/})).toHaveCount(0);
    expect((await other.request.get(`/api/projects/${s.id}/export`)).status()).toBe(404);
  }finally{await context.close();await other.close();}
});

test('deleting from the list names the mix, needs its name, can be undone, and a member only ever leaves',async({browser})=>{
  const owner=await browser.newContext({viewport:{width:390,height:844}}),member=await browser.newContext({viewport:{width:1920,height:1080}});
  const a=await owner.newPage(),b=await member.newPage();
  try{
    await a.goto('/');await a.getByRole('button',{name:'Start a mix'}).click();await a.waitForURL(/\/p\//);
    await a.getByRole('button',{name:'Add and play Pocket'}).click();await expect(a.locator('.performer[data-part]')).toHaveCount(1);await a.getByRole('button',{name:'Close the cast'}).click();
    const title=(await snapshot(a)).title;
    await a.getByRole('button',{name:'Invite'}).click();await a.getByRole('button',{name:'Create link'}).click();const link=await a.locator('.link-out').inputValue();await a.keyboard.press('Escape');
    await b.goto(link);await b.getByRole('button',{name:'Join and enable sound'}).click();await b.waitForURL(/\/p\//);
    await b.goto('/');await expect(b.getByRole('button',{name:`Leave ${title}`})).toBeVisible();await expect(b.getByRole('button',{name:`Delete ${title}`})).toHaveCount(0);
    await a.goto('/');await a.getByRole('button',{name:`Delete ${title}`}).click();
    const dialog=a.getByRole('dialog');await expect(dialog).toContainText(title);await expect(dialog).toContainText('invitations and shared links stop working');
    await expect(dialog.getByRole('button',{name:'Delete mix'})).toBeDisabled();
    await dialog.locator('#confirm-typed').fill('wrong');await expect(dialog.getByRole('button',{name:'Delete mix'})).toBeDisabled();
    await dialog.locator('#confirm-typed').fill(title);await dialog.getByRole('button',{name:'Delete mix'}).click();
    await expect(a.getByRole('heading',{name:'Recently deleted'})).toBeVisible();await expect(a.locator('.project-card')).toHaveCount(0);
    await b.reload();await expect(b.locator('.project-card')).toHaveCount(0);
    await a.getByRole('button',{name:`Restore ${title}`}).click();await expect(a.locator('.project-card')).toHaveCount(1);
    await b.reload();await b.getByRole('button',{name:`Leave ${title}`}).click();await b.getByRole('dialog').getByRole('button',{name:'Leave mix'}).click();await expect(b.locator('.project-card')).toHaveCount(0);
    await a.reload();await expect(a.locator('.project-card')).toHaveCount(1);
    expect(await noSideScroll(a)).toBe(true);
  }finally{await owner.close();await member.close();}
});

test('a person in the room is told when the owner deletes the mix, and removed tracks can be deleted for good',async({browser})=>{
  const {context,page}=await mix(browser);
  try{
    await add(page,'Pocket');await add(page,'Anchor');await expect(page.locator('.performer[data-part]')).toHaveCount(2);await page.getByRole('button',{name:'Close the cast'}).click();
    await page.locator('.performer[data-part] .performer-btn').nth(1).click();await page.getByRole('button',{name:'Remove from stage'}).click();await expect(page.locator('.performer[data-part]')).toHaveCount(1);
    await page.getByRole('button',{name:'Mix settings'}).click();await page.getByRole('button',{name:'Delete Anchor for good'}).click();
    await expect(page.getByRole('dialog')).toContainText('can’t be brought back');await page.getByRole('dialog').getByRole('button',{name:'Delete track'}).click();
    await expect.poll(async()=>(await snapshot(page)).parts.length).toBe(1);
    await expect(page.getByRole('button',{name:'Delete Anchor for good'})).toHaveCount(0);
  }finally{await context.close();}
});

test('searching the cast finds characters across packs, and a blank character can be made from the room',async({browser})=>{
  const {context,page}=await mix(browser);
  try{
    expect(await page.locator('.sound-card').count()).toBeLessThanOrEqual(8);
    await page.locator('#cast-search').fill('whale');await expect(page.locator('.sound-card')).toHaveCount(1);await expect(page.locator('.sound-card')).toContainText('Whale Song');await expect(page.locator('#cast-search')).toBeFocused();
    await page.locator('#cast-search').fill('');await page.locator('#pack').selectOption('deep-sea');await expect(page.locator('.sound-card')).toHaveCount(8);
    await page.getByRole('button',{name:'Create character'}).click();await page.getByRole('button',{name:'Beats',exact:true}).last().click();
    await expect(page.getByRole('heading',{name:'Create a character'})).toBeVisible();await page.getByRole('tab',{name:'Music'}).click();
    await page.getByRole('button',{name:'Kick, step 1 of 16'}).click();await page.getByRole('button',{name:'Snare, step 5 of 16'}).click();
    await expect(page.getByRole('button',{name:'Snare, step 5 of 16, on'})).toBeVisible();
    await page.getByRole('button',{name:'Save and add to mix'}).click();
    await expect(page.locator('.performer[data-part]')).toHaveCount(1);
    expect((await snapshot(page)).parts[0].clips.A.source).toMatch(/^s\("bd ~ ~ ~ sd ~/);
  }finally{await context.close();}
});

test('a track’s look changes for this mix only, a track can be saved, and Solo is personal',async({browser})=>{
  const {context,page}=await mix(browser);
  try{
    await add(page,'Pocket');await add(page,'Anchor');await expect(page.locator('.performer[data-part]')).toHaveCount(2);await page.getByRole('button',{name:'Close the cast'}).click();
    await page.locator('.performer[data-part] .performer-btn').first().click();
    await page.getByRole('button',{name:'Change look'}).click();await expect(page.getByRole('tab',{name:'Music'})).toHaveCount(0);
    await page.getByRole('button',{name:'Octopus',exact:true}).click();await page.getByRole('button',{name:'Use this look'}).click();
    await expect(page.locator('.performer[data-part] .figure').first()).toHaveAttribute('data-body','octo');
    expect((await snapshot(page)).parts[0].look.body).toBe('octo');
    await page.getByRole('button',{name:'Save to my characters'}).click();await expect(page.locator('#toast')).toContainText('saved in your characters');
    await page.getByRole('button',{name:'Solo for me'}).click();await expect(page.locator('#status-line')).toContainText('Only you hear');
    const plan=(await snapshot(page)).plans.at(-1);expect(Object.values(plan.mix).every((m:any)=>!m.mute)).toBe(true);
    await page.goto('/characters');await expect(page.getByRole('button',{name:'Edit Pocket'})).toBeVisible();await expect(page.locator('.char-card')).toContainText('remix of Pocket by Ensemble');
  }finally{await context.close();}
});

test('unsaved creator work comes back after a reload, and only for the character it belongs to',async({browser})=>{
  const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();
  try{
    await page.goto('/characters?new=1');await page.getByRole('button',{name:'Bass',exact:true}).click();
    await page.getByRole('button',{name:'Octopus',exact:true}).click();await page.getByRole('tab',{name:'Details'}).click();await page.locator('#creator-name-input').fill('Half finished');await page.waitForTimeout(400);
    await page.reload();await page.getByRole('tab',{name:'Factory cast'}).click();await page.getByRole('button',{name:'Remix Gatekeeper'}).click();
    await expect(page.locator('#creator-name')).toHaveText('Gatekeeper remix');await page.getByRole('button',{name:'Close the creator'}).click();
    await page.getByRole('button',{name:'Create character'}).click();await page.getByRole('dialog').getByRole('button',{name:'Bass',exact:true}).click();
    await expect(page.locator('#creator-name')).toHaveText('Half finished');await expect(page.locator('#creator-preview .figure')).toHaveAttribute('data-body','octo');
  }finally{await context.close();}
});

test('a suggested build-up is shown in words first, and only Use this changes anything',async({browser})=>{
  const {context,page}=await mix(browser);
  try{
    await add(page,'Pocket');await add(page,'Anchor');await add(page,'Sunbeam');await add(page,'Glow');await expect(page.locator('.performer[data-part]')).toHaveCount(4);await page.getByRole('button',{name:'Close the cast'}).click();
    await page.getByRole('button',{name:'Sections'}).click();const before=(await snapshot(page)).settings.arrangement;
    await page.getByRole('button',{name:'Suggest a build-up'}).click();await expect(page.getByRole('dialog')).toContainText('Sunbeam, Glow');
    await page.getByRole('dialog').getByRole('button',{name:'Cancel'}).click();expect((await snapshot(page)).settings.arrangement).toEqual(before);
    await page.getByRole('button',{name:'Suggest a build-up'}).click();await page.getByRole('button',{name:'Use this'}).click();
    await expect.poll(async()=>(await snapshot(page)).settings.arrangement.entries.length).toBe(6);
    await expect(page.locator('.timeline li')).toHaveCount(6);
  }finally{await context.close();}
});
