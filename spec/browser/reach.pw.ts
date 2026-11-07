// Reaching things on a phone. Three promises that only a real browser shows:
// nothing is reached by dragging the page sideways, a destination is a button a
// thumb can hit rather than a word to aim at, and the pages written before the
// stage existed wear the same clothes as the stage.
import {test,expect,type Page} from '@playwright/test';

const PHONE={width:390,height:844};

// On a phone nothing is reached by moving sideways: not the page, and not a
// strip inside it either, because a row you have to drag is a row whose far end
// nobody finds. So this fails on three things: the page scrolling sideways, a
// region that really does scroll sideways, and anything a person has to read or
// press sitting outside the window. Decoration may bleed --- a painted floor or
// a shadow is inside something that clips it, and nobody has to reach it.
const REACHABLE='a[href],button,input,select,textarea,summary,[role=tab],h1,h2,p,li,label';
const name=(el:Element)=>`${el.tagName.toLowerCase()}${el.id?'#'+el.id:''}${el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/)[0]:''}`;
async function reachable(page:Page,where:string){
  const out=await page.evaluate(({sel,name}:{sel:string;name:string})=>{
    const label=new Function('el',`return (${name})(el)`) as (el:Element)=>string;
    const vw=document.documentElement.clientWidth,bad:string[]=[];
    if(document.documentElement.scrollWidth>vw)bad.push(`the page itself scrolls sideways (${document.documentElement.scrollWidth} wide)`);
    for(const el of document.querySelectorAll<HTMLElement>('body *')){
      const cs=getComputedStyle(el);
      if(cs.display==='none'||cs.visibility==='hidden')continue;
      if((cs.overflowX==='auto'||cs.overflowX==='scroll')&&el.scrollWidth>el.clientWidth+2)
        bad.push(`${label(el)} has to be dragged sideways (${el.scrollWidth} inside ${el.clientWidth})`);
    }
    for(const el of document.querySelectorAll<HTMLElement>(sel)){
      const cs=getComputedStyle(el);
      if(cs.display==='none'||cs.visibility==='hidden'||cs.position==='fixed')continue;
      if(el.closest('.sr-only, .skip, [aria-hidden=true], [hidden]'))continue;
      const r=el.getBoundingClientRect();
      if(r.width===0&&r.height===0)continue;
      if(r.right>vw+1||r.left<-1)bad.push(`${label(el)} [${Math.round(r.left)}…${Math.round(r.right)}] "${(el.textContent??'').trim().slice(0,30)}"`);
    }
    return [...new Set(bad)].slice(0,8);
  },{sel:REACHABLE,name:name.toString()});
  expect(out,`${where}: off the side of a 390px screen`).toEqual([]);
}

// A destination you press: at least 44 by 44, the size the rest of the app uses.
async function thumbSized(page:Page,selector:string,where:string){
  const small=await page.evaluate(sel=>[...document.querySelectorAll<HTMLElement>(sel)]
    .filter(el=>el.offsetParent!==null)
    .map(el=>({t:(el.textContent??'').trim().slice(0,24),r:el.getBoundingClientRect()}))
    .filter(x=>x.r.height<44||x.r.width<44)
    .map(x=>`${x.t} is ${Math.round(x.r.width)}×${Math.round(x.r.height)}`),selector);
  expect(small,`${where}: too small to hit with a thumb`).toEqual([]);
}

test('on a phone no page is reached by dragging it sideways',async({browser})=>{
  const context=await browser.newContext({viewport:PHONE,hasTouch:true}),page=await context.newPage();
  try{
    for(const [path,where] of [['/','home'],['/characters','characters'],['/live','live now'],['/friends','friends'],['/discover','public mixes']]){
      await page.goto(path);await reachable(page,where);
    }
  }finally{await context.close();}
});

test('on a phone all eight parts of a character are on screen at once',async({browser})=>{
  const context=await browser.newContext({viewport:PHONE,hasTouch:true}),page=await context.newPage();
  try{
    await page.goto('/characters');await page.getByRole('button',{name:'Create character',exact:true}).click();
    await page.getByRole('button',{name:'Melody',exact:true}).click();
    for(const tab of ['Body','Face','Headwear','Clothes','Props','Colours','Music','Details']){
      await expect(page.getByRole('tab',{name:tab})).toBeVisible();
      await page.getByRole('tab',{name:tab}).click();await reachable(page,`creator · ${tab}`);
    }
    await page.getByRole('button',{name:'Close the creator'}).click();
  }finally{await context.close();}
});

