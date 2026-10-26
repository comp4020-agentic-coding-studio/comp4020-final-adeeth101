// The whole journey in real browsers against production assets: start a mix,
// add presets, invite a friend, customise together (including code), save and
// reopen, go live, a third person listens and chats, end without losing the
// project. Three separate browser contexts are three people.
import {test,expect,type Page,type BrowserContext} from '@playwright/test';

const snapshot=(page:Page)=>page.evaluate(()=>(window as any).ensembleDebug.snapshot());
const traces=(page:Page)=>page.evaluate(()=>((window as any).ensembleDebug.audio()?.trace.length??0) as number);
const noSideScroll=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
function watch(page:Page,errors:string[],name:string){page.on('pageerror',e=>errors.push(`${name}: ${e.message}`));}

test('start, invite, edit together with code, reopen, go live, listen, chat and end',async({browser})=>{
  const errors:string[]=[];
  const desk=await browser.newContext({viewport:{width:1920,height:1080}}),phone=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),third=await browser.newContext({viewport:{width:390,height:844}});
  const a=await desk.newPage(),b=await phone.newPage(),c=await third.newPage();watch(a,errors,'A');watch(b,errors,'B');watch(c,errors,'C');
  await a.goto('/');await expect(a.getByRole('heading',{name:'Make a mix with friends.'})).toBeVisible();
  await expect(a.getByText('No mixes yet.')).toBeVisible();
  await a.getByRole('button',{name:'Start a mix'}).click();await a.waitForURL(/\/p\/[0-9a-f-]+$/);
  // A fresh mix: empty stage, tray open, no sound until a gesture.
  await expect(a.getByRole('button',{name:'Add your first performer'})).toBeVisible();
  await expect(a.locator('#tray')).toBeVisible();await expect(a.locator('#privacy')).toHaveText('Private');
  expect(await a.locator('.sound-card').count()).toBeLessThanOrEqual(8);
  const first=a.getByRole('button',{name:'Add and play Pocket'});await first.click();
  await expect(a.locator('.performer[data-part]')).toHaveCount(1);await expect(a.locator('#status-line')).toContainText('Pocket added');
  await expect.poll(()=>traces(a)).toBeGreaterThan(0);
  await a.getByRole('button',{name:'Bass',exact:true}).click();await a.getByRole('button',{name:'Add Anchor'}).click();
  await expect(a.locator('#status-line')).toContainText(/Anchor saved · joining (next bar|bar \d+)/);
  await a.screenshot({path:'.playwright/room-desktop.png'});
  // Invite by link; previewing does not join.
  await a.getByRole('button',{name:'Close the sound tray'}).click();
  await a.getByRole('button',{name:'Invite'}).click();await a.getByRole('button',{name:'Create link'}).click();
  const link=await a.locator('.link-out').inputValue();await a.keyboard.press('Escape');
  await b.goto(link);await expect(b.getByRole('heading',{level:1})).toContainText('invited you to join');
  expect((await snapshot(a)).members).toHaveLength(1);
  await b.getByRole('button',{name:'Join and enable sound'}).click();await b.waitForURL(/\/p\//);
  await expect(b.locator('.performer[data-part]')).toHaveCount(2);await expect.poll(async()=>(await snapshot(a)).members.length).toBe(2);
  // B adds a melody from the phone tray, then edits A's bass in code.
  await b.getByRole('button',{name:'Add a performer'}).click();await b.getByRole('button',{name:'Melody',exact:true}).click();await b.getByRole('button',{name:'Add Sunbeam'}).click();
  await expect(a.locator('.performer[data-part]')).toHaveCount(3);
  await expect(a.locator('.performer[data-part]').nth(2).locator('.credit')).toContainText((await snapshot(b)).you.handle);
  await b.getByRole('button',{name:'Close the sound tray'}).click();
  await b.locator('.performer[data-part] .performer-btn').nth(1).click();await b.getByRole('tab',{name:'Code'}).click();
  const code=b.locator('#code-editor');await expect(code).toHaveValue('note("33 ~ 33 40").s("triangle").lpf(850).gain(0.48)');
  await code.fill('note("a1 ~ [a1 c2] e2").s("sawtooth").lpf(700).gain(0.35)');
  await expect(b.locator('#code-error')).toContainText('not shared yet');
  await b.getByRole('button',{name:'Apply to mix'}).click();
  await expect(a.locator('.performer[data-part]').nth(1).locator('.credit')).toContainText('edited by');
  await expect.poll(async()=>(await snapshot(a)).parts[1].clips.A.source).toBe('note("a1 ~ [a1 c2] e2").s("sawtooth").lpf(700).gain(0.35)');
  // Invalid code never reaches the mix; the draft stays.
  await code.fill('note("a1").s("kazoo")');await expect(b.locator('#code-error')).toContainText('Unknown synth');
  await expect(b.getByRole('button',{name:'Apply to mix'})).toBeDisabled();
  await b.screenshot({path:'.playwright/code-phone.png'});
  await b.getByRole('button',{name:'Restore previous'}).click();await b.keyboard.press('Escape');
  // Chat without leaving the stage.
  await b.getByRole('button',{name:'Chat and people'}).click();await b.locator('#chat-input').fill('love the new bass');await b.locator('#chat-input').press('Enter');
  await expect(a.locator('#unread')).toHaveText('1');
  await a.getByRole('button',{name:'Chat and people'}).click();await expect(a.locator('#chat-log')).toContainText('love the new bass');await a.keyboard.press('Escape');
  await b.keyboard.press('Escape');
  // Reopen from Your projects: everything saved comes back; the tray stays closed.
  const url=a.url();await a.goto('/');await a.locator('.project-card').first().click();await a.waitForURL(url);
  await expect(a.locator('.performer[data-part]')).toHaveCount(3);await expect(a.locator('#tray')).toBeHidden();
  // Go live, unlisted; a third person listens and chats.
  await a.getByRole('button',{name:'Go live'}).click();await expect(a.getByRole('dialog')).toContainText('Only people you send the listen link to');
  await a.getByRole('dialog').getByRole('button',{name:'Go live'}).click();
  await expect(a.getByRole('button',{name:'Copy listen link'})).toBeVisible();
  const perf=(await snapshot(a)).performance;await a.keyboard.press('Escape');
  await c.goto(`/live/${perf.id}#listen=${perf.listenToken}`);await expect(c.locator('#aud-title')).toHaveText(perf.title);
  expect(c.url()).not.toContain('listen=');
  await c.getByRole('button',{name:'▶ Listen'}).click();await expect.poll(()=>traces(c),{timeout:15000}).toBeGreaterThan(0);
  await c.locator('#aud-input').fill('sounds great');await c.locator('#aud-input').press('Enter');await expect(c.locator('#aud-chat')).toContainText('sounds great');
  await expect(c.getByRole('button',{name:/Apply|Add/})).toHaveCount(0);
  await c.screenshot({path:'.playwright/audience-phone.png',fullPage:true});
  expect((await c.request.get(`/api/projects/${(await snapshot(a)).id}`)).status()).toBe(404);
  // End the performance: the audience is told, the project stays.
  await a.getByRole('button',{name:'● Live'}).click();await a.getByRole('button',{name:'End performance'}).click();
  await expect(c.locator('#aud-state')).toContainText('ended');await expect(a.locator('.performer[data-part]')).toHaveCount(3);
  expect(await noSideScroll(b)).toBe(true);expect(await noSideScroll(c)).toBe(true);
  expect(errors).toEqual([]);
  await desk.close();await phone.close();await third.close();
});

