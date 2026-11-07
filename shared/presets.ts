// The factory cast. Every character is an exact Strudel expression in the
// version 2 grammar (shared/expr.ts) with a stable id and version, an original
// look, and a line of tonal guidance. A part copies the source when it is
// added, so a later catalogue version never changes a saved mix; editing a
// part's code makes a variation, not a new factory character.
//
// Status: candidate patterns. They compile and play through the bounded audio
// output; whether they sound good together is decided by listening, which is
// recorded separately in docs/verification.md, not asserted here.
//
// Pan: the candidate catalogue wrote pan on a -1..1 scale. Strudel 1.2.6 takes
// pan from 0 (left) to 1 (right), so those values are mapped (x + 1) / 2 below:
// -0.25 -> 0.375, 0.2 -> 0.6, 0.3 -> 0.65.
//
// The packs added in catalogue version 2 are written as flat steps, one word per
// step, so the visual step editor (shared/steps.ts) can edit every note of them.
import type {Control} from './expr.ts';
import {validLook,type Look} from './look.ts';
export const ROLES = ['beats','bass','melody','texture'] as const;
export type Role = typeof ROLES[number];
export type Macro = Control;
export type Preset = {
  id:string; version:number; name:string; role:Role; source:string;
  macros:Macro[]; bpm:number; key:string; pack:string;
  attribution:string; preview:{bars:number}; look:Look; blurb:string;
};
export type Pack = {id:string;name:string;suggestedBpm:number;mood:string;presets:Preset[]};

export const CATALOG_VERSION = 2;
export const ATTRIBUTION = 'Original Ensemble pattern, prepared 26 October 2026. No Incredibox audio or artwork.';
export const ATTRIBUTION_V2 = 'Original Ensemble pattern, prepared 7 November 2026. No Incredibox audio or artwork.';
export const KEY = 'A minor';

// body eyes mouth top wear prop skin cloth trim
function look(text:string):Look{
  const [body,eyes,mouth,top,wear,prop,skin,cloth,trim]=text.split(' ');
  const parsed=validLook({v:1,body,eyes,mouth,top,wear,prop,skin,cloth,trim});
  if(!parsed)throw new Error(`Bad factory look: ${text}`);
  return parsed;
}
type Row = [id:string,name:string,role:Role,source:string,macros:Macro[],previewBars?:number];
const barsOf=(source:string)=>source.includes('slow(4)')?4:source.includes('slow(2)')||source.includes('<')?2:1;
function pack(id:string,name:string,suggestedBpm:number,mood:string,rows:Row[],attribution=ATTRIBUTION):Pack{
  return {id,name,suggestedBpm,mood,presets:rows.map(([pid,pname,role,source,macros,bars])=>{
    const [lookText,blurb]=CAST[pid];
    return {id:pid,version:1,name:pname,role,source,macros,bpm:suggestedBpm,key:KEY,pack:id,attribution,preview:{bars:bars??barsOf(source)},look:look(lookText),blurb};
  })};
}