test('on a phone the stage, the grid and the sections strip stay inside the screen',async({browser})=>{
  const context=await browser.newContext({viewport:PHONE,hasTouch:true}),page=await context.newPage();
  try{
    await page.goto('/');await page.getByRole('button',{name:'Start a mix'}).click();await page.waitForURL(/\/p\//);
    await page.getByRole('button',{name:/^Add( and play)? Pocket$/}).click();
    await page.getByRole('button',{name:/^Add( and play)? Sunbeam$/}).click();
    await expect(page.locator('.performer[data-part]')).toHaveCount(2);
    await page.getByRole('button',{name:'Close the cast'}).click();
    await reachable(page,'stage');
    for(const index of [0,1]){
      await page.locator('.performer[data-part] .performer-btn').nth(index).click();
      await page.getByRole('tab',{name:'Pattern'}).click();
      await expect(page.locator('.cell').first()).toBeVisible();
      await reachable(page,index===0?'drum grid':'note grid');
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button',{name:'Sections'}).click();
    await expect(page.locator('#arrange')).toBeVisible();
    await page.getByRole('button',{name:'Who plays in Build'}).click();
    await reachable(page,'sections');
  }finally{await context.close();}
});

test('a phone shows every step of a bar, and the sixteenth is as editable as the first',async({browser})=>{
  const context=await browser.newContext({viewport:PHONE,hasTouch:true}),page=await context.newPage();
  try{
    await page.goto('/');await page.getByRole('button',{name:'Start a mix'}).click();await page.waitForURL(/\/p\//);
    await page.getByRole('button',{name:/^Add( and play)? Pocket$/}).click();
    await expect(page.locator('.performer[data-part]')).toHaveCount(1);
    await page.getByRole('button',{name:'Close the cast'}).click();
    await page.locator('.performer[data-part] .performer-btn').click();
    await page.getByRole('tab',{name:'Pattern'}).click();
    // Every column of the bar is on screen, in blocks of eight.
    const kick=page.locator('.cell[data-grid="kit"][data-r="0"]');
    await expect(kick).toHaveCount(16);
    const blocks=await page.locator('.grid-part').allInnerTexts();
    expect(blocks).toEqual(['Steps 1–8','Steps 9–16']);
    const out=await page.evaluate(()=>{
      const vw=document.documentElement.clientWidth;
      return [...document.querySelectorAll<HTMLElement>('.cell')].map(c=>c.getBoundingClientRect())
        .filter(r=>r.right>vw+1||r.left<-1).length;
    });
    expect(out,'steps off the side of the screen').toBe(0);
    // A step in the second block writes to the source like any other.
    await page.locator('.cell[data-grid="kit"][data-r="0"][data-c="12"]').click();
    await page.getByRole('tab',{name:'Code'}).click();
    expect(await page.locator('#code-editor').inputValue()).toContain('bd');
    await page.getByRole('tab',{name:'Pattern'}).click();
    await expect(page.locator('.cell[data-grid="kit"][data-r="0"][data-c="12"]')).toHaveAttribute('aria-pressed','true');
  }finally{await context.close();}
});

test('every way of getting somewhere is a button a thumb can hit',async({browser})=>{
  const context=await browser.newContext({viewport:PHONE,hasTouch:true}),page=await context.newPage();
  try{
    for(const [path,where] of [['/','home'],['/characters','characters'],['/live','live now'],['/readme/','about'],['/legacy','sketchpad']]){
      await page.goto(path);
      await thumbSized(page,'.site-header nav a, .site-footer a, .bar nav a',where);
      await thumbSized(page,'main a.outline, main a.primary, main a.ghost',where);
    }
  }finally{await context.close();}
});

test('the pages written before the stage wear the same clothes as the stage',async({browser})=>{
  const AxeBuilder=(await import('@axe-core/playwright')).default;
  for(const viewport of [{width:1920,height:1080},PHONE]){
    const context=await browser.newContext({viewport}),page=await context.newPage();
    try{
      for(const [path,where] of [['/readme/','about'],['/legacy','sketchpad'],['/archive','archive']]){
        await page.goto(path);
        // The same stylesheet, the same header, the same way back.
        expect(await page.locator('link[href="/static/studio.css"]').count(),where).toBe(1);
        await expect(page.locator('.site-header .brand-text')).toHaveText('Ensemble');
        await expect(page.getByRole('navigation',{name:'Main'}).getByRole('link',{name:'Play'})).toBeVisible();
        await expect(page.locator('.site-footer')).toBeVisible();
        // The same type and the same wall, not the old black on white.
        const look=await page.evaluate(()=>{
          const cs=getComputedStyle(document.body),main=document.querySelector('main')!;
          return {body:cs.backgroundColor,font:getComputedStyle(document.querySelector('h1')!).fontFamily,sheet:getComputedStyle(main).backgroundColor};
        });
        expect(look.body,`${where} wall`).toBe('rgb(26, 17, 69)');
        expect(look.sheet,`${where} sheet`).toBe('rgb(255, 246, 227)');
        expect(look.font,`${where} type`).toContain('Bricolage');
        if(viewport.width===PHONE.width)await reachable(page,where);
        const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
        expect(r.violations.map(v=>`${where} ${v.id}: ${v.nodes.map(n=>n.target.join(' ')).join(', ')}`)).toEqual([]);
      }
    }finally{await context.close();}
  }
});