test('two people editing one part: the second keeps their draft and chooses what happens',async({browser})=>{
  const desk=await browser.newContext({viewport:{width:1920,height:1080}});const a=await desk.newPage();
  await a.goto('/');await a.getByRole('button',{name:'Start a mix'}).click();await a.waitForURL(/\/p\//);await a.getByRole('button',{name:'Add and play Pocket'}).click();
  await expect(a.locator('.performer[data-part]')).toHaveCount(1);
  // A second tab of the same person: a draft based on an older revision.
  const b=await desk.newPage();await b.goto(a.url());await b.locator('.performer[data-part] .performer-btn').click();await b.getByRole('tab',{name:'Code'}).click();
  await b.locator('#code-editor').fill('s("bd*2 sd")');
  // Meanwhile the first tab saves a newer revision (the lease is the person's, shared by their tabs).
  const s=await snapshot(a);await a.evaluate(async([id,pid,rev])=>{await fetch(`/api/projects/${id}/commands`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({commandId:crypto.randomUUID(),type:'part.edit',payload:{trackId:pid,source:'s("bd sd hh sd")'},expectedRevision:rev})});},[s.id,s.parts[0].id,s.parts[0].clips.A.revision] as const);
  await expect(b.getByRole('alert')).toContainText('Someone saved this part');await expect(b.getByRole('button',{name:'Apply to mix'})).toBeDisabled();await expect(b.locator('#code-editor')).toHaveValue('s("bd*2 sd")');
  await b.getByRole('button',{name:'Save as new part'}).click();
  await expect.poll(async()=>(await snapshot(a)).parts.filter((p:any)=>!p.archivedAt).map((p:any)=>p.clips.A.source)).toEqual(['s("bd sd hh sd")','s("bd*2 sd")']);
  await desk.close();
});