// How each character looks, and what it is good for.
const CAST:Record<string,[string,string]>={
  'warm-pocket':['bean dots smile headphones plain sticks coral cobalt sun','A steady, friendly groove to build on.'],
  'warm-shuffle':['critter wink grin cap stripes none sky tomato cream','Leans back with a late kick and handclaps.'],
  'warm-anchor':['boulder sleepy flat beanie plain bass teal sun coral','Round low notes that hold everything down.'],
  'warm-walk':['pear dots smile bucket overalls none sand teal cream','A soft walking line, gentle under a melody.'],
  'warm-sunbeam':['flame sparkle sing none plain mic sun tomato snow','A bright, hopeful tune with a little space.'],
  'warm-question':['bird wide ooh sprout belly none mint cream coral','A curious phrase that answers itself each bar.'],
  'warm-glow':['cloud sleepy smile halo plain none cream sun pink','Slow warm chords behind everything.'],
  'warm-spark':['drop sparkle ooh none stars none peach sun plum','Sparse high notes drifting off to one side.'],
  'arcade-four':['robot shades grin antenna plain sticks tomato slate sun','Four on the floor: instantly danceable.'],
  'arcade-skip':['bean wide tongue mohawk check sticks lime ink pink','Busy, skippy and full of bounce.'],
  'arcade-bounce':['speaker wide grin partyhat plain none violet sun mint','A hopping octave bass with a hard edge.'],
  'arcade-engine':['boulder fierce fangs spikes zigzag bass tomato ink sun','Fast repeated notes that drive a section forward.'],
  'arcade-pixel':['robot visor smile none plain keytar sky cobalt pink','A quick up-and-down arcade run.'],
  'arcade-comet':['tower sparkle sing crown stripes mic violet sun cream','Falling triplets that catch the ear.'],
  'arcade-orbit':['moon dots smile none stars tambourine sun cobalt cream','One long note a bar, circling overhead.'],
  'arcade-chime':['mushroom wide ooh none plain none coral cream mint','A soft bonus-round chime every other bar.'],
  'night-heart':['ghost sleepy flat none plain none plum pink cream','A slow heartbeat that leaves plenty of room.'],
  'night-ticks':['cactus dots smile sprout plain maracas teal pink sand','Quiet ticking with a touch of room.'],
  'night-floor':['octo sleepy ooh none plain none cobalt sky cream','A deep, patient floor of long low notes.'],
  'night-drift':['tower sleepy flat beanie jacket bass slate plum sand','A dark line that moves one step each bar.'],
  'night-lantern':['bird wide smile tophat plain none sand plum sun','A lonely, spacious tune for late at night.'],
  'night-window':['critter sleepy smile ears plain scarf violet sand pink','A gentle falling phrase, half remembered.'],
  'night-velvet':['pear sleepy moustache tophat jacket bowtie plum ink cream','Two slow chords, soft as a curtain.'],
  'night-stars':['moon wink smile halo stars none cream cobalt sun','Tiny distant notes with long gaps.'],
  'sun-gate':['robot shades flat crown stripes sticks pink ink sun','A big straight eighties kit with open hats.'],
  'sun-fill':['tower fierce grin mohawk zigzag sticks violet ink mint','Syncopated kicks and a tom fill at the end.'],
  'sun-highway':['speaker shades grin cap plain none coral ink sun','Pulsing sixteenth bass for night driving.'],
  'sun-cruise':['boulder shades smile cap jacket bass peach cobalt pink','A relaxed, dark bass with lots of air.'],
  'sun-rearview':['bean visor smile none sash keytar pink cobalt sky','A glittering arpeggio through four chords.'],
  'sun-afterglow':['flame sleepy sing bun plain keytar coral pink sun','A wide, slow lead with an echo behind it.'],
  'sun-horizon':['cloud sleepy smile none plain cape pink violet sun','Huge slow chords that open up a chorus.'],
  'sun-haze':['drop wide ooh halo zigzag none peach coral sun','A shimmer of echoing bell tones.'],
  'clay-circle':['pear wide grin bun check maracas clay sun cream','Hand drums and a shaker, loose and earthy.'],
  'clay-keeper':['cactus fierce moustache bucket plain sticks lime clay sand','A clave pattern with a cowbell on top.'],
  'clay-thumb':['mushroom dots smile none overalls none sand clay tomato','Plucked low notes, short and woody.'],
  'clay-strum':['boulder sleepy smile afro plain bass clay teal sun','A plain, warm bass with an octave jump.'],
  'clay-wood':['tower dots grin none stripes none sand clay sun','A marimba-like tune, bright and dry.'],
  'clay-reed':['bird sleepy ooh none plain scarf teal sun tomato','A breathy call that floats above the drums.'],
  'clay-shadow':['ghost sleepy flat bucket plain none slate clay sand','A dark drone that slowly swells and fades.'],
  'clay-bells':['drop sparkle smile none dots tambourine sky sand sun','Metallic bells, rare and out to one side.'],
  'bot-march':['robot dots flat antenna plain none slate sun tomato','A stiff march of kicks and rimshots.'],
  'bot-flip':['robot cyclops grin none check sticks mint ink pink','A broken, glitchy pattern that keeps you guessing.'],
  'bot-battery':['speaker sleepy flat antenna plain none lime ink tomato','A flat square-wave bass, running low.'],
  'bot-stepper':['tower visor flat antenna stripes none teal sun ink','A mechanical octave bass, tight and short.'],
  'bot-beep':['bean cyclops ooh antenna plain none cream cobalt tomato','Short square beeps with a message in them.'],
  'bot-readout':['robot visor smile headphones plain keytar sun slate cobalt','A fast data-stream melody in sixteenths.'],
  'bot-coolant':['drop visor flat none plain none sky snow cobalt','A low machine hum breathing in and out.'],
  'bot-spark':['flame cyclops fangs spikes plain none sun tomato sky','Sharp metallic zaps, used sparingly.'],
  'rain-tap':['critter dots smile beanie plain sticks sky cream coral','A lazy lo-fi beat with soft rimshots.'],
  'rain-brush':['pear sleepy moustache cap jacket sticks sand slate tomato','Brushes and a quiet shaker, late-night jazz.'],
  'rain-upright':['tower sleepy moustache tophat jacket bowtie clay ink cream','A walking upright bass, slow and woody.'],
  'rain-puddle':['drop sleepy smile bucket plain none sky sun cobalt','Two round notes a bar, almost not there.'],
  'rain-keys':['bean sleepy ooh beanie stripes keytar peach teal cream','Soft electric-piano chords, a little dusty.'],
  'rain-sigh':['ghost sleepy ooh none plain scarf cream sky plum','A falling phrase that echoes into the room.'],
  'rain-fog':['cloud sleepy flat none plain none snow sky slate','A faint chord bed, like condensation.'],
  'rain-drip':['mushroom wide ooh none dots none teal sky cream','Occasional high drips with a long echo.'],
  'carn-street':['bird fierce sing partyhat plain sticks tomato sun mint','A marching street-band rhythm with shakers.'],
  'carn-cowbell':['boulder wide grin horns check tambourine sun tomato cream','Cowbell in charge, kit underneath.'],
  'carn-tuba':['pear wide ooh tophat sash none coral sun cobalt','An oompah bass, big and cheerful.'],
  'carn-hop':['critter wink tongue partyhat stripes none pink sun cobalt','A bright hopping bass line.'],
  'carn-brass':['bean fierce sing crown sash medal sun tomato violet','Punchy brass stabs on the offbeats.'],
  'carn-whistle':['cactus wide ooh partyhat plain none mint pink sun','A whistled parade tune, loud and simple.'],
  'carn-confetti':['cloud sparkle grin partyhat dots none pink sun mint','Quick high flurries thrown across the stage.'],
  'carn-crowd':['octo wink sing ears plain none violet sun pink','A wide, warm chord like a crowd humming.'],
  'sea-sonar':['octo visor flat none plain none teal mint sun','A deep kick and an echoing ping.'],
  'sea-hull':['robot sleepy flat bucket plain none slate teal sun','Hollow tom knocks in a big space.'],
  'sea-trench':['boulder sleepy fangs none plain none cobalt ink sky','Very low, very slow. Felt as much as heard.'],
  'sea-current':['ghost wide flat none zigzag none teal cobalt sky','A dub bass with a shadow of echo.'],
  'sea-lantern':['bird fierce fangs antenna plain none plum sun mint','A glowing tune with a long dub echo.'],
  'sea-song':['boulder sparkle sing none belly none sky snow cobalt','Long gliding calls, far away.'],
  'sea-tide':['cloud sleepy smile none zigzag none cobalt sky snow','Enormous slow chords that rise and fall.'],
  'sea-bubbles':['drop wide ooh none dots none mint snow sky','Little upward bursts, drifting left.'],
};

