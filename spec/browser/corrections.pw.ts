import {test,expect,type Browser,type BrowserContext} from '@playwright/test';

async function post(ctx:BrowserContext,path:string,data:unknown){
  const r=await ctx.request.post(path,{data});
  expect(r.ok(),`${path}: ${await r.text()}`).toBe(true);
  return r.json();
}
async function get(ctx:BrowserContext,path:string){const r=await ctx.request.get(path);expect(r.ok()).toBe(true);return r.json();}
async function session(browser:Browser,baseURL:string){
  const owner=await browser.newContext({baseURL,viewport:{width:1920,height:1080}});
  const member=await browser.newContext({baseURL,viewport:{width:390,height:844}});
  const audience=await browser.newContext({baseURL,viewport:{width:390,height:844}});
  const meA=await get(owner,'/api/me'),meB=await get(member,'/api/me');await get(audience,'/api/me');
  const {id}=await post(owner,'/api/projects',{});
  const invite=await post(owner,'/api/invitations',{kind:'project',resourceId:id});
  const [iid,token]=invite.path.replace('/invite/','').split('#');
  await post(member,`/api/invitations/${iid}/accept`,{token});
  await post(owner,`/api/projects/${id}/commands`,{commandId:crypto.randomUUID(),type:'part.add',payload:{presetId:'warm-pocket',play:true}});
  const perf=await post(owner,`/api/projects/${id}/go-live`,{commandId:crypto.randomUUID(),title:'Shared rehearsal',visibility:'public'});
  return {owner,member,audience,id,perf:perf.id,meA,meB};
}

test('blocking updates open project and audience chats, preserves typing and other people’s views, and survives reload',async({browser,baseURL})=>{
  const x=await session(browser,baseURL!);
  try{
    const room=await x.owner.newPage(),aud=await x.owner.newPage(),other=await x.audience.newPage();
    await room.goto(`/p/${x.id}`);await room.getByRole('button',{name:'Chat and people'}).click();
    await aud.goto(`/live/${x.perf}`);await other.goto(`/live/${x.perf}`);
    await post(x.member,`/api/projects/${x.id}/chat`,{clientId:crypto.randomUUID(),body:'Project block marker'});
    await post(x.member,`/api/performances/${x.perf}/chat`,{clientId:crypto.randomUUID(),body:'Audience block marker'});
    await expect(room.locator('#chat-log')).toContainText('Project block marker');
    await expect(aud.locator('#aud-chat')).toContainText('Audience block marker');
    await room.locator('#chat-input').fill('still typing in the room');await aud.locator('#aud-input').fill('still typing to audience');
    await post(x.owner,'/api/friends',{action:'block',visitorId:x.meB.id});
    await expect(room.locator('#chat-log')).not.toContainText('Project block marker');
    await expect(aud.locator('#aud-chat')).not.toContainText('Audience block marker');
    await expect(room.locator('#chat-input')).toHaveValue('still typing in the room');
    await expect(aud.locator('#aud-input')).toHaveValue('still typing to audience');
    await expect(other.locator('#aud-chat')).toContainText('Audience block marker');
    await aud.reload();await expect(aud.locator('#aud-chat')).not.toContainText('Audience block marker');
    await post(x.owner,'/api/friends',{action:'unblock',visitorId:x.meB.id});
    await expect(room.locator('#chat-log')).toContainText('Project block marker');
    await expect(aud.locator('#aud-chat')).toContainText('Audience block marker');
    await room.reload();await room.getByRole('button',{name:'Chat and people'}).click();
    await expect(room.locator('#chat-log')).toContainText('Project block marker');
    expect((await get(x.member,`/api/projects/${x.id}`)).you.role).toBe('member');
  }finally{await x.owner.close();await x.member.close();await x.audience.close();}
});

