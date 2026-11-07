// Builds the three design directions as standalone working previews, using the
// real character artwork and the real cast, then screenshots each one at the two
// marking viewports. Run from the repo root: node docs/design/build.mjs
import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {characterSvg} from '../../client/performer.ts';
import {PACKS,PRESETS,ROLE_LABEL} from '../../shared/presets.ts';
import {BODIES,EYES,TOPS,PROPS,LOOK_LABEL,SWATCHES,SWATCH_HEX} from '../../shared/look.ts';

const pick=(...ids)=>ids.map(id=>PRESETS.find(p=>p.id===id));
const BAND=pick('sun-gate','arcade-engine','warm-sunbeam','rain-upright','sun-horizon');
const BROWSE=PACKS[3].presets.concat(PACKS[4].presets.slice(0,4));
const HERO={v:1,body:'critter',eyes:'sparkle',mouth:'sing',top:'headphones',wear:'stripes',prop:'keytar',skin:'mint',cloth:'cobalt',trim:'sun'};
const fig=(look,cls='')=>characterSvg(look,{className:cls});
const steps=(hits,n=16)=>Array.from({length:n},(_,i)=>`<i class="${hits.includes(i)?'on':''}${i%4===0?' beat':''}"></i>`).join('');
const KIT=[['Kick',[0,4,8,12]],['Snare',[4,12]],['Hat',[0,2,4,6,8,10,12,14]],['Tom',[14,15]]];
const FONT=(name,file,weight)=>`@font-face{font-family:"${name}";src:url(../fonts/${file}) format("woff2");font-weight:${weight};font-display:swap}`;
const shell=(title,fonts,css,body,script='')=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${fonts}
*{box-sizing:border-box}html,body{margin:0;height:100%}button{font:inherit;cursor:pointer;color:inherit}
.screen{display:none}body[data-screen=stage] .screen.s-stage,body[data-screen=browse] .screen.s-browse,body[data-screen=creator] .screen.s-creator{display:flex}
.figure{display:block;width:100%;height:auto;overflow:visible}
${css}</style></head><body data-screen="stage">${body}<script>
const go=s=>{document.body.dataset.screen=s;document.querySelectorAll('[data-go]').forEach(b=>b.setAttribute('aria-current',b.dataset.go===s));};
go(location.hash.slice(1)||'stage');document.addEventListener('click',e=>{const b=e.target.closest('[data-go]');if(b)go(b.dataset.go);const c=e.target.closest('.pick');if(c){c.parentElement.querySelectorAll('.pick').forEach(x=>x.classList.remove('is-on'));c.classList.add('is-on');}const t=e.target.closest('.steps i');if(t)t.classList.toggle('on');});
${script}</script></body></html>`;

// --- 1. Main Stage: a big illustrated band under one spotlight ---------------
function mainStage(){
  const fonts=FONT('Bricolage','bricolage-800.woff2',800)+FONT('Bricolage','bricolage-600.woff2',600)+FONT('DM Sans','dmsans-400.woff2',400)+FONT('DM Sans','dmsans-700.woff2',700);
  const css=`:root{--wall:#3a2aa0;--wall2:#23185f;--floor:#ffcb3d;--ink:#1d1733;--paper:#fff6e3;--pop:#ff5f4a;--line:rgba(255,246,227,.22)}
body{font-family:"DM Sans",sans-serif;background:var(--wall2);color:var(--paper);overflow-x:hidden}
.screen{min-height:100vh;flex-direction:column}
h1,h2,h3,.disp{font-family:Bricolage,sans-serif;font-weight:800;letter-spacing:-.02em;margin:0}
.top{display:flex;align-items:center;gap:14px;padding:14px 24px;position:relative;z-index:3}
.logo{font:800 22px Bricolage;letter-spacing:-.03em}.mix{font:800 30px Bricolage}.tag{font-size:13px;border:2px solid var(--line);padding:3px 10px;border-radius:99px}
.sp{flex:1}.faces{display:flex}.faces b{width:38px;height:38px;border-radius:50%;background:var(--pop);border:3px solid var(--wall2);margin-left:-8px;display:grid;place-items:center;font-size:13px;color:var(--ink)}.faces b:nth-child(2){background:#7cc8f5}.faces b:nth-child(3){background:#6fdca8}
.btn{border:0;border-radius:14px;padding:12px 18px;font-weight:700;background:var(--paper);color:var(--ink);box-shadow:0 4px 0 rgba(0,0,0,.35)}.btn.ghost{background:transparent;color:var(--paper);box-shadow:inset 0 0 0 2px var(--line)}
.stage{flex:1;position:relative;display:flex;align-items:flex-end;justify-content:center;gap:clamp(4px,1.6vw,34px);padding:0 4vw 92px;background:radial-gradient(60% 90% at 50% 8%,#7a5cff 0,#5237d6 34%,var(--wall) 62%,var(--wall2) 100%);overflow:hidden;min-height:560px}
.stage:before{content:"";position:absolute;left:-10%;right:-10%;bottom:-70px;height:170px;background:var(--floor);border-radius:50%;box-shadow:inset 0 14px 0 #ffdf80}
.cone{position:absolute;top:-10%;width:32%;height:120%;background:linear-gradient(rgba(255,246,227,.22),transparent 76%);clip-path:polygon(44% 0,56% 0,100% 100%,0 100%);left:34%;pointer-events:none}
.ch{position:relative;width:clamp(120px,13vw,250px);text-align:center;z-index:2}.ch.sel:after{content:"";position:absolute;left:8%;right:8%;bottom:48px;height:22px;background:rgba(29,23,51,.35);border-radius:50%;z-index:-1}
.ch .plate{position:absolute;left:50%;transform:translateX(-50%);bottom:-62px;background:var(--ink);color:var(--paper);border-radius:12px;padding:5px 12px;white-space:nowrap;font:600 15px Bricolage}.plate small{display:block;font:400 11px "DM Sans";opacity:.8}
.add{width:clamp(120px,12vw,210px);aspect-ratio:3/4;border:4px dashed var(--ink);border-radius:26px;background:rgba(255,246,227,.16);display:grid;place-items:center;align-self:flex-end;font:800 19px Bricolage;color:var(--paper);z-index:2;margin-bottom:6px}.add b{display:block;font-size:48px;line-height:1;color:var(--floor)}
.dock{position:relative;z-index:3;display:flex;align-items:center;gap:12px;justify-content:center;background:var(--ink);padding:14px 24px}
.play{width:76px;height:76px;margin-top:-34px;border-radius:50%;border:5px solid var(--ink);background:var(--floor);color:var(--ink);font-size:28px;box-shadow:0 6px 0 #b9851a}
.sheet{position:absolute;right:24px;top:84px;bottom:112px;width:400px;background:var(--paper);color:var(--ink);border-radius:26px;padding:20px;z-index:4;box-shadow:0 18px 50px rgba(0,0,0,.4)}
.sheet h2{font-size:30px}.tabs{display:flex;gap:6px;margin:12px 0}.tabs b{padding:7px 12px;border-radius:10px;font-size:14px}.tabs b.is{background:var(--ink);color:var(--paper)}
.steps{display:grid;grid-template-columns:repeat(16,1fr);gap:3px;margin:3px 0 8px}.steps i{height:24px;border-radius:5px;background:#eadfc6}.steps i.beat{background:#ddcfaf}.steps i.on{background:var(--pop)}
.lab{font-size:12px;font-weight:700;margin-top:6px}
.browse{padding:18px 32px;background:var(--wall2);flex:1;display:flex;flex-direction:column;gap:14px}.browse h1{font-size:50px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.chip{border:2px solid var(--line);background:transparent;border-radius:99px;padding:8px 14px;color:var(--paper)}.chip.is{background:var(--floor);color:var(--ink);border-color:var(--floor);font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}.card{background:#34297f;border-radius:22px;padding:12px;text-align:center;position:relative}.card .fig{height:170px;display:flex;justify-content:center}.card .fig .figure{height:100%;width:auto}.card b{display:block;font:800 19px Bricolage}.card small{opacity:.8;font-size:12.5px}.card.new{background:var(--floor);color:var(--ink);display:grid;place-items:center;font:800 24px Bricolage}.card.new span{font-size:58px;line-height:1;display:block}
.creator{flex:1;display:grid;grid-template-columns:1.05fr 1fr;background:var(--wall2)}.dress{background:radial-gradient(50% 70% at 50% 30%,#8a6dff,#3a2aa0 75%);display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding:18px 18px 28px;position:relative;overflow:hidden}.dress .big{width:min(58%,420px)}.dress:before{content:"";position:absolute;left:-20%;right:-20%;bottom:-120px;height:230px;background:var(--floor);border-radius:50%}.dress>*{position:relative}.dress .name{font:800 40px Bricolage;background:var(--ink);padding:6px 20px;border-radius:14px;margin-top:6px}
.tools{padding:22px 28px;display:flex;flex-direction:column;gap:12px;background:var(--paper);color:var(--ink);overflow:auto}.tools h2{font-size:34px}.opts{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px}.opt{background:#f1e6cd;border:0;border-radius:14px;padding:6px;font-size:12px;font-weight:700;color:var(--ink)}.opt.is-on,.pick.is-on{outline:3px solid var(--ink)}.opt .figure{height:74px;width:auto;margin:auto}
.sw{display:flex;gap:6px;flex-wrap:wrap}.sw i{width:30px;height:30px;border-radius:50%;border:3px solid var(--ink)}
@media(max-width:760px){.top{padding:10px 14px;gap:8px}.mix{font-size:21px}.tag,.top .btn.ghost,.logo{display:none}.stage{flex-wrap:wrap;justify-content:center;padding:18px 8px 100px;gap:8px 0;align-content:flex-end;min-height:0}.ch{width:31%}.ch .plate{font-size:12px;bottom:-30px;padding:2px 7px}.ch .plate small{display:none}.add{width:31%;aspect-ratio:3/4;font-size:14px}.add b{font-size:32px}.sheet{display:none}.dock{padding:10px}.dock .btn{padding:10px 9px;font-size:13px}.play{width:64px;height:64px}
.browse{padding:12px 14px}.browse h1{font-size:30px}.grid{grid-template-columns:1fr 1fr;gap:8px}.card .fig{height:120px}.creator{grid-template-columns:1fr}.dress{min-height:300px}.dress .big{width:44%}.dress .name{font-size:24px}.tools{padding:14px}.tools h2{font-size:24px}.opts{grid-template-columns:repeat(4,1fr)}.steps i{height:18px}}`;
  const top=`<div class="top"><span class="logo">Ensemble</span><span class="mix">Velvet Parade</span><span class="tag">Private</span><span class="sp"></span><div class="faces"><b>AD</b><b>MK</b><b>JO</b></div><button class="btn ghost">Chat</button><button class="btn">Invite</button></div>`;
  const dock=`<div class="dock"><button class="btn ghost" data-go="browse">Cast</button><button class="btn ghost">Sections</button><button class="play" aria-label="Play">▶</button><button class="btn ghost">Sound on</button><button class="btn ghost">Go live</button></div>`;
  const stage=`<section class="screen s-stage">${top}<div class="stage"><div class="cone"></div>${BAND.map((p,i)=>`<div class="ch ${i===1?'sel':''}">${fig(p.look)}<div class="plate">${p.name}<small>${ROLE_LABEL[p.role]} · Maya</small></div></div>`).join('')}<button class="add" data-go="browse"><span><b>+</b>Add a<br>character</span></button>
    <aside class="sheet"><h2>${BAND[1].name}</h2><p style="margin:2px 0 0;font-size:14px">Bass · added by Maya</p><div class="tabs"><b class="is">Pattern</b><b>Shape</b><b>Code</b><b>Look</b></div>${KIT.map(([n,h])=>`<div class="lab">${n}</div><div class="steps">${steps(h)}</div>`).join('')}<button class="btn" style="background:var(--ink);color:var(--paper);width:100%">Apply to mix</button></aside></div>${dock}</section>`;
  const browse=`<section class="screen s-browse">${top}<div class="browse"><h1>Who joins the band?</h1><div class="row">${PACKS.slice(0,6).map((p,i)=>`<button class="chip ${i===3?'is':''}">${p.name}</button>`).join('')}</div><div class="row">${['All','Beats','Bass','Melody','Texture'].map((r,i)=>`<button class="chip ${i===0?'is':''}">${r}</button>`).join('')}<span class="sp"></span><input aria-label="Search" placeholder="Search the cast" style="border-radius:12px;border:2px solid var(--line);background:transparent;color:inherit;padding:9px 12px"></div><div class="grid"><button class="card new" data-go="creator"><span><span>+</span>Create character</span></button>${BROWSE.map(p=>`<div class="card"><div class="fig">${fig(p.look)}</div><b>${p.name}</b><small>${ROLE_LABEL[p.role]} · ${p.blurb}</small></div>`).join('')}</div></div>${dock}</section>`;
  const creator=`<section class="screen s-creator">${top}<div class="creator"><div class="dress"><div class="big">${fig(HERO)}</div><div class="name">Pocket Rocket</div></div><div class="tools"><div class="tabs"><b class="is">Body</b><b>Face</b><b>Headwear</b><b>Clothes</b><b>Props</b><b>Colours</b><b>Music</b></div><h2>Pick a body</h2><div class="opts">${BODIES.slice(0,12).map((b,i)=>`<button class="opt pick ${b==='critter'?'is-on':''}">${fig({...HERO,body:b,prop:'none'})}${LOOK_LABEL.body[b]}</button>`).join('')}</div><div class="sw">${SWATCHES.slice(0,12).map(s=>`<i style="background:${SWATCH_HEX[s]}"></i>`).join('')}</div><div class="row"><button class="btn" style="background:var(--ink);color:var(--paper)">Save character</button><button class="btn ghost" style="color:var(--ink);box-shadow:inset 0 0 0 2px var(--ink)">Surprise me</button></div></div></div></section>`;
  return shell('Direction 1 · Main Stage',fonts,css,stage+browse+creator);
}

// --- 2. Coin-Op: a collectible arcade cabinet -------------------------------
function coinOp(){
  const fonts=FONT('Bungee','bungee-400.woff2',400)+FONT('Chakra','chakra-500.woff2',500)+FONT('Chakra','chakra-700.woff2',700);
  const css=`:root{--bg:#0d0a1c;--cab:#191233;--scr:#0a2a33;--a:#29f0c4;--b:#ff3d81;--c:#ffe14d;--t:#e9fff8}
body{font-family:Chakra,sans-serif;background:var(--bg);color:var(--t)}
.screen{min-height:100vh;flex-direction:column;padding:14px;gap:12px}
.marquee{font:400 clamp(22px,3vw,46px) Bungee;text-align:center;color:var(--c);text-shadow:0 0 18px rgba(255,225,77,.7),3px 3px 0 var(--b);background:linear-gradient(#2a1a5e,#191233);border:4px solid var(--b);border-radius:14px;padding:6px}
.cab{flex:1;display:grid;grid-template-columns:1fr 330px;gap:12px;min-height:0}
.crt{background:repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0 2px,transparent 2px 5px),radial-gradient(circle at 50% 40%,#123f4a,var(--scr));border:10px solid #000;border-radius:26px;box-shadow:inset 0 0 70px #000,0 0 0 4px var(--a);padding:18px;display:grid;grid-template-columns:repeat(6,1fr);grid-template-rows:repeat(2,1fr);gap:10px}
.slot{border:3px solid rgba(41,240,196,.45);border-radius:10px;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding:6px;background:rgba(0,0,0,.25);min-height:0}.slot .n{position:absolute;left:6px;top:4px;font:400 12px Bungee;color:var(--a)}.slot.full{border-color:var(--c);background:rgba(255,225,77,.08)}.slot canvas{height:min(100%,190px);image-rendering:pixelated}.slot .figure{height:150px;width:auto}.slot b{font:400 12px Bungee;color:var(--c);text-align:center}.slot.empty{color:rgba(41,240,196,.7);font:400 13px Bungee;align-items:center;justify-content:center}
.panel{background:var(--cab);border:4px solid #000;border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:12px;box-shadow:inset 0 0 0 3px #30235f}
.btns{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.arc{aspect-ratio:1;border-radius:50%;border:0;font:400 11px Bungee;color:#120c28;box-shadow:0 7px 0 rgba(0,0,0,.65),inset 0 -6px 0 rgba(0,0,0,.2);display:grid;place-items:center}.arc.a{background:var(--a)}.arc.b{background:var(--b)}.arc.c{background:var(--c)}
.big{font:400 22px Bungee;background:var(--c);color:#120c28;border:0;border-radius:14px;padding:14px;box-shadow:0 7px 0 #a8870f}
.key{background:#2a1f55;border:0;border-radius:10px;padding:10px;color:var(--t);font-weight:700;box-shadow:0 5px 0 #000}
.steps{display:grid;grid-template-columns:repeat(16,1fr);gap:2px;margin:2px 0 6px}.steps i{height:18px;background:#1f3a44;border-radius:2px}.steps i.beat{background:#2c5261}.steps i.on{background:var(--a);box-shadow:0 0 8px var(--a)}
h2{font:400 18px Bungee;color:var(--a);margin:0}
.cards{flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;align-content:start}.tcard{background:linear-gradient(160deg,#2a1f55,#191233);border:3px solid var(--a);border-radius:12px;padding:8px;text-align:center}.tcard canvas,.tcard .figure{height:130px;width:auto;image-rendering:pixelated;margin:auto;display:block}.tcard b{font:400 13px Bungee;color:var(--c);display:block}.tcard small{color:var(--a);font-weight:700}.tcard.new{border-color:var(--b);border-style:dashed;display:grid;place-items:center;font:400 16px Bungee;color:var(--b)}
.row{display:flex;gap:8px;flex-wrap:wrap}
.make{flex:1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}.preview{display:grid;place-items:center;background:var(--scr);border:10px solid #000;border-radius:26px;box-shadow:0 0 0 4px var(--b)}.preview canvas,.preview .figure{height:min(70vh,560px);width:auto;image-rendering:pixelated}
.opts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.opt{background:#2a1f55;border:3px solid #453a80;border-radius:10px;padding:4px;color:var(--t);font-size:12px}.opt canvas,.opt .figure{height:66px;width:auto;margin:auto;display:block;image-rendering:pixelated}.opt.is-on{border-color:var(--c)}
@media(max-width:760px){.screen{padding:8px;gap:8px}.cab,.make{grid-template-columns:1fr}.crt{grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,120px);padding:8px;border-width:6px}.slot canvas,.slot .figure{height:82px}.slot b{font-size:9px}.cards{grid-template-columns:1fr 1fr}.arc{font-size:9px}.preview canvas,.preview .figure{height:230px}.btns{grid-template-columns:repeat(4,1fr)}.btns .arc:nth-child(n+5){display:none}}`;
  const px=(look)=>`<div class="px">${fig(look)}</div>`;
  const slots=Array.from({length:12},(_,i)=>{const p=BAND[i];return p?`<div class="slot full"><span class="n">${String(i+1).padStart(2,'0')}</span>${px(p.look)}<b>${p.name}</b></div>`:i===BAND.length?`<button class="slot empty" data-go="browse" style="color:#29f0c4;background:none">+ INSERT<br>CHARACTER</button>`:`<div class="slot"><span class="n">${String(i+1).padStart(2,'0')}</span></div>`;}).join('');
  const stage=`<section class="screen s-stage"><div class="marquee">ENSEMBLE · VELVET PARADE</div><div class="cab"><div class="crt">${slots}</div><div class="panel"><button class="big">▶ PLAY</button><div class="btns"><button class="arc a" data-go="browse">CAST</button><button class="arc b">LIVE</button><button class="arc c">CHAT</button><button class="arc c">INVITE</button><button class="arc a">SCENES</button><button class="arc b">EXPORT</button></div><h2>P2 ${BAND[1].name}</h2>${KIT.map(([n,h])=>`<div style="font-size:12px">${n}</div><div class="steps">${steps(h)}</div>`).join('')}<div class="row"><button class="key">3 PLAYERS HERE</button><button class="key">PRIVATE</button></div></div></div></section>`;
  const browse=`<section class="screen s-browse"><div class="marquee">SELECT YOUR CHARACTER</div><div class="row">${PACKS.slice(0,6).map(p=>`<button class="key">${p.name}</button>`).join('')}</div><div class="cards"><button class="tcard new" data-go="creator">+ NEW<br>CHARACTER</button>${BROWSE.map(p=>`<div class="tcard">${px(p.look)}<b>${p.name}</b><small>${ROLE_LABEL[p.role].toUpperCase()}</small></div>`).join('')}</div></section>`;
  const creator=`<section class="screen s-creator"><div class="marquee">BUILD A PLAYER</div><div class="make"><div class="preview">${px(HERO)}</div><div class="panel"><h2>Body</h2><div class="opts">${BODIES.slice(0,12).map(b=>`<button class="opt pick ${b==='critter'?'is-on':''}">${px({...HERO,body:b,prop:'none'})}${LOOK_LABEL.body[b]}</button>`).join('')}</div><h2>Rhythm</h2><div class="steps">${steps([0,3,6,10,12])}</div><button class="big">SAVE</button></div></div></section>`;
  const script=`document.querySelectorAll('.px').forEach(async el=>{const svg=el.querySelector('svg');const w=46,h=64;const s=new XMLSerializer().serializeToString(svg).replace('<svg','<svg width="'+w+'" height="'+h+'"');const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(s);await img.decode();const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);el.replaceWith(c);});`;
  return shell('Direction 2 · Coin-Op',fonts,css,stage+browse+creator,script);
}

// --- 3. Workbench: a warm, cut-paper workshop -------------------------------
function workbench(){
  const fonts=FONT('Fraunces','fraunces-700.woff2',700)+FONT('Nunito','nunito-400.woff2',400)+FONT('Nunito','nunito-700.woff2',700)+FONT('Caveat','caveat-700.woff2',700);
  const css=`:root{--paper:#f6ecd9;--desk:#e9d8b9;--brown:#5b4636;--red:#d9553b;--green:#3f8a6b;--note:#fff9d6}
body{font-family:Nunito,sans-serif;color:var(--brown);background:var(--desk) radial-gradient(rgba(91,70,54,.08) 1px,transparent 1.5px) 0 0/14px 14px}
.screen{min-height:100vh}
h1,h2{font-family:Fraunces,serif;margin:0}.hand{font:700 22px Caveat;color:var(--red)}
.figure{filter:drop-shadow(3px 0 0 #fff) drop-shadow(-3px 0 0 #fff) drop-shadow(0 3px 0 #fff) drop-shadow(0 -3px 0 #fff) drop-shadow(3px 6px 4px rgba(91,70,54,.42))}.figure [stroke="#1d1733"]{stroke:#4a3528}
.side{width:300px;background:var(--paper);border-right:2px dashed rgba(91,70,54,.4);padding:18px;display:flex;flex-direction:column;gap:12px}
.main{flex:1;padding:20px 26px;display:flex;flex-direction:column;gap:16px;min-width:0}
.tab{display:block;width:100%;text-align:left;background:#fff;border:2px solid var(--brown);border-radius:6px 16px 6px 16px;padding:10px 12px;font-weight:700;box-shadow:3px 3px 0 rgba(91,70,54,.3)}.tab.main-a{background:var(--red);color:#fff}
.shelf{flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:0}.band{display:flex;align-items:flex-end;justify-content:center;gap:clamp(2px,1.2vw,22px)}.ch{width:clamp(100px,12vw,220px);text-align:center;transform:rotate(var(--r))}.ch b{font:700 24px Caveat;display:block}.board{height:26px;background:#a8794e;border-radius:4px;box-shadow:0 8px 0 #7e5a39,0 16px 18px rgba(91,70,54,.35)}
.notes{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start}.note{background:var(--note);padding:12px 14px;transform:rotate(-1.2deg);box-shadow:2px 4px 6px rgba(91,70,54,.3);width:300px}.note.play{background:#fff;transform:rotate(1deg)}
.steps{display:grid;grid-template-columns:repeat(16,1fr);gap:2px;margin:2px 0 6px}.steps i{height:18px;border:1.5px solid var(--brown);border-radius:50%;background:#fff}.steps i.on{background:var(--red)}
.bigbtn{background:var(--green);color:#fff;border:0;border-radius:40px 34px 42px 30px;padding:12px 26px;font:700 22px Fraunces;box-shadow:3px 4px 0 rgba(91,70,54,.5)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:18px}.tile{background:#fff;padding:8px 8px 4px;box-shadow:2px 3px 7px rgba(91,70,54,.35);text-align:center;transform:rotate(var(--r,-1deg))}.tile .figure{height:140px;width:auto;margin:auto}.tile b{font:700 22px Caveat;display:block}.tile small{font-size:12px}.tile.new{background:var(--red);color:#fff;display:grid;place-items:center;font:700 26px Caveat}
.bench{display:grid;grid-template-columns:1fr 1fr;gap:20px;flex:1}.mat{background:#3f8a6b repeating-linear-gradient(0deg,rgba(255,255,255,.1) 0 1px,transparent 1px 28px),repeating-linear-gradient(90deg,rgba(255,255,255,.1) 0 1px,transparent 1px 28px);border-radius:14px;display:grid;place-items:center;padding:12px}.mat .figure{height:min(68vh,540px);width:auto}.drawers{background:var(--paper);border-radius:12px;padding:14px;box-shadow:3px 4px 0 rgba(91,70,54,.35);display:flex;flex-direction:column;gap:10px}
.opts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.opt{background:#fff;border:2px dashed rgba(91,70,54,.5);border-radius:10px;padding:4px;font-weight:700;font-size:12px}.opt .figure{height:64px;width:auto;margin:auto;filter:none}.opt.is-on{border-style:solid;border-color:var(--red)}
.s-stage,.s-browse,.s-creator{flex-direction:row}
@media(max-width:760px){.s-stage,.s-browse,.s-creator{flex-direction:column}.side{width:auto;border-right:0;border-bottom:2px dashed rgba(91,70,54,.4);padding:10px;flex-direction:row;overflow:auto}.side h1,.side .hand,.side .hide{display:none}.tab{white-space:nowrap;width:auto;padding:8px}.main{padding:12px}.band{flex-wrap:wrap}.ch{width:30%}.ch b{font-size:17px}.note{width:100%}.grid{grid-template-columns:1fr 1fr;gap:10px}.bench{grid-template-columns:1fr}.mat .figure{height:240px}}`;
  const side=`<aside class="side"><h1>Ensemble</h1><p class="hand">Velvet Parade</p><button class="tab main-a" data-go="creator">✂ Make a character</button><button class="tab" data-go="browse">The cast drawer</button><button class="tab" data-go="stage">The shelf</button><button class="tab hide">Sections</button><button class="tab hide">Friends (3 here)</button><button class="tab hide">Chat</button></aside>`;
  const stage=`<section class="screen s-stage">${side}<div class="main"><div class="notes"><div class="note"><span class="hand">${BAND[1].name}'s beat</span>${KIT.map(([n,h])=>`<div style="font-size:12px;font-weight:700">${n}</div><div class="steps">${steps(h)}</div>`).join('')}</div><div class="note play"><button class="bigbtn">▶ Play the shelf</button><p style="margin:8px 0 0;font-size:14px">Maya is hosting · private mix</p></div></div><div class="shelf"><div class="band">${BAND.map((p,i)=>`<div class="ch" style="--r:${[-2,1.5,-1,2,-1.5][i]}deg">${fig(p.look)}<b>${p.name}</b></div>`).join('')}</div><div class="board"></div></div></div></section>`;
  const browse=`<section class="screen s-browse">${side}<div class="main"><h1 style="font-size:40px">The cast drawer</h1><p class="hand">${PACKS[3].name} · ${PACKS[3].mood}</p><div class="grid"><button class="tile new" data-go="creator" style="border:0">✂ cut a new one</button>${BROWSE.map((p,i)=>`<div class="tile" style="--r:${(i%3-1)*1.2}deg">${fig(p.look)}<b>${p.name}</b><small>${ROLE_LABEL[p.role]}</small></div>`).join('')}</div></div></section>`;
  const creator=`<section class="screen s-creator">${side}<div class="main"><div class="bench"><div class="mat">${fig(HERO)}</div><div class="drawers"><h2>Bodies</h2><div class="opts">${BODIES.slice(0,12).map(b=>`<button class="opt pick ${b==='critter'?'is-on':''}">${fig({...HERO,body:b,prop:'none'})}${LOOK_LABEL.body[b]}</button>`).join('')}</div><h2>Its beat</h2><div class="steps">${steps([0,3,6,10,12])}</div><button class="bigbtn">Pin it to the shelf</button></div></div></div></section>`;
  return shell('Direction 3 · Workbench',fonts,css,stage+browse+creator);
}

const dirs=[['1-main-stage',mainStage],['2-coin-op',coinOp],['3-workbench',workbench]];
const browser=await chromium.launch();
for(const [name,build] of dirs){
  const dir=`docs/design/${name}`;mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/index.html`,build());
  const url=pathToFileURL(resolve(dir,'index.html')).href;
  for(const [screen,width,height,label] of [['stage',1920,1080,'desktop-stage'],['browse',1920,1080,'desktop-browse'],['creator',1920,1080,'desktop-creator'],['stage',390,844,'phone-stage'],['browse',390,844,'phone-browse'],['creator',390,844,'phone-creator']]){
    const page=await browser.newPage({viewport:{width,height}});await page.goto(`${url}#${screen}`);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);
    await page.screenshot({path:`${dir}/${label}.png`});
    if(label==='desktop-stage')console.log(name,'overflow',await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
    await page.close();
  }
}
await browser.close();