export const PACKS: Pack[] = [
  pack('warm-circuit','Warm Circuit',100,'Relaxed electronic groove',[
    ['warm-pocket','Pocket','beats','stack(s("bd ~ bd ~"), s("~ sd ~ sd").gain(0.45), s("hh*8").gain(0.16))',['gain','lpf']],
    ['warm-shuffle','Side Step','beats','stack(s("bd ~ [~ bd] ~"), s("~ cp ~ cp").gain(0.35), s("hh ~ hh hh").gain(0.18))',['gain','lpf']],
    ['warm-anchor','Anchor','bass','note("33 ~ 33 40").s("triangle").lpf(850).gain(0.48)',['gain','lpf','release']],
    ['warm-walk','Soft Walk','bass','note("33 36 ~ 40 43 ~ 40 36").s("sine").gain(0.5)',['gain','release']],
    ['warm-sunbeam','Sunbeam','melody','note("69 ~ 72 76 ~ 72 71 ~").s("triangle").room(0.2).gain(0.3)',['gain','lpf','room']],
    ['warm-question','Little Question','melody','note("[69 72] ~ 76 ~ <74 71> ~ 72 ~").s("sine").room(0.15).gain(0.3)',['gain','room']],
    ['warm-glow','Glow','texture','note("[57,60,64] ~").s("triangle").slow(2).release(1.2).lpf(1300).room(0.3).gain(0.13)',['gain','lpf','room']],
    ['warm-spark','Dust','texture','note("81 ~ ~ 88 ~ ~ 84 ~").s("sine").slow(2).pan(0.375).room(0.35).gain(0.15)',['gain','pan','room']],
  ]),
  pack('pocket-arcade','Pocket Arcade',120,'Bright, short, rhythmic parts',[
    ['arcade-four','Quarter Drop','beats','stack(s("bd*4").gain(0.7), s("~ cp ~ cp").gain(0.35), s("[~ hh]*4").gain(0.16))',['gain','lpf']],
    ['arcade-skip','Skip','beats','stack(s("bd ~ ~ bd ~ sd bd sd").gain(0.55), s("hh*8").gain(0.12))',['gain','lpf']],
    ['arcade-bounce','Bounce','bass','note("33 45 33 ~ 40 52 40 ~").s("square").lpf(950).release(0.08).gain(0.2)',['gain','lpf','release']],
    ['arcade-engine','Engine','bass','note("33*4 40*4").s("sawtooth").lpf(700).gain(0.2)',['gain','lpf']],
    ['arcade-pixel','Pixel Hop','melody','note("69 72 76 81 76 72 71 67").s("square").lpf(2600).release(0.06).gain(0.12)',['gain','lpf','release']],
    ['arcade-comet','Comet','melody','note("[81 79 76] ~ [72 71 69] ~").s("triangle").room(0.12).gain(0.25)',['gain','room']],
    ['arcade-orbit','Orbit','texture','note("<81 84 88 86>").s("sine").release(0.3).pan(0.65).room(0.25).gain(0.18)',['gain','pan','room'],4],
    ['arcade-chime','Level Light','texture','note("[72,76] ~ ~ [76,81]").s("triangle").slow(2).room(0.3).gain(0.12)',['gain','lpf','room']],
  ]),
  pack('after-hours','After Hours',80,'Spacious and slower patterns',[
    ['night-heart','Heartbeat','beats','stack(s("bd ~ ~ ~ bd ~ bd ~").gain(0.55), s("~ ~ sd ~").gain(0.25))',['gain','lpf']],
    ['night-ticks','Rain Ticks','beats','stack(s("hh ~ hh [hh hh]").gain(0.12), s("~ cp ~ ~").gain(0.2)).room(0.15)',['gain','lpf','room']],
    ['night-floor','Deep Floor','bass','note("33 ~ 40 ~").s("sine").slow(2).release(0.8).gain(0.5)',['gain','release']],
    ['night-drift','Drift','bass','note("<33 36 38 40> ~").s("triangle").lpf(600).release(0.5).gain(0.35)',['gain','lpf','release'],4],
    ['night-lantern','Lantern','melody','note("69 ~ ~ 76 ~ 74 ~ ~").s("sine").slow(2).room(0.35).gain(0.28)',['gain','room']],
    ['night-window','Window','melody','note("72 ~ 71 ~ 69 ~ 64 ~").s("triangle").slow(2).lpf(1800).room(0.3).gain(0.22)',['gain','lpf','room']],
    ['night-velvet','Velvet','texture','note("<[57,60,64] [55,59,62]>").s("sine").slow(2).release(1.8).room(0.4).gain(0.12)',['gain','release','room'],4],
    ['night-stars','Far Stars','texture','note("88 ~ ~ ~ 84 ~ ~ ~").s("sine").slow(2).pan(0.6).room(0.4).gain(0.14)',['gain','pan','room']],
  ]),
  pack('sunset-drive','Sunset Drive',110,'Neon eighties, wide and driving',[
    ['sun-gate','Gatekeeper','beats','stack(s("bd ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~").gain(0.7), s("~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ sd ~ ~ ~").room(0.35).gain(0.5), s("hh hh oh hh hh hh oh hh hh hh oh hh hh hh oh hh").gain(0.13))',['gain','lpf']],
    ['sun-fill','Neon Fill','beats','stack(s("bd ~ ~ bd ~ ~ bd ~ bd ~ ~ bd ~ ~ bd ~").gain(0.62), s("~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ sd ~ ht lt").gain(0.42), s("hh ~ hh ~ hh ~ hh ~ hh ~ hh ~ hh ~ hh ~").gain(0.12))',['gain','lpf']],
    ['sun-highway','Highway','bass','note("a1 a1 a2 a1 a1 a1 a2 a1 f1 f1 f2 f1 g1 g1 g2 g1").s("pulse").lpf(900).release(0.06).gain(0.26)',['gain','lpf','release']],
    ['sun-cruise','Cruise Control','bass','note("a1 ~ ~ a1 ~ ~ e2 ~ f1 ~ ~ f1 ~ ~ g1 ~").s("sawtooth").lpf(620).gain(0.24)',['gain','lpf','release']],
    ['sun-rearview','Rear View','melody','note("a3 c4 e4 a4 e4 c4 a3 c4 f3 a3 c4 f4 g3 b3 d4 g4").s("pulse").lpf(3000).delay(0.22).gain(0.12)',['gain','lpf','delay']],
    ['sun-afterglow','Afterglow','melody','note("e5 ~ ~ d5 c5 ~ a4 ~").s("supersaw").lpf(2600).release(0.3).room(0.3).delay(0.2).gain(0.16)',['gain','lpf','room','delay']],
    ['sun-horizon','Horizon','texture','note("[a3,c4,e4] [f3,a3,c4] [g3,b3,d4] [e3,g3,b3]").s("supersaw").slow(2).attack(0.4).release(1.2).lpf(1400).room(0.3).gain(0.11)',['gain','lpf','room']],
    ['sun-haze','Heat Haze','texture','note("a5 ~ e5 ~ c6 ~ e5 ~").s("sine").slow(2).fm(1.5).delay(0.4).room(0.4).pan(0.4).gain(0.08)',['gain','pan','room','delay']],
  ],ATTRIBUTION_V2),
  pack('clay-courtyard','Clay Courtyard',96,'Earthy hand percussion and wood',[
    ['clay-circle','Hand Circle','beats','stack(s("lt ~ ~ lt ~ ~ ht ~ lt ~ ~ lt ~ ht ~ ~").gain(0.55), s("sh sh sh sh sh sh sh sh sh sh sh sh sh sh sh sh").gain(0.1))',['gain','lpf']],
    ['clay-keeper','Clave Keeper','beats','stack(s("rim ~ ~ rim ~ ~ rim ~ ~ ~ rim ~ rim ~ ~ ~").gain(0.4), s("bd ~ ~ ~ ~ ~ bd ~ bd ~ ~ ~ ~ ~ bd ~").gain(0.55), s("~ ~ cb ~ ~ ~ cb ~ ~ ~ cb ~ ~ ~ cb ~").gain(0.1))',['gain','lpf']],
    ['clay-thumb','Thumb Piano','bass','note("a2 ~ e2 ~ a2 c3 ~ e2").s("triangle").decay(0.18).sustain(0).gain(0.5)',['gain','lpf','decay']],
    ['clay-strum','Low Strum','bass','note("a1 ~ a1 a2 ~ a1 g1 ~").s("triangle").lpf(700).release(0.12).gain(0.44)',['gain','lpf','release']],
    ['clay-wood','Wooden Bar','melody','note("a4 c5 e5 c5 d5 b4 c5 a4").s("sine").fm(1).fmh(4).decay(0.22).sustain(0).gain(0.3)',['gain','room','decay']],
    ['clay-reed','Reed Call','melody','note("e5 ~ ~ g5 a5 ~ g5 e5 ~ ~ d5 ~ e5 ~ ~ ~").s("triangle").attack(0.04).room(0.25).gain(0.2)',['gain','lpf','room']],
    ['clay-shadow','Long Shadow','texture','note("[a2,e3] ~ [g2,d3] ~").s("sawtooth").slow(2).lpf(520).attack(0.5).release(1).room(0.3).gain(0.1)',['gain','lpf','room']],
    ['clay-bells','Wind Bells','texture','note("e6 ~ a5 ~ ~ c6 ~ ~").s("sine").slow(2).fm(3).fmh(3.5).decay(0.5).sustain(0).room(0.4).pan(0.62).gain(0.13)',['gain','pan','room']],
  ],ATTRIBUTION_V2),
  pack('tiny-robots','Tiny Robots',126,'Clicks, bleeps and tight machines',[
    ['bot-march','Servo March','beats','stack(s("bd ~ bd ~ bd ~ bd ~").gain(0.6), s("~ rim ~ rim ~ rim rim rim").gain(0.3))',['gain','lpf']],
    ['bot-flip','Bit Flip','beats','stack(s("bd bd ~ ~ sd ~ bd ~ ~ bd ~ ~ sd ~ ~ rim").gain(0.5), s("hh ~ ~ hh ~ ~ hh ~ ~ hh ~ ~ hh ~ hh hh").gain(0.13))',['gain','lpf']],
    ['bot-battery','Low Battery','bass','note("a1 ~ a1 ~ c2 ~ a1 ~").s("square").lpf(500).gain(0.19)',['gain','lpf','release']],
    ['bot-stepper','Stepper Motor','bass','note("a1 a2 a1 a2 c2 c3 e2 e3").s("pulse").lpf(1100).decay(0.1).sustain(0.3).gain(0.24)',['gain','lpf','decay']],
    ['bot-beep','Beep Code','melody','note("a5 ~ a5 e5 ~ ~ c6 ~").s("square").lpf(3200).release(0.03).gain(0.1)',['gain','lpf','release']],
    ['bot-readout','Readout','melody','note("a4 e5 a4 c5 a4 e5 g4 b4 a4 e5 a4 c5 a4 d5 e5 g5").s("pulse").decay(0.06).sustain(0.2).gain(0.22)',['gain','lpf','decay']],
    ['bot-coolant','Coolant','texture','note("a2 ~ ~ ~").s("sawtooth").slow(2).lpf(420).attack(0.6).release(1).gain(0.2)',['gain','lpf','release']],
    ['bot-spark','Spark Gap','texture','note("c7 ~ ~ ~ ~ g6 ~ ~").s("sine").fm(8).fmh(1.5).decay(0.08).sustain(0).pan(0.35).gain(0.13)',['gain','pan','fm']],
  ],ATTRIBUTION_V2),
  pack('rainy-window','Rainy Window',72,'Soft lo-fi for a slow afternoon',[
    ['rain-tap','Window Tap','beats','stack(s("bd ~ ~ ~ ~ ~ bd ~ ~ ~ bd ~ ~ ~ ~ ~").gain(0.5), s("~ ~ ~ ~ rim ~ ~ ~ ~ ~ ~ ~ rim ~ ~ rim").gain(0.28), s("hh ~ hh ~ hh ~ hh hh hh ~ hh ~ hh ~ hh ~").gain(0.09))',['gain','lpf']],
    ['rain-brush','Brushed Kit','beats','stack(s("bd ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~ ~ ~").gain(0.46), s("sh ~ sh sh sh ~ sh sh sh ~ sh sh sh ~ sh sh").gain(0.1), s("~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ sd ~ ~ ~").lpf(2400).gain(0.22))',['gain','room']],
    ['rain-upright','Upright','bass','note("a1 ~ c2 ~ e2 ~ g2 ~ f1 ~ a1 ~ c2 ~ e2 ~").s("triangle").lpf(640).decay(0.3).sustain(0.2).gain(0.5)',['gain','lpf','decay']],
    ['rain-puddle','Puddle','bass','note("a1 ~ ~ ~ e2 ~ ~ ~").s("sine").release(0.4).gain(0.46)',['gain','release']],
    ['rain-keys','Felt Keys','melody','note("[a3,c4,e4] ~ ~ [g3,b3,e4] ~ ~ [f3,a3,c4] ~").s("sine").fm(0.6).fmh(2).decay(0.6).sustain(0.2).release(0.4).room(0.25).gain(0.2)',['gain','room','release']],
    ['rain-sigh','Sigh','melody','note("e5 d5 c5 ~ ~ ~ a4 ~ c5 b4 a4 ~ ~ ~ ~ ~").s("triangle").slow(2).delay(0.3).room(0.3).gain(0.17)',['gain','room','delay']],
    ['rain-fog','Fogged Glass','texture','note("[a3,e4] [f3,c4]").s("sawtooth").slow(2).lpf(700).attack(0.8).release(1.6).room(0.35).gain(0.07)',['gain','lpf','room']],
    ['rain-drip','Gutter Drip','texture','note("~ ~ a6 ~ ~ e6 ~ ~ ~ c6 ~ ~ ~ ~ ~ ~").s("sine").decay(0.05).sustain(0).delay(0.4).pan(0.6).gain(0.15)',['gain','pan','delay']],
  ],ATTRIBUTION_V2),
  pack('carnival-float','Carnival Float',132,'Loud, bright and marching past',[
    ['carn-street','Street Band','beats','stack(s("bd ~ ~ bd bd ~ ~ bd bd ~ ~ bd bd ~ ~ bd").gain(0.55), s("sh sh sh sh sh sh sh sh sh sh sh sh sh sh sh sh").gain(0.11), s("~ ~ ~ ~ ~ ~ ht ~ ~ ~ ~ ~ ht ~ ht ~").gain(0.32))',['gain','lpf']],
    ['carn-cowbell','More Cowbell','beats','stack(s("cb ~ cb ~ ~ cb ~ cb ~ cb ~ cb cb ~ cb ~").gain(0.16), s("bd ~ ~ ~ sd ~ ~ ~ bd ~ bd ~ sd ~ ~ ~").gain(0.5))',['gain','lpf']],
    ['carn-tuba','Parade Tuba','bass','note("a1 ~ e2 ~ a1 ~ e2 ~ f1 ~ c2 ~ g1 ~ d2 ~").s("sawtooth").lpf(480).release(0.08).gain(0.3)',['gain','lpf','release']],
    ['carn-hop','Street Hop','bass','note("a1 a1 ~ a2 ~ a1 a2 ~").s("square").lpf(720).gain(0.18)',['gain','lpf','release']],
    ['carn-brass','Brass Stab','melody','note("[a4,c5,e5] ~ ~ [a4,c5,e5] ~ [g4,b4,d5] ~ ~").s("sawtooth").lpf(2000).decay(0.12).sustain(0.35).gain(0.14)',['gain','lpf','decay']],
    ['carn-whistle','Whistle','melody','note("a5 a5 c6 a5 g5 ~ e5 ~ a5 a5 c6 d6 e6 ~ ~ ~").s("sine").gain(0.16)',['gain','room','release']],
    ['carn-confetti','Confetti','texture','note("a6 e6 c6 e6 a6 ~ ~ ~").s("triangle").decay(0.06).sustain(0).pan(0.7).room(0.25).gain(0.18)',['gain','pan','room']],
    ['carn-crowd','Crowd Hum','texture','note("[a3,e4,a4] ~").s("supersaw").slow(2).lpf(900).attack(0.3).release(0.8).room(0.35).gain(0.07)',['gain','lpf','room']],
  ],ATTRIBUTION_V2),
  pack('deep-sea','Deep Sea',88,'Dark dub with long echoes',[
    ['sea-sonar','Sonar Pulse','beats','stack(s("bd ~ ~ ~ ~ ~ ~ ~ bd ~ ~ bd ~ ~ ~ ~").gain(0.6), s("~ ~ ~ ~ rim ~ ~ ~ ~ ~ ~ ~ rim ~ ~ ~").delay(0.4).gain(0.3))',['gain','lpf']],
    ['sea-hull','Hull Knock','beats','stack(s("lt ~ ~ ~ ~ ~ lt ~ ~ ~ ht ~ ~ ~ ~ ~").room(0.3).gain(0.5), s("~ ~ oh ~ ~ ~ oh ~ ~ ~ oh ~ ~ ~ oh ~").gain(0.07))',['gain','lpf']],
    ['sea-trench','Trench','bass','note("a1 ~ ~ ~ ~ ~ ~ ~ f1 ~ ~ ~ g1 ~ ~ ~").s("sine").release(0.5).gain(0.52)',['gain','release']],
    ['sea-current','Undercurrent','bass','note("a1 ~ a1 c2 ~ a1 ~ e2").s("triangle").lpf(420).delay(0.15).gain(0.46)',['gain','lpf','delay']],
    ['sea-lantern','Anglerfish','melody','note("a4 ~ ~ e5 ~ ~ d5 ~").s("sine").fm(0.8).delay(0.35).room(0.35).gain(0.2)',['gain','room','delay']],
    ['sea-song','Whale Song','melody','note("e4 ~ a4 ~ g4 ~ ~ ~ c5 ~ b4 ~ a4 ~ ~ ~").s("triangle").slow(2).attack(0.25).release(0.8).room(0.4).gain(0.16)',['gain','room','release']],
    ['sea-tide','Slow Tide','texture','note("[a2,e3,a3] [f2,c3,f3]").s("supersaw").slow(4).lpf(560).attack(1.2).release(2).room(0.4).gain(0.07)',['gain','lpf','room']],
    ['sea-bubbles','Bubbles','texture','note("a5 c6 e6 ~ ~ ~ ~ ~ ~ e6 a6 ~ ~ ~ ~ ~").s("sine").decay(0.07).sustain(0).pan(0.38).room(0.3).gain(0.18)',['gain','pan','room']],
  ],ATTRIBUTION_V2),
];
export const PRESETS: Preset[] = PACKS.flatMap(p=>p.presets);
export const presetById = (id:string, version?:number) => PRESETS.find(p=>p.id===id&&(version===undefined||p.version===version));
export const ROLE_LABEL: Record<Role,string> = {beats:'Beats',bass:'Bass',melody:'Melody',texture:'Texture'};
// A part with no factory role (old tracks, saved sounds) reads as Custom.
export const roleOf = (r:unknown):Role|'custom' => (ROLES as readonly unknown[]).includes(r) ? r as Role : 'custom';
