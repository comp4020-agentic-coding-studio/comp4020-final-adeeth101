// Prints measurements; it does not pass or fail. Two Chromium pages schedule
// the same plan on a shared epoch, the second joining late; then every factory
// preset is rendered offline through the real output chain and its peak and
// loudness are measured. Scheduled times are not speaker output: this says
// nothing about device latency or two machines on a network.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join,normalize } from 'node:path';
const manifest=JSON.parse(await readFile('dist/client/.vite/manifest.json','utf8'));
const server=createServer(async(req,res)=>{
  try{
    if(req.url==='/'){res.setHeader('content-type','text/html');res.end(`<button>Enable sound</button><script type="module" src="/assets/${manifest['client/audio-proof.ts'].file}"></script>`);return;}
    const rel=normalize(req.url.replace('/assets/',''));if(rel.startsWith('..'))throw Error();
    res.setHeader('content-type','text/javascript');res.end(await readFile(join('dist/client',rel)));
  }catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(8182,'127.0.0.1',r));
const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
try{
  const a=await browser.newPage(), b=await browser.newPage();
  await Promise.all([a.goto('http://127.0.0.1:8182'),b.goto('http://127.0.0.1:8182')]);
  await Promise.all([a.waitForFunction(()=>window.testAudio),b.waitForFunction(()=>window.testAudio)]);
  const epoch=Date.now()+500;
  await a.evaluate(epoch=>window.testAudio(epoch,'warm-pocket'),epoch);
  await a.waitForTimeout(2200);
  await b.evaluate(epoch=>window.testAudio(epoch,'warm-pocket'),epoch);
  await a.waitForTimeout(2500);
  const traces=await Promise.all([a.evaluate(()=>window.studioAudio.trace),b.evaluate(()=>window.studioAudio.trace)]);
  const common=traces[0].filter(x=>traces[1].some(y=>y.cycle===x.cycle&&y.sound===x.sound));
  if(!common.length||traces[1][0].cycle<1)throw Error('Late browser did not join the shared musical phase.');
  console.log(JSON.stringify({lateJoinFirstCycle:traces[1][0].cycle,sharedOnsets:common.length,scheduledEpochDisagreementMs:Math.max(...common.map(x=>Math.abs(x.serverMs-traces[1].find(y=>y.cycle===x.cycle&&y.sound===x.sound).serverMs)))},null,2));
  // Offline render of each preset for two bars at its pack tempo, through the
  // same output (master gain, limiter, ceiling) at full device volume.
  const levels=await a.evaluate(async()=>{
    const out=[];
    for(const id of window.presetIds){out.push(await window.renderPreset(id));}
    return out;
  });
  console.log(JSON.stringify(levels,null,0).replaceAll('},{','},\n{'));
  const dense=await a.evaluate(()=>window.renderPreset(['arcade-four','arcade-engine','arcade-pixel','arcade-orbit','warm-pocket','warm-anchor','warm-sunbeam','warm-glow','night-heart','night-floor','night-lantern','night-velvet']));
  console.log(JSON.stringify({twelveParts:dense}));
}finally{await browser.close();server.close();}
