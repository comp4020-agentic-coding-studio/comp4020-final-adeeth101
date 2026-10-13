import {StudioAudio} from './audio.ts';
import {parseCode} from '../shared/code.ts';
import {blankPlan} from '../shared/performance.ts';
const audio=new StudioAudio();
const global=window as unknown as {studioAudio:StudioAudio;testAudio:(epoch:number)=>Promise<void>};
global.studioAudio=audio;
global.testAudio=async(epoch)=>{await audio.prepare();const plan=blankPlan();plan.catalog.t={A:{revision:1,document:parseCode('note("60 ~ 64 ~").s("triangle")')}};plan.sceneAssignments.A.t='A';audio.update([plan],epoch,120,1);audio.startAt();};
