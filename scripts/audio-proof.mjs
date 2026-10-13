import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join,normalize } from 'node:path';
const manifest=JSON.parse(await readFile('dist/client/.vite/manifest.json','utf8'));
const server=createServer(async(req,res)=>{
  try{
    if(req.url==='/'){res.setHeader('content-type','text/html');res.end(`<button>Enable sound</button><script type="module" src="/assets/${manifest['client/main.ts'].file}"></script>`);return;}
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
  await a.evaluate(epoch=>window.testAudio(epoch),epoch);
  await a.waitForTimeout(2200);
  await b.evaluate(epoch=>window.testAudio(epoch),epoch);
  await a.waitForTimeout(2500);
  const traces=await Promise.all([a.evaluate(()=>window.studioAudio.trace),b.evaluate(()=>window.studioAudio.trace)]);
  const common=traces[0].filter(x=>traces[1].some(y=>y.cycle===x.cycle));
  if(!common.length||traces[1][0].cycle<1)throw Error('Late browser did not join the shared musical phase.');
  console.log(JSON.stringify({first:traces[0],late:traces[1],sharedCycles:common.map(x=>x.cycle),scheduledEpochDisagreementMs:Math.max(...common.map(x=>Math.abs(x.serverMs-traces[1].find(y=>y.cycle===x.cycle).serverMs)))},null,2));
}finally{await browser.close();server.close();}