test('a guest customises only their own part, recovers drafts and resolves conflicts without project access',async({browser,baseURL})=>{
  const x=await session(browser,baseURL!),second=await browser.newContext({baseURL,viewport:{width:1920,height:1080}});
  try{
    const ownerPage=await x.owner.newPage();await ownerPage.goto(`/p/${x.id}`);
    const guestId=(await get(x.audience,'/api/me')).id;const secondId=(await get(second,'/api/me')).id;
    for(const [ctx,id] of [[x.audience,guestId],[second,secondId]] as const){
      await post(ctx,'/api/handle',{handle:'Same guest'});
      await post(ctx,`/api/performances/${x.perf}/moderate`,{action:'request'});
      await post(x.owner,`/api/performances/${x.perf}/moderate`,{action:'accept',visitorId:id});
    }
    const theirs=await post(second,`/api/performances/${x.perf}/commands`,{commandId:crypto.randomUUID(),type:'guest.add',payload:{presetId:'warm-anchor'}});
    const g=await x.audience.newPage();await g.goto(`/live/${x.perf}`);
    await expect(g.locator('#aud-status')).toContainText('You’re performing');
    await g.getByRole('button',{name:'Add',exact:true}).click();
    await expect(g.getByRole('button',{name:'Edit Pocket',exact:true})).toBeVisible();
    await expect(g.getByRole('button',{name:'Edit Anchor',exact:true})).toHaveCount(0);
    const own=(await get(x.audience,`/api/performances/${x.perf}`)).yourParts[0];
    expect(own.id).not.toBe(theirs.entityId);
    await g.getByRole('button',{name:'Edit Pocket',exact:true}).click();
    await expect(g.getByRole('dialog')).toBeVisible();
    const code=g.locator('#guest-code'),source='// Guest precision\nnote("a2 ~ [c3 e3] ~").s("triangle").room(0.2);';
    await code.fill('fetch("/api/me")');await expect(g.getByRole('button',{name:'Apply to mix',exact:true})).toBeDisabled();
    expect((await get(x.audience,`/api/performances/${x.perf}`)).yourParts[0].revision).toBe(1);
    await code.fill(source);await g.getByRole('button',{name:'Preview on my device',exact:true}).click();
    await expect(g.getByRole('button',{name:'Stop preview',exact:true})).toBeVisible();
    // The same async store used for recovery must finish before the document exits.
    await expect.poll(()=>g.evaluate(async()=>{
      return new Promise<boolean>(resolve=>{const r=indexedDB.open('ensemble-drafts',1);r.onsuccess=()=>{const db=r.result;const q=db.transaction('code').objectStore('code').getAll();q.onsuccess=()=>{resolve(q.result.some((d:any)=>d.source.includes('Guest precision')));db.close();};};r.onerror=()=>resolve(false);});
    })).toBe(true);
    await g.reload();await g.getByRole('button',{name:'Edit Pocket',exact:true}).click();
    await expect(code).toHaveValue(source);
    await expect(g.getByRole('button',{name:'Apply to mix',exact:true})).toBeEnabled();
    await x.audience.setOffline(true);
    await expect(g.locator('#guest-code-status')).toContainText('Reconnecting',{timeout:15000});
    await expect(code).toHaveValue(source);await expect(g.getByRole('button',{name:'Apply to mix',exact:true})).toBeDisabled();
    await x.audience.setOffline(false);
    await expect(g.getByRole('button',{name:'Apply to mix',exact:true})).toBeEnabled({timeout:15000});
    const AxeBuilder=(await import('@axe-core/playwright')).default;
    await g.setViewportSize({width:1920,height:1080});
    expect((await new AxeBuilder({page:g}).include('#guest-editor').withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
    await g.screenshot({path:'.playwright/guest-code-desktop.png',fullPage:true});
    await g.setViewportSize({width:390,height:844});await expect(code).toHaveValue(source);
    expect(await g.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await new AxeBuilder({page:g}).include('#guest-editor').withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
    await g.screenshot({path:'.playwright/guest-code-phone.png',fullPage:true});
    await g.getByRole('button',{name:'Apply to mix',exact:true}).click();
    await expect.poll(async()=>(await get(x.audience,`/api/performances/${x.perf}`)).yourParts[0].source).toBe(source);
    expect((await x.audience.request.get(`/api/projects/${x.id}`)).status()).toBe(404);
    await g.getByRole('tab',{name:'Shape',exact:true}).click();
    await g.locator('#guest-shape-gain').focus();
    for(let i=0;i<10;i++)await g.locator('#guest-shape-gain').press('ArrowLeft');
    await g.getByRole('button',{name:'Apply to mix',exact:true}).click();
    await expect.poll(async()=>(await get(x.audience,`/api/performances/${x.perf}`)).yourParts[0].source).toContain('.gain(0.9)');
    await g.getByRole('tab',{name:'Code',exact:true}).click();await code.fill('s("bd*2 cp")');
    const now=(await get(x.audience,`/api/performances/${x.perf}`)).yourParts[0];
    await post(x.audience,`/api/performances/${x.perf}/commands`,{commandId:crypto.randomUUID(),type:'guest.edit',expectedRevision:now.revision,payload:{trackId:own.id,source:'s("hh*4")'}});
    await expect(g.getByRole('alert')).toContainText('changed in another tab');await expect(code).toHaveValue('s("bd*2 cp")');
    await g.getByRole('button',{name:'Save as new part',exact:true}).click();
    await expect.poll(async()=>(await get(x.audience,`/api/performances/${x.perf}`)).yourParts.length).toBe(2);
    await expect(g.getByRole('dialog').getByRole('heading')).toContainText('copy');
    await code.fill('s("cp*2")');
    await post(x.owner,`/api/performances/${x.perf}/end`,{});
    await expect(g.locator('#guest-code-status')).toContainText('ended');await expect(code).toHaveValue('s("cp*2")');
    await expect(g.getByRole('button',{name:'Apply to mix',exact:true})).toBeDisabled();
    await expect(g.getByRole('button',{name:'Copy draft',exact:true})).toBeEnabled();
    await g.screenshot({path:'.playwright/guest-draft-ended-phone.png',fullPage:true});
  }finally{await x.owner.close();await x.member.close();await x.audience.close();await second.close();}
});

test('different project members respect edit leases while keeping an independent draft',async({browser,baseURL})=>{
  const x=await session(browser,baseURL!);
  try{
    const a=await x.owner.newPage(),b=await x.member.newPage();await a.goto(`/p/${x.id}`);await b.goto(`/p/${x.id}`);
    await a.locator('.performer[data-part] .performer-btn').click();await a.getByRole('tab',{name:'Code',exact:true}).click();
    await a.locator('#code-editor').fill('s("bd cp bd cp")');
    await expect.poll(async()=>(await get(x.owner,`/api/projects/${x.id}`)).parts[0].lease?.visitorId).toBe(x.meA.id);
    await b.locator('.performer[data-part] .performer-btn').click();await b.getByRole('tab',{name:'Code',exact:true}).click();
    await expect(b.locator('#code-editor')).toHaveAttribute('readonly','');
    await expect(b.getByRole('button',{name:'Apply to mix',exact:true})).toBeDisabled();
    await expect(a.locator('#code-editor')).toHaveValue('s("bd cp bd cp")');
    await a.getByRole('button',{name:'Apply to mix',exact:true}).click();
    await expect.poll(async()=>(await get(x.member,`/api/projects/${x.id}`)).parts[0].clips.A.source).toBe('s("bd cp bd cp")');
    await a.keyboard.press('Escape');await b.keyboard.press('Escape');
    await b.locator('.performer[data-part] .performer-btn').click();await b.getByRole('tab',{name:'Code',exact:true}).click();
    await expect(b.locator('#code-editor')).not.toHaveAttribute('readonly','');
  }finally{await x.owner.close();await x.member.close();await x.audience.close();}
});
