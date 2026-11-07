// Original characters, drawn from a Look. Each body is its own silhouette with
// its own anchors, so hats, faces and props sit where that body needs them
// instead of one rounded figure being redressed. Everything drawn comes from
// the constants in this file and the allowlisted ids in shared/look.ts; nothing
// from a look is ever pasted into the markup as text.
import type {Role} from '../shared/presets.ts';
import {SWATCH_HEX,defaultLook,type Look as CharacterLook,type Body} from '../shared/look.ts';
export type Look=Role|'custom';

const INK='#1d1733';
const W=6; // outline weight, in a 200×250 drawing

type Anchor={x:number;y:number;s:number};
type Arm={from:[number,number];path:string;hand:[number,number]};
type Shape={
  body:string;                       // the silhouette; wear is clipped to it
  shade:string;                      // a darker side, for depth
  back?:string;                      // drawn behind the body in the skin colour
  front?:string;                     // details over the body
  feet:'stubby'|'long'|'hover'|'tentacles'|'pot'|'bird'|'block'|'drips';
  face:Anchor;                       // eyes and mouth
  top:Anchor;                        // headwear
  neck:Anchor;                       // scarves, ties
  chest:Anchor;                      // medals, instruments
  armL?:Arm;armR?:Arm;armKind:'tube'|'wing'|'robot'|'nub';
};
const arm=(from:[number,number],mid:[number,number],hand:[number,number]):Arm=>({from,path:`M${from[0]} ${from[1]}Q${mid[0]} ${mid[1]} ${hand[0]} ${hand[1]}`,hand});
const SHAPES:Record<Body,Shape>={
  bean:{body:'M100 40C148 40 160 86 160 130C160 180 146 216 100 216C54 216 40 180 40 130C40 86 52 40 100 40Z',shade:'M128 50C150 66 160 96 160 130C160 180 146 216 100 216C88 216 78 214 70 208C118 210 142 160 128 50Z',
    feet:'stubby',face:{x:100,y:102,s:1},top:{x:100,y:46,s:1},neck:{x:100,y:150,s:1},chest:{x:100,y:172,s:1},armL:arm([44,136],[18,150],[24,184]),armR:arm([156,136],[182,150],[176,184]),armKind:'tube'},
  tower:{body:'M72 14H128Q144 14 144 30V172Q144 188 128 188H72Q56 188 56 172V30Q56 14 72 14Z',shade:'M124 14H128Q144 14 144 30V172Q144 188 128 188H112Q130 120 124 14Z',
    feet:'long',face:{x:100,y:66,s:.92},top:{x:100,y:20,s:.86},neck:{x:100,y:112,s:.9},chest:{x:100,y:142,s:.9},armL:arm([60,104],[26,120],[34,170]),armR:arm([140,104],[174,120],[166,170]),armKind:'tube'},
  boulder:{body:'M36 118C30 80 62 58 98 62C138 56 172 76 174 118C182 164 170 216 128 222C96 228 54 226 40 202C28 180 32 146 36 118Z',shade:'M140 66C160 78 172 94 174 118C182 164 170 216 128 222C110 226 92 226 78 224C136 210 160 150 140 66Z',
    feet:'stubby',face:{x:100,y:122,s:1.08},top:{x:100,y:68,s:1.12},neck:{x:100,y:176,s:1.1},chest:{x:100,y:190,s:1},armL:arm([40,146],[4,176],[20,226]),armR:arm([170,146],[196,176],[180,226]),armKind:'tube'},
  pear:{body:'M100 42C130 42 138 70 136 96C136 120 174 138 174 180C174 216 136 224 100 224C64 224 26 216 26 180C26 138 64 120 64 96C62 70 70 42 100 42Z',shade:'M124 50C136 66 136 84 136 96C136 120 174 138 174 180C174 216 136 224 100 224C92 224 84 224 78 222C128 212 150 170 118 124C110 104 128 80 124 50Z',
    feet:'stubby',face:{x:100,y:88,s:.84},top:{x:100,y:48,s:.8},neck:{x:100,y:130,s:.8},chest:{x:100,y:178,s:1.05},armL:arm([46,150],[14,170],[20,202]),armR:arm([154,150],[186,170],[180,202]),armKind:'tube'},
  robot:{body:'M62 26H138Q150 26 150 38V92Q150 104 138 104H112V116H130Q142 116 142 128V196Q142 208 130 208H70Q58 208 58 196V128Q58 116 70 116H88V104H62Q50 104 50 92V38Q50 26 62 26Z',shade:'M128 26H138Q150 26 150 38V92Q150 104 138 104H124Q136 66 128 26ZM122 116H130Q142 116 142 128V196Q142 208 130 208H112Q130 170 122 116Z',
    front:`<circle cx="74" cy="186" r="5" fill="${INK}"/><circle cx="92" cy="186" r="5" fill="${INK}"/><path d="M112 186h16" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
    feet:'block',face:{x:100,y:62,s:.94},top:{x:100,y:30,s:.92},neck:{x:100,y:118,s:.72},chest:{x:100,y:154,s:.9},armL:arm([60,132],[28,136],[28,178]),armR:arm([140,132],[172,136],[172,178]),armKind:'robot'},
  ghost:{body:'M100 26C152 26 166 70 166 118V214Q155 198 144 214Q133 230 122 214Q111 198 100 214Q89 230 78 214Q67 198 56 214Q45 230 34 214V118C34 70 48 26 100 26Z',shade:'M132 36C154 52 166 84 166 118V214Q155 198 144 214Q133 230 122 214C150 170 152 90 132 36Z',
    feet:'hover',face:{x:100,y:100,s:1.02},top:{x:100,y:32,s:1},neck:{x:100,y:146,s:1},chest:{x:100,y:172,s:1},armL:arm([40,126],[14,126],[18,102]),armR:arm([160,126],[186,126],[182,102]),armKind:'nub'},
  bird:{body:'M100 48C156 48 176 96 176 140C176 192 142 216 100 216C58 216 24 192 24 140C24 96 44 48 100 48Z',shade:'M136 58C160 76 176 106 176 140C176 192 142 216 100 216C90 216 80 214 72 212C136 206 160 128 136 58Z',
    back:'M36 180L10 200L46 204Z',front:`<path d="M84 118H116L100 138Z" fill="#ffcb3d" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
    feet:'bird',face:{x:100,y:106,s:1},top:{x:100,y:54,s:1},neck:{x:100,y:152,s:1.05},chest:{x:100,y:170,s:1},armL:arm([30,136],[2,150],[10,186]),armR:arm([170,136],[198,150],[190,186]),armKind:'wing'},
  critter:{body:'M58 56L48 12L92 36Q100 34 108 36L152 12L142 56C160 78 158 112 134 128C152 146 158 180 150 216H50C42 180 48 146 66 128C42 112 40 78 58 56Z',shade:'M138 44L152 12L142 56C160 78 158 112 134 128C152 146 158 180 150 216H118C138 170 132 150 114 126C146 112 150 74 138 44Z',
    back:'M146 196C186 196 196 160 176 142C168 136 158 142 164 152C176 164 164 180 142 178Z',front:`<path d="M63 44L58 26L76 37ZM137 44L142 26L124 37Z" fill="${INK}" opacity=".28"/>`,
    feet:'stubby',face:{x:100,y:86,s:.94},top:{x:100,y:38,s:.72},neck:{x:100,y:130,s:.82},chest:{x:100,y:174,s:.95},armL:arm([60,150],[26,166],[34,196]),armR:arm([140,150],[172,160],[166,196]),armKind:'tube'},
  octo:{body:'M100 28C154 28 174 72 174 114C174 140 164 156 150 166H50C36 156 26 140 26 114C26 72 46 28 100 28Z',shade:'M138 38C160 54 174 82 174 114C174 140 164 156 150 166H118C150 130 152 84 138 38Z',
    feet:'tentacles',face:{x:100,y:106,s:1.04},top:{x:100,y:34,s:1.02},neck:{x:100,y:160,s:1},chest:{x:100,y:150,s:.8},armKind:'nub'},
  cactus:{body:'M72 58Q72 22 100 22Q128 22 128 58V210H72Z',shade:'M112 26Q128 32 128 58V210H106Q124 120 112 26Z',
    front:`<path d="M84 150v18M100 164v18M116 150v18" stroke="${INK}" stroke-width="4" stroke-linecap="round" opacity=".35"/>`,
    feet:'pot',face:{x:100,y:82,s:.74},top:{x:100,y:28,s:.72},neck:{x:100,y:122,s:.66},chest:{x:100,y:150,s:.72},armL:arm([76,128],[30,130],[34,84]),armR:arm([124,128],[170,130],[166,84]),armKind:'tube'},
  speaker:{body:'M50 26H150Q164 26 164 40V200Q164 214 150 214H50Q36 214 36 200V40Q36 26 50 26Z',shade:'M138 26H150Q164 26 164 40V200Q164 214 150 214H126Q152 130 138 26Z',
    front:`<g class="woofer"><circle cx="100" cy="158" r="42" fill="${INK}"/><circle cx="100" cy="158" r="30" fill="#3b3560"/><circle cx="100" cy="158" r="13" fill="${INK}"/></g>`,
    feet:'stubby',face:{x:100,y:76,s:.92},top:{x:100,y:32,s:1},neck:{x:100,y:112,s:.8},chest:{x:100,y:112,s:.6},armL:arm([40,130],[12,142],[18,176]),armR:arm([160,130],[188,142],[182,176]),armKind:'tube'},
  mushroom:{body:'M26 104C26 50 60 20 100 20C140 20 174 50 174 104C174 120 150 122 132 122C136 150 138 190 136 216H64C62 190 64 150 68 122C50 122 26 120 26 104Z',shade:'M140 32C162 50 174 76 174 104C174 120 150 122 132 122C136 150 138 190 136 216H112C132 170 118 130 112 122C152 118 156 76 140 32Z',
    front:`<circle cx="62" cy="76" r="12" fill="#fff" opacity=".8"/><circle cx="104" cy="50" r="15" fill="#fff" opacity=".8"/><circle cx="142" cy="84" r="10" fill="#fff" opacity=".8"/>`,
    feet:'stubby',face:{x:100,y:162,s:.78},top:{x:100,y:26,s:1.06},neck:{x:100,y:206,s:.7},chest:{x:100,y:204,s:.6},armL:arm([68,170],[36,176],[40,206]),armR:arm([132,170],[164,176],[160,206]),armKind:'tube'},
  moon:{body:'M126 18C66 18 26 68 26 126C26 186 72 228 130 228C148 228 164 224 176 216C130 206 100 170 100 126C100 82 130 44 176 34C162 24 146 18 126 18Z',shade:'M100 126C100 170 130 206 176 216C164 224 148 228 130 228C110 228 92 222 78 212C108 200 96 150 100 126Z',
    feet:'long',face:{x:62,y:122,s:.74},top:{x:92,y:24,s:.74},neck:{x:66,y:166,s:.6},chest:{x:72,y:186,s:.6},armL:arm([34,160],[10,176],[18,206]),armR:arm([110,176],[140,160],[150,132]),armKind:'tube'},
  flame:{body:'M106 12C112 54 160 80 164 142C168 192 136 224 100 224C64 224 32 194 36 144C38 116 56 102 64 82C72 100 78 108 88 112C82 76 92 40 106 12Z',shade:'M124 56C146 80 162 106 164 142C168 192 136 224 100 224C92 224 84 222 78 220C132 208 150 130 124 56Z',
    front:`<path d="M100 214C78 214 66 196 70 176C74 160 90 156 96 138C108 158 132 164 130 188C128 204 116 214 100 214Z" fill="#fff" opacity=".28"/>`,
    feet:'hover',face:{x:100,y:152,s:.92},top:{x:104,y:40,s:.6},neck:{x:100,y:194,s:.8},chest:{x:100,y:204,s:.6},armL:arm([42,160],[18,158],[20,132]),armR:arm([158,160],[182,158],[180,132]),armKind:'nub'},
  cloud:{body:'M56 188C26 188 12 162 20 138C26 118 42 110 56 112C58 82 84 62 112 70C134 58 162 74 166 100C186 102 198 124 190 146C184 174 158 190 138 188Z',shade:'M150 74C160 82 165 90 166 100C186 102 198 124 190 146C184 174 158 190 138 188H98C154 182 172 120 150 74Z',
    feet:'drips',face:{x:104,y:130,s:1},top:{x:106,y:72,s:.86},neck:{x:104,y:178,s:.8},chest:{x:104,y:176,s:.6},armL:arm([28,148],[6,160],[12,186]),armR:arm([186,150],[198,168],[186,192]),armKind:'nub'},
  drop:{body:'M100 14C120 62 166 104 166 154C166 196 136 224 100 224C64 224 34 196 34 154C34 104 80 62 100 14Z',shade:'M124 60C146 88 166 118 166 154C166 196 136 224 100 224C92 224 84 222 76 220C134 210 150 130 124 60Z',
    feet:'stubby',face:{x:100,y:140,s:.96},top:{x:100,y:30,s:.56},neck:{x:100,y:190,s:.9},chest:{x:100,y:200,s:.7},armL:arm([40,160],[16,172],[22,204]),armR:arm([160,160],[184,172],[178,204]),armKind:'tube'},
};
const stroke=`stroke="${INK}" stroke-width="${W}" stroke-linejoin="round" stroke-linecap="round"`;

