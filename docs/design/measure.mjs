// Measures what can be measured about each direction: axe findings on the stage
// and creator, and animation frame rate with twelve figures moving under 4x CPU
// throttling. Screens are prototypes; these numbers inform a choice, they do not
// prove quality. Run from the repo root: node docs/design/measure.mjs
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const browser=await chromium.launch();
for(const name of ['1-main-stage','2-coin-op','3-workbench']){
  const url=pathToFileURL(resolve(`docs/design/${name}/index.html`)).href;
  const ctx=await browser.newContext({viewport:{width:1920,height:1080}});
  const findings={};
  for(const screen of ['stage','creator']){
    const page=await ctx.newPage();await page.goto(`${url}#${screen}`);await page.waitForTimeout(300);
    const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
    for(const v of r.violations)findings[v.id]=(findings[v.id]??0)+v.nodes.length;
    await page.close();
  }
  const page=await ctx.newPage();await page.goto(`${url}#stage`);await page.waitForTimeout(400);
  const cdp=await ctx.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const fps=await page.evaluate(async()=>{
    const host=document.querySelector('.stage,.crt,.band');const first=host.querySelector('.figure,canvas');
    for(let i=0;i<12;i++){const c=first.cloneNode(true);c.style.cssText='position:absolute;width:140px;height:auto;left:'+(i*8)+'%;bottom:60px';host.append(c);}
    const moving=[...document.querySelectorAll('.figure,canvas')];
    const anims=moving.map((el,i)=>el.animate([{transform:'translateY(0)'},{transform:'translateY(-14px) scale(1.03,.97)'},{transform:'translateY(0)'}],{duration:320+i*7,iterations:Infinity}));
    let frames=0;const start=performance.now();
    await new Promise(done=>{const f=()=>{frames++;performance.now()-start<3000?requestAnimationFrame(f):done();};requestAnimationFrame(f);});
    anims.forEach(a=>a.cancel());return Math.round(frames/3);
  });
  console.log(name,JSON.stringify({axe:findings,fpsAt4xThrottle:fps}));
  await ctx.close();
}
await browser.close();
