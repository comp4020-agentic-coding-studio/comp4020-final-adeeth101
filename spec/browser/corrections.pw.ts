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
