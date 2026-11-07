// A character's appearance as data. A look is only ever a set of allowlisted
// ids: there is no markup, path, URL or free colour anywhere in it, so a shared
// character cannot carry anything executable. client/performer.ts draws it.
export const BODIES=['bean','tower','boulder','pear','robot','ghost','bird','critter','octo','cactus','speaker','mushroom','moon','flame','cloud','drop'] as const;
export const EYES=['dots','wide','sleepy','sparkle','shades','cyclops','fierce','wink','visor'] as const;
export const MOUTHS=['smile','sing','ooh','grin','flat','tongue','fangs','moustache'] as const;
export const TOPS=['none','beanie','cap','tophat','crown','mohawk','afro','bun','spikes','antenna','headphones','bow','sprout','partyhat','horns','halo','bucket','ears'] as const;
export const WEARS=['plain','stripes','dots','overalls','jacket','sash','check','zigzag','stars','belly'] as const;
export const PROPS=['none','mic','sticks','keytar','bass','maracas','tambourine','scarf','bowtie','medal','cape','backpack'] as const;
export const SWATCHES=['tomato','coral','peach','sun','lime','mint','teal','sky','cobalt','violet','plum','pink','cream','sand','clay','slate','ink','snow'] as const;

export type Body=typeof BODIES[number];
export type Eyes=typeof EYES[number];
export type Mouth=typeof MOUTHS[number];
export type Top=typeof TOPS[number];
export type Wear=typeof WEARS[number];
export type Prop=typeof PROPS[number];
export type Swatch=typeof SWATCHES[number];
export type Look={v:1;body:Body;eyes:Eyes;mouth:Mouth;top:Top;wear:Wear;prop:Prop;skin:Swatch;cloth:Swatch;trim:Swatch};

// Colours are named by id everywhere and resolved to a value only when drawn.
export const SWATCH_HEX:Record<Swatch,string>={
  tomato:'#f0563f',coral:'#ff8a6b',peach:'#ffc09a',sun:'#ffcb3d',lime:'#c6e84e',mint:'#6fdca8',teal:'#1fb3a6',sky:'#7cc8f5',cobalt:'#3f6df0',
  violet:'#8f6cf0',plum:'#7a3f9e',pink:'#ff8fc0',cream:'#fff1d6',sand:'#e3c79a',clay:'#b0694a',slate:'#5c6b86',ink:'#2a2342',snow:'#f7f6fb',
};
export const LOOK_LABEL={
  body:{bean:'Bean',tower:'Tall one',boulder:'Boulder',pear:'Pear',robot:'Robot',ghost:'Ghost',bird:'Bird',critter:'Critter',octo:'Octopus',cactus:'Cactus',speaker:'Speaker',mushroom:'Mushroom',moon:'Moon',flame:'Flame',cloud:'Cloud',drop:'Droplet'},
  eyes:{dots:'Dots',wide:'Wide',sleepy:'Sleepy',sparkle:'Sparkle',shades:'Shades',cyclops:'One eye',fierce:'Fierce',wink:'Wink',visor:'Visor'},
  mouth:{smile:'Smile',sing:'Singing',ooh:'Ooh',grin:'Grin',flat:'Deadpan',tongue:'Tongue out',fangs:'Fangs',moustache:'Moustache'},
  top:{none:'Nothing',beanie:'Beanie',cap:'Cap',tophat:'Top hat',crown:'Crown',mohawk:'Mohawk',afro:'Big hair',bun:'Bun',spikes:'Spikes',antenna:'Antenna',headphones:'Headphones',bow:'Bow',sprout:'Sprout',partyhat:'Party hat',horns:'Horns',halo:'Halo',bucket:'Bucket hat',ears:'Round ears'},
  wear:{plain:'Bare',stripes:'Stripes',dots:'Spots',overalls:'Overalls',jacket:'Jacket',sash:'Sash',check:'Checks',zigzag:'Zigzag',stars:'Stars',belly:'Round belly'},
  prop:{none:'Nothing',mic:'Microphone',sticks:'Drumsticks',keytar:'Keytar',bass:'Bass guitar',maracas:'Maracas',tambourine:'Tambourine',scarf:'Scarf',bowtie:'Bow tie',medal:'Medal',cape:'Cape',backpack:'Speaker pack'},
  swatch:{tomato:'Tomato',coral:'Coral',peach:'Peach',sun:'Sun',lime:'Lime',mint:'Mint',teal:'Teal',sky:'Sky',cobalt:'Cobalt',violet:'Violet',plum:'Plum',pink:'Pink',cream:'Cream',sand:'Sand',clay:'Clay',slate:'Slate',ink:'Ink',snow:'Snow'},
} as const;

const FIELDS:[keyof Look,readonly string[]][]=[['body',BODIES],['eyes',EYES],['mouth',MOUTHS],['top',TOPS],['wear',WEARS],['prop',PROPS],['skin',SWATCHES],['cloth',SWATCHES],['trim',SWATCHES]];
export const BLANK_LOOK:Look={v:1,body:'bean',eyes:'dots',mouth:'smile',top:'none',wear:'plain',prop:'none',skin:'sand',cloth:'slate',trim:'cream'};

// Everything arriving from a request, an import or a saved row passes here.
// Unknown keys are dropped: only the fields below ever reach storage.
export function validLook(input:unknown):Look|null{
  if(!input||typeof input!=='object'||(input as {v?:unknown}).v!==1)return null;
  const out:Record<string,unknown>={v:1};
  for(const [key,allowed] of FIELDS){const value=(input as Record<string,unknown>)[key];if(typeof value!=='string'||!allowed.includes(value))return null;out[key]=value;}
  return out as Look;
}
// A deterministic generator, so a seed always draws the same character on every
// client and the result is an ordinary, editable look.
function rng(seed:string){let h=2166136261;for(let i=0;i<seed.length;i++){h^=seed.charCodeAt(i);h=Math.imul(h,16777619);}return ()=>{h=(h+0x6D2B79F5)|0;let t=Math.imul(h^(h>>>15),1|h);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
const BRIGHT_SKINS:Swatch[]=['tomato','coral','peach','sun','lime','mint','teal','sky','violet','pink','cream','sand'];
export function randomLook(seed:string):Look{
  const r=rng(seed),pick=<T,>(list:readonly T[])=>list[Math.floor(r()*list.length)];
  const skin=pick(BRIGHT_SKINS),others=SWATCHES.filter(x=>x!==skin&&x!=='snow');
  return {v:1,body:pick(BODIES),eyes:pick(EYES),mouth:pick(MOUTHS),top:pick(TOPS),wear:pick(WEARS),prop:pick(PROPS),skin,cloth:pick(others),trim:pick(others)};
}
// Parts saved before looks existed have none stored. They get one derived from
// their id and role, computed on display and never written back.
const ROLE_LOOK:Record<string,Partial<Look>>={beats:{top:'headphones',prop:'sticks'},bass:{eyes:'visor',prop:'bass'},melody:{top:'mohawk',prop:'mic'},texture:{top:'halo',prop:'none'}};
export function defaultLook(role:string,seed:string):Look{
  return {...randomLook(`${role}:${seed}`),...(ROLE_LOOK[role]??{prop:'none' as Prop})};
}