test('keyboard only at phone size: start, add, open a part, apply Shape, close, no sideways scroll, no axe violations',async({browser})=>{
  const AxeBuilder=(await import('@axe-core/playwright')).default;
  const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});const page=await ctx.newPage();
  await page.goto('/');await page.getByRole('button',{name:'Start a mix'}).focus();await page.keyboard.press('Enter');await page.waitForURL(/\/p\//);
  // The room is ready once it has its first snapshot: the status line says
  // something and the tray has its sounds.
  await expect(page.locator('#status-line')).toContainText(/hosting|playing|Stopped/);
  const add=page.getByRole('button',{name:'Add and play Pocket'});await add.focus();await page.keyboard.press('Enter');
  await expect(page.locator('.performer[data-part]')).toHaveCount(1);
  await page.getByRole('button',{name:'Close the sound tray'}).focus();await page.keyboard.press('Enter');
  const performer=page.locator('.performer[data-part] .performer-btn');await performer.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('tab',{name:'Shape'})).toBeVisible();
  await page.getByRole('tab',{name:'Shape'}).focus();await page.keyboard.press('Enter');
  const level=page.locator('#shape-level');await level.focus();for(let i=0;i<10;i++)await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('button',{name:'Apply to mix'})).toBeEnabled();await page.getByRole('button',{name:'Apply to mix'}).focus();await page.keyboard.press('Enter');
  await expect.poll(async()=>{const s=await snapshot(page);return s.plans.at(-1).mix[s.parts[0].id].gain;}).toBeLessThan(0.7);
  await page.keyboard.press('Escape');await expect(page.locator('#drawer')).toBeHidden();await expect(performer).toBeFocused();
  expect(await noSideScroll(page)).toBe(true);
  const room=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
  expect(room.violations.map(v=>`${v.id}: ${v.nodes.map(n=>n.target.join(' ')).join(', ')}`)).toEqual([]);
  for(const path of ['/','/live','/friends']){await page.goto(path);await page.waitForLoadState('networkidle');const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();expect(r.violations.map(v=>`${path} ${v.id}`)).toEqual([]);expect(await noSideScroll(page)).toBe(true);}
  await page.screenshot({path:'.playwright/friends-phone.png',fullPage:true});
  await ctx.close();
});