function feet(s:Shape,skin:string,cloth:string,trim:string){
  const shoe=(x:number,flip=1)=>`<path transform="translate(${x} 0) scale(${flip} 1)" d="M-18 244q-4-20 18-20h8q12 4 14 20z" fill="${trim}" ${stroke}/>`;
  switch(s.feet){
    case 'stubby':return `<path d="M72 206v22M128 206v22" stroke="${INK}" stroke-width="30" stroke-linecap="round"/><path d="M72 206v22M128 206v22" stroke="${cloth}" stroke-width="18" stroke-linecap="round"/>${shoe(70)}${shoe(130,-1)}`;
    case 'long':return `<path d="M78 180V226M122 180V226" stroke="${INK}" stroke-width="20" stroke-linecap="round"/><path d="M78 180V226M122 180V226" stroke="${cloth}" stroke-width="8" stroke-linecap="round"/>${shoe(76)}${shoe(124,-1)}`;
    case 'block':return `<path d="M68 208h24v22h8v14H60v-14h8zM108 208h24v22h8v14h-40v-14h8z" fill="${trim}" ${stroke}/>`;
    case 'bird':return `<path d="M80 212V238M120 212V238" stroke="${INK}" stroke-width="9" stroke-linecap="round"/><path d="M62 244L80 234L98 244M102 244L120 234L138 244" fill="none" stroke="${INK}" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/><path d="M62 244L80 234L98 244M102 244L120 234L138 244" fill="none" stroke="${trim}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'tentacles':{const legs=['M50 158C30 190 56 214 34 240','M74 164C64 196 84 214 70 244','M100 166C100 196 112 216 100 244','M126 164C136 196 116 214 130 244','M150 158C170 190 144 214 166 240'];return `<g class="tentacles">${legs.map(d=>`<path d="${d}" fill="none" stroke="${INK}" stroke-width="26" stroke-linecap="round"/>`).join('')}${legs.map(d=>`<path d="${d}" fill="none" stroke="${skin}" stroke-width="14" stroke-linecap="round"/>`).join('')}</g>`;}
    case 'pot':return `<path d="M58 204H142L132 244H68Z" fill="${cloth}" ${stroke}/><path d="M52 196H148V212H52Z" fill="${trim}" ${stroke}/>`;
    case 'drips':return `<path d="M64 192v12M104 192v20M144 192v8" stroke="${INK}" stroke-width="17" stroke-linecap="round"/><path d="M64 192v12M104 192v20M144 192v8" stroke="${skin}" stroke-width="7" stroke-linecap="round"/>`;
    default:return '';
  }
}
function arms(s:Shape,skin:string,cloth:string,side:'l'|'r'){
  const a=side==='l'?s.armL:s.armR;if(!a)return '';
  const cls=`arm arm-${side}`,o=`style="transform-origin:${a.from[0]}px ${a.from[1]}px"`;
  if(s.armKind==='wing'){const [x,y]=a.from,dir=side==='l'?-1:1;return `<g class="${cls}" ${o}><path d="M${x} ${y-10}C${x+dir*34} ${y-6} ${x+dir*38} ${y+40} ${x+dir*22} ${y+58}C${x+dir*12} ${y+52} ${x+dir*2} ${y+38} ${x} ${y+24}Z" fill="${cloth}" ${stroke}/></g>`;}
  if(s.armKind==='robot')return `<g class="${cls}" ${o}><path d="${a.path}" fill="none" stroke="${INK}" stroke-width="16" stroke-linejoin="round"/><path d="${a.path}" fill="none" stroke="${cloth}" stroke-width="6"/><circle cx="${a.hand[0]}" cy="${a.hand[1]}" r="11" fill="${skin}" ${stroke}/></g>`;
  const w=s.armKind==='nub'?22:16;
  return `<g class="${cls}" ${o}><path d="${a.path}" fill="none" stroke="${INK}" stroke-width="${w+2*W}" stroke-linecap="round"/><path d="${a.path}" fill="none" stroke="${skin}" stroke-width="${w}" stroke-linecap="round"/></g>`;
}
function wear(l:CharacterLook,s:Shape,cloth:string,trim:string,clip:string){
  const c=s.chest,g=(inner:string)=>`<g clip-path="url(#${clip})">${inner}</g>`,n=s.neck;
  switch(l.wear){
    case 'stripes':return g(Array.from({length:7},(_,i)=>`<rect x="0" y="${n.y-6+i*26}" width="200" height="13" fill="${cloth}"/>`).join(''));
    case 'dots':return g(Array.from({length:18},(_,i)=>`<circle cx="${30+(i%6)*29+(Math.floor(i/6)%2)*14}" cy="${n.y+6+Math.floor(i/6)*30}" r="8" fill="${cloth}"/>`).join(''));
    case 'overalls':return g(`<rect x="0" y="${c.y-14}" width="200" height="120" fill="${cloth}"/><path d="M${c.x-28} ${c.y-12}L${c.x-20} ${n.y-30}M${c.x+28} ${c.y-12}L${c.x+20} ${n.y-30}" stroke="${cloth}" stroke-width="12"/><circle cx="${c.x-26}" cy="${c.y-4}" r="4.5" fill="${trim}"/><circle cx="${c.x+26}" cy="${c.y-4}" r="4.5" fill="${trim}"/><rect x="${c.x-16}" y="${c.y+6}" width="32" height="20" rx="4" fill="${trim}" opacity=".9"/>`);
    case 'jacket':return g(`<path d="M0 ${n.y-4}H${c.x-14}L${c.x} ${c.y+34}L${c.x+14} ${n.y-4}H200V260H0Z" fill="${cloth}"/><path d="M${c.x-14} ${n.y-4}L${c.x} ${c.y+34}L${c.x+14} ${n.y-4}" fill="none" stroke="${trim}" stroke-width="7"/>`);
    case 'sash':return g(`<path d="M0 ${n.y-30}L200 ${n.y+78}V${n.y+112}L0 ${n.y+4}Z" fill="${cloth}"/><path d="M0 ${n.y-16}L200 ${n.y+92}" stroke="${trim}" stroke-width="4"/>`);
    case 'check':return g(Array.from({length:40},(_,i)=>{const x=(i%8)*26,y=n.y-4+Math.floor(i/8)*26;return (i+Math.floor(i/8))%2?`<rect x="${x}" y="${y}" width="26" height="26" fill="${cloth}"/>`:'';}).join(''));
    case 'zigzag':return g([0,1,2].map(i=>`<path d="M0 ${n.y+10+i*36}${Array.from({length:10},(_,k)=>`L${(k+1)*20} ${n.y+10+i*36+(k%2?0:18)}`).join('')}" fill="none" stroke="${cloth}" stroke-width="10"/>`).join(''));
    case 'stars':return g([[-40,14],[0,-2],[40,14],[-20,44],[22,48],[-46,70],[48,74]].map(([x,y])=>`<path transform="translate(${c.x+x} ${c.y+y-14}) scale(.62)" d="M0-16l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z" fill="${cloth}"/>`).join(''));
    case 'belly':return g(`<ellipse cx="${c.x}" cy="${c.y+6}" rx="${44*c.s}" ry="${50*c.s}" fill="${cloth}"/>`);
    default:return '';
  }
}
function eyes(l:CharacterLook,trim:string){
  const white=(x:number,r=13)=>`<circle cx="${x}" cy="0" r="${r}" fill="#fff" stroke="${INK}" stroke-width="4"/>`;
  const pupil=(x:number,r=6)=>`<circle class="pupil" cx="${x}" cy="1" r="${r}" fill="${INK}"/><circle cx="${x+2.4}" cy="-2" r="2.1" fill="#fff"/>`;
  switch(l.eyes){
    case 'dots':return `<circle cx="-20" cy="0" r="7.5" fill="${INK}"/><circle cx="20" cy="0" r="7.5" fill="${INK}"/><circle cx="-17.5" cy="-2.5" r="2.4" fill="#fff"/><circle cx="22.5" cy="-2.5" r="2.4" fill="#fff"/>`;
    case 'wide':return `${white(-21,15)}${white(21,15)}${pupil(-19,6.5)}${pupil(23,6.5)}`;
    case 'sleepy':return `${white(-21)}${white(21)}<path d="M-35 -1a14 14 0 0 1 28 0zM7 -1a14 14 0 0 1 28 0z" fill="${INK}"/>${pupil(-20,4.5)}${pupil(22,4.5)}`;
    case 'sparkle':return `${white(-21,14)}${white(21,14)}<path d="M-21-9l3 6 6 3-6 3-3 6-3-6-6-3 6-3zM21-9l3 6 6 3-6 3-3 6-3-6-6-3 6-3z" fill="${INK}"/>`;
    case 'shades':return `<path d="M-40-10H40V-3H36Q34 16 12 14Q2 13 0 0Q-2 13-12 14Q-34 16-36-3H-40Z" fill="${INK}"/><path d="M-30-4L-20 8M6-4L16 8" stroke="#fff" stroke-width="3" opacity=".6"/>`;
    case 'cyclops':return `${white(0,20)}<circle class="pupil" cx="2" cy="1" r="9" fill="${INK}"/><circle cx="6" cy="-4" r="3" fill="#fff"/>`;
    case 'fierce':return `${white(-20)}${white(20)}${pupil(-18,5.5)}${pupil(18,5.5)}<path d="M-38-16L-8-6M38-16L8-6" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`;
    case 'wink':return `${white(-21,14)}${pupil(-19,6)}<path d="M8 2q13-12 26 0" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`;
    case 'visor':return `<rect x="-42" y="-12" width="84" height="24" rx="12" fill="${INK}"/><rect x="-34" y="-5" width="68" height="10" rx="5" fill="${trim}"/>`;
  }
}
function mouth(l:CharacterLook){
  const y=30;
  switch(l.mouth){
    case 'smile':return `<path class="mouth" d="M-16 ${y-4}q16 16 32 0" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`;
    case 'sing':return `<path class="mouth" d="M-14 ${y-8}Q0 ${y-14} 14 ${y-8}Q18 ${y+14} 0 ${y+14}Q-18 ${y+14} -14 ${y-8}Z" fill="${INK}"/><ellipse cx="0" cy="${y+8}" rx="8" ry="4.5" fill="#f0563f"/>`;
    case 'ooh':return `<ellipse class="mouth" cx="0" cy="${y}" rx="8" ry="10" fill="${INK}"/>`;
    case 'grin':return `<path class="mouth" d="M-24 ${y-8}H24Q24 ${y+12} 0 ${y+12}Q-24 ${y+12} -24 ${y-8}Z" fill="#fff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/><path d="M-8 ${y-8}V${y+11}M8 ${y-8}V${y+11}" stroke="${INK}" stroke-width="3"/>`;
    case 'flat':return `<path class="mouth" d="M-14 ${y}H14" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`;
    case 'tongue':return `<path class="mouth" d="M-16 ${y-4}q16 14 32 0" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M-2 ${y+3}v8a7 7 0 0 0 14 0v-9" fill="#ff8fc0" stroke="${INK}" stroke-width="4"/>`;
    case 'fangs':return `<path class="mouth" d="M-18 ${y-4}H18" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M-13 ${y-2}l5 11 5-11zM3 ${y-2}l5 11 5-11z" fill="#fff" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`;
    case 'moustache':return `<path class="mouth" d="M0 ${y-6}C-8 ${y-14}-28 ${y-8}-32 ${y+4}C-20 ${y+6}-8 ${y+2} 0 ${y-2}C8 ${y+2} 20 ${y+6} 32 ${y+4}C28 ${y-8} 8 ${y-14} 0 ${y-6}Z" fill="${INK}"/>`;
  }
}
function top(l:CharacterLook,cloth:string,trim:string){
  switch(l.top){
    case 'beanie':return `<path d="M-52 2C-52-52 52-52 52 2Z" fill="${cloth}" ${stroke}/><rect x="-58" y="-6" width="116" height="20" rx="9" fill="${trim}" ${stroke}/><circle cx="0" cy="-42" r="11" fill="${trim}" ${stroke}/>`;
    case 'cap':return `<path d="M-48 8C-48-44 48-44 48 8Z" fill="${cloth}" ${stroke}/><path d="M28 6Q80 2 88 16Q60 22 26 16Z" fill="${trim}" ${stroke}/>`;
    case 'tophat':return `<path d="M-34-68H34V2H-34Z" fill="${cloth}" ${stroke}/><rect x="-34" y="-16" width="68" height="14" fill="${trim}"/><path d="M-58 2H58" stroke="${INK}" stroke-width="16" stroke-linecap="round"/><path d="M-58 2H58" stroke="${cloth}" stroke-width="6" stroke-linecap="round"/>`;
    case 'crown':return `<path d="M-42 6L-48-40L-20-16L0-50L20-16L48-40L42 6Z" fill="#ffcb3d" ${stroke}/><circle cx="0" cy="-10" r="7" fill="${trim}" stroke="${INK}" stroke-width="4"/>`;
    case 'mohawk':return `<path d="M-14 8L-36-22L-18-20L-22-48L-4-34L2-62L12-34L28-46L24-20L38-20L14 8Z" fill="${cloth}" ${stroke}/>`;
    case 'afro':return `<path d="M-60 16C-82-18-52-62-16-58C-4-76 34-72 42-50C74-44 78 6 56 18C34-6-34-6-60 16Z" fill="${cloth}" ${stroke}/>`;
    case 'bun':return `<path d="M-50 14C-58-34 58-34 50 14C24-6-24-6-50 14Z" fill="${cloth}" ${stroke}/><circle cx="0" cy="-36" r="22" fill="${cloth}" ${stroke}/><path d="M-20-30H20" stroke="${trim}" stroke-width="7" stroke-linecap="round"/>`;
    case 'spikes':return `<path d="M-52 10L-58-22L-34-10L-30-46L-8-16L4-54L18-16L38-44L38-10L60-20L52 10Z" fill="${cloth}" ${stroke}/>`;
    case 'antenna':return `<path d="M-16 6L-30-44M16 6L32-44" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><circle cx="-30" cy="-48" r="10" fill="${trim}" ${stroke}/><circle cx="32" cy="-48" r="10" fill="${cloth}" ${stroke}/>`;
    case 'headphones':return `<path d="M-60 32C-66-46 66-46 60 32" fill="none" stroke="${INK}" stroke-width="16"/><path d="M-60 32C-66-46 66-46 60 32" fill="none" stroke="${cloth}" stroke-width="6"/><rect x="-74" y="16" width="26" height="46" rx="11" fill="${trim}" ${stroke}/><rect x="48" y="16" width="26" height="46" rx="11" fill="${trim}" ${stroke}/>`;
    case 'bow':return `<path d="M0-6L-44-34V22ZM0-6L44-34V22Z" fill="${cloth}" ${stroke}/><circle cx="0" cy="-6" r="10" fill="${trim}" ${stroke}/>`;
    case 'sprout':return `<path d="M0 8V-26" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M0-22C-8-54-46-54-48-42C-44-20-14-16 0-22ZM0-30C10-58 44-58 46-46C42-26 14-22 0-30Z" fill="${cloth}" ${stroke}/>`;
    case 'partyhat':return `<path d="M-34 8L0-70L34 8Z" fill="${cloth}" ${stroke}/><path d="M-20-22L20-22M-10-44L10-44" stroke="${trim}" stroke-width="7"/><circle cx="0" cy="-74" r="10" fill="${trim}" ${stroke}/>`;
    case 'horns':return `<path d="M-30 6C-66-4-64-44-50-54C-48-30-28-22-14 0ZM30 6C66-4 64-44 50-54C48-30 28-22 14 0Z" fill="${trim}" ${stroke}/>`;
    case 'halo':return `<ellipse cx="0" cy="-34" rx="46" ry="13" fill="none" stroke="${INK}" stroke-width="15"/><ellipse cx="0" cy="-34" rx="46" ry="13" fill="none" stroke="#ffcb3d" stroke-width="6"/>`;
    case 'bucket':return `<path d="M-40-34H40L56 10H-56Z" fill="${cloth}" ${stroke}/><path d="M-48-8H48" stroke="${trim}" stroke-width="7"/>`;
    case 'ears':return `<circle cx="-52" cy="-8" r="24" fill="${cloth}" ${stroke}/><circle cx="52" cy="-8" r="24" fill="${cloth}" ${stroke}/><circle cx="-52" cy="-8" r="11" fill="${trim}"/><circle cx="52" cy="-8" r="11" fill="${trim}"/>`;
    default:return '';
  }
}
function neckProp(l:CharacterLook,s:Shape,cloth:string,trim:string){
  const n=s.neck,c=s.chest,at=(a:Anchor,inner:string)=>`<g transform="translate(${a.x} ${a.y}) scale(${a.s})">${inner}</g>`;
  const handL=s.armL?.hand??[30,180],handR=s.armR?.hand??[170,180];
  switch(l.prop){
    case 'scarf':return at(n,`<path d="M-54-10Q0 12 54-10L58 8Q0 32-58 8Z" fill="${trim}" ${stroke}/><path d="M24 14L46 56L22 60L10 18Z" fill="${trim}" ${stroke}/>`);
    case 'bowtie':return at(n,`<path d="M0 0L-30-16V16ZM0 0L30-16V16Z" fill="${trim}" ${stroke}/><circle r="7" fill="${cloth}" ${stroke}/>`);
    case 'medal':return at(c,`<path d="M-16-44L0-8L16-44" fill="none" stroke="${trim}" stroke-width="9"/><circle cy="6" r="16" fill="#ffcb3d" ${stroke}/>`);
    case 'mic':return `<g class="held held-r"><path d="M${handR[0]-4} ${handR[1]+6}L${handR[0]-22} ${handR[1]-30}" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><circle cx="${handR[0]-26}" cy="${handR[1]-38}" r="13" fill="${trim}" ${stroke}/></g>`;
    case 'sticks':return `<g class="held held-l"><path d="M${handL[0]} ${handL[1]}L${handL[0]+30} ${handL[1]-46}" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><path d="M${handL[0]} ${handL[1]}L${handL[0]+30} ${handL[1]-46}" stroke="${trim}" stroke-width="5" stroke-linecap="round"/></g><g class="held held-r"><path d="M${handR[0]} ${handR[1]}L${handR[0]-30} ${handR[1]-46}" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><path d="M${handR[0]} ${handR[1]}L${handR[0]-30} ${handR[1]-46}" stroke="${trim}" stroke-width="5" stroke-linecap="round"/></g>`;
    case 'keytar':return at({x:c.x,y:c.y-2,s:c.s},`<g transform="rotate(-14)"><path d="M-74-16H58L78-34L84-20L62 18H-74Q-84 18-84 8V-6Q-84-16-74-16Z" fill="${cloth}" ${stroke}/><path d="M-70-6H44V10H-70Z" fill="#fff" stroke="${INK}" stroke-width="3"/><path d="M-54-6V10M-38-6V10M-22-6V10M-6-6V10M10-6V10M26-6V10" stroke="${INK}" stroke-width="3"/></g>`);
    case 'bass':return at({x:c.x,y:c.y+6,s:c.s},`<g transform="rotate(32)"><path d="M-66 8C-82-14-54-30-40-20C-30-30-8-22-10-6C-8 12-30 20-42 12C-50 26-62 22-66 8Z" fill="${cloth}" ${stroke}/><path d="M-12-6H84" stroke="${INK}" stroke-width="13" stroke-linecap="round"/><path d="M-12-6H84" stroke="${trim}" stroke-width="5" stroke-linecap="round"/><path d="M78-16H102V6H78Z" fill="${cloth}" ${stroke}/></g>`);
    case 'maracas':{const m=(p:number[],d:number)=>`<path d="M${p[0]} ${p[1]}L${p[0]+d*10} ${p[1]-26}" stroke="${INK}" stroke-width="9" stroke-linecap="round"/><ellipse cx="${p[0]+d*14}" cy="${p[1]-40}" rx="14" ry="19" fill="${trim}" ${stroke} transform="rotate(${d*16} ${p[0]+d*14} ${p[1]-40})"/>`;return `<g class="held held-l">${m(handL,1)}</g><g class="held held-r">${m(handR,-1)}</g>`;}
    case 'tambourine':return `<g class="held held-r"><circle cx="${handR[0]-8}" cy="${handR[1]-26}" r="27" fill="${cloth}" ${stroke}/><circle cx="${handR[0]-8}" cy="${handR[1]-26}" r="13" fill="${trim}" opacity=".85"/>${[0,1,2,3,4,5].map(i=>`<circle cx="${(handR[0]-8+27*Math.cos(i*1.05)).toFixed(1)}" cy="${(handR[1]-26+27*Math.sin(i*1.05)).toFixed(1)}" r="5" fill="#ffcb3d" stroke="${INK}" stroke-width="3"/>`).join('')}</g>`;
    default:return '';
  }
}
let uid=0;
export type DrawOptions={label?:string;className?:string};
// The drawing of a look, as a self-contained SVG string. The label, when given,
// is the only text; callers pass it already escaped.
export function characterSvg(l:CharacterLook,opts:DrawOptions={}){
  const s=SHAPES[l.body],skin=SWATCH_HEX[l.skin],cloth=SWATCH_HEX[l.cloth],trim=SWATCH_HEX[l.trim],clip=`cs${++uid}`;
  const n=s.neck;
  const behind=l.prop==='cape'?`<path d="M${n.x-46} ${n.y-14}C${n.x-92} ${n.y+60} ${n.x-70} 232 ${n.x-40} 236H${n.x+40}C${n.x+70} 232 ${n.x+92} ${n.y+60} ${n.x+46} ${n.y-14}Z" fill="${trim}" ${stroke}/>`
    :l.prop==='backpack'?`<g transform="translate(0 ${Math.min(0,150-n.y)})"><rect x="${n.x-76}" y="${n.y-30}" width="152" height="86" rx="16" fill="${cloth}" ${stroke}/><circle cx="${n.x-52}" cy="${n.y+12}" r="15" fill="${INK}"/><circle cx="${n.x+52}" cy="${n.y+12}" r="15" fill="${INK}"/></g>`:'';
  const hover=s.feet==='hover'||s.feet==='drips'?`<ellipse cx="100" cy="240" rx="52" ry="7" fill="${INK}" opacity=".32"/>`:'';
  const t=s.top,f=s.face;
  return `<svg class="figure${opts.className?` ${opts.className}`:''}" data-body="${l.body}" viewBox="-6 -44 212 296" ${opts.label?`role="img" aria-label="${opts.label}"`:'aria-hidden="true"'} focusable="false"><defs><clipPath id="${clip}"><path d="${s.body}"/></clipPath></defs>${hover}<g class="rig">${behind}${feet(s,skin,cloth,trim)}<g class="body">${s.back?`<path d="${s.back}" fill="${skin}" ${stroke}/>`:''}${arms(s,skin,cloth,'l')}<path d="${s.body}" fill="${skin}" ${stroke}/>${wear(l,s,cloth,trim,clip)}<path d="${s.shade}" fill="${INK}" opacity=".13" clip-path="url(#${clip})"/><path d="${s.body}" fill="none" ${stroke}/>${s.front??''}${arms(s,skin,cloth,'r')}</g><g class="face" transform="translate(${f.x} ${f.y}) scale(${f.s})"><g class="eyes">${eyes(l,trim)}</g><g class="mouth-wrap">${mouth(l)}</g></g><g class="accessory"><g transform="translate(${t.x} ${t.y}) scale(${t.s})">${top(l,cloth,trim)}</g>${neckProp(l,s,cloth,trim)}</g></g></svg>`;
}
// A part with no stored look: drawn from its role and id, never saved.
export function performerSvg(role:Look,seed:string,look?:CharacterLook|null){return characterSvg(look??defaultLook(role,seed));}
// How each role answers its own sound. Shape is told by the drawing and words by
// the label; this only adds life, and reduced motion leaves it out.
const STEP={
  beats:[{transform:'translateY(0) scale(1,1)'},{transform:'translateY(5%) scale(1.05,.93)'},{transform:'translateY(0) scale(1,1)'}],
  bass:[{transform:'scale(1,1)'},{transform:'scale(1.06,.95)'},{transform:'scale(1,1)'}],
  melody:[{transform:'rotate(0)'},{transform:'rotate(-3.5deg) translateY(-3%)'},{transform:'rotate(0)'}],
  texture:[{transform:'translateY(0)'},{transform:'translateY(-4%)'},{transform:'translateY(0)'}],
  custom:[{transform:'translateY(0)'},{transform:'translateY(-5%)'},{transform:'translateY(0)'}],
};
export function moveCharacter(li:Element,role:string){
  li.querySelector('.rig')?.animate(STEP[role as keyof typeof STEP]??STEP.custom,{duration:220,easing:'ease-out'});
  li.querySelector('.arm-l')?.animate([{transform:'rotate(0)'},{transform:'rotate(16deg)'},{transform:'rotate(0)'}],{duration:220,easing:'ease-out'});
  li.querySelector('.arm-r')?.animate([{transform:'rotate(0)'},{transform:'rotate(-16deg)'},{transform:'rotate(0)'}],{duration:220,easing:'ease-out'});
  li.querySelector('.woofer')?.animate([{transform:'scale(1)'},{transform:'scale(1.09)'},{transform:'scale(1)'}],{duration:180,easing:'ease-out'});
}