test('sound that the browser refuses says so and offers Enable sound; the mix is still saved',async({browser})=>{
  const ctx=await browser.newContext({viewport:{width:1920,height:1080}});
  // Simulate a browser that keeps audio suspended.
  await ctx.addInitScript(()=>{const R=(window as any).AudioContext;(window as any).AudioContext=class extends R{resume(){return Promise.resolve();}get state(){return 'suspended';}};});
  const page=await ctx.newPage();await page.goto('/');await page.getByRole('button',{name:'Start a mix'}).click();await page.waitForURL(/\/p\//);
  await page.getByRole('button',{name:'Add and play Pocket'}).click();
  await expect(page.locator('#status-line')).toContainText(/sound is off on this device|Press Enable sound/i);
  await expect(page.locator('#sound-toggle')).toHaveText(/Enable sound/);
  expect((await snapshot(page)).parts).toHaveLength(1);
  await ctx.close();
});

test('a refused live stream falls back to polling and still saves',async({browser})=>{
  const ctx=await browser.newContext();const first=await ctx.newPage();await first.goto('/');await first.getByRole('button',{name:'Start a mix'}).click();await first.waitForURL(/\/p\//);
  await expect(first).toHaveURL(/\/p\/[0-9a-f-]+$/);const url=first.url();const tabs:Page[]=[];
  for(let i=0;i<3;i++){const p=await ctx.newPage();await p.goto(url);await expect(p.locator('.room')).toBeVisible();tabs.push(p);}
  // Three streams per person and scope; the fourth tab polls instead.
  const fourth=tabs[2];await expect(fourth.locator('#status-line')).toContainText('checking every second',{timeout:15000});
  await fourth.getByRole('button',{name:'Add your first performer'}).click();await fourth.getByRole('button',{name:/^Add( and play)? Pocket$/}).click();
  await expect.poll(async()=>(await snapshot(first)).parts.length).toBe(1);
  await ctx.close();
});

test('an invitation survives a reload, and is still only usable once',async({browser})=>{
  const host=await browser.newContext({viewport:{width:1280,height:800}});
  const guest=await browser.newContext({viewport:{width:390,height:844}});
  const a=await host.newPage(),b=await guest.newPage();
  await a.goto('/');await a.getByRole('button',{name:'Start a mix'}).click();await a.waitForURL(/\/p\//);
  await a.getByRole('button',{name:/Add and play/}).first().click();
  await expect(a.locator('.performer[data-part]')).toHaveCount(1);
  await a.getByRole('button',{name:'Close the sound tray'}).click();
  await a.getByRole('button',{name:'Invite'}).click();await a.getByRole('button',{name:'Create link'}).click();
  const link=await a.locator('.link-out').inputValue();await a.keyboard.press('Escape');
  await b.goto(link);
  await expect(b.getByRole('heading',{level:1})).toContainText('invited you to join');
  // The fragment is gone from the address bar straight away.
  expect(b.url()).not.toContain('#');
  // Reloading before accepting must not lose the invitation.
  await b.reload();
  await expect(b.getByRole('heading',{level:1})).toContainText('invited you to join');
  const accept=b.getByRole('button',{name:'Join and enable sound'});
  await expect(accept).toBeVisible();
  await accept.click();
  await b.waitForURL(/\/p\//);
  await expect(b.locator('.performer[data-part]')).toHaveCount(1);
  // The used token is forgotten, and the link cannot be used again.
  await b.goto(link.replace(/#.*/,''));
  await expect(b.getByRole('heading',{level:1})).toContainText(/isn’t valid|can’t be used/);
  const third=await browser.newContext();const c=await third.newPage();
  await c.goto(link);
  await expect(c.getByRole('heading',{level:1})).toContainText(/can’t be used|already been used/);
  await host.close();await guest.close();await third.close();
});

test('an invitation still works where session storage is unavailable',async({browser})=>{
  const host=await browser.newContext();const guest=await browser.newContext();
  const a=await host.newPage(),b=await guest.newPage();
  await a.goto('/');await a.getByRole('button',{name:'Start a mix'}).click();await a.waitForURL(/\/p\//);
  await a.getByRole('button',{name:'Invite'}).click();await a.getByRole('button',{name:'Create link'}).click();
  const link=await a.locator('.link-out').inputValue();
  // A browser that throws on any storage access, as a locked-down private window does.
  await b.addInitScript(()=>{const boom=()=>{throw new Error('denied');};
    Object.defineProperty(window,'sessionStorage',{get:boom});});
  await b.goto(link);
  await expect(b.getByRole('heading',{level:1})).toContainText('invited you to join');
  await b.getByRole('button',{name:'Join and enable sound'}).click();
  await b.waitForURL(/\/p\//);
  await host.close();await guest.close();
});
