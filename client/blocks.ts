import * as Blockly from 'blockly';
import {validateDocument,type MusicNode,type ClipDocument,type Op} from '../shared/music.ts';
const definitions:any[]=[
  {type:'music_sound',message0:'drums %1',args0:[{type:'field_input',name:'STEPS',text:'bd ~ sd ~'}],output:'Pattern',colour:165,tooltip:'Sounds: bd, sd, hh, cp. Use ~ for a rest.'},
  {type:'music_notes',message0:'notes %1 instrument %2',args0:[{type:'field_input',name:'STEPS',text:'60 ~ 64 67'},{type:'field_dropdown',name:'SYNTH',options:['triangle','sine','square','sawtooth'].map(s=>[s,s])}],output:'Pattern',colour:265},
  {type:'music_stack',message0:'together %1 %2 %3 %4',args0:[0,1,2,3].map(i=>({type:'input_value',name:`P${i}`,check:'Pattern'})),output:'Pattern',colour:35,inputsInline:false,tooltip:'Connect two to four patterns.'},
  ...(['fast','slow','rev','gain','lpf','room'] as Op[]).map(op=>({type:`music_${op}`,message0:`${({fast:'faster',slow:'slower',rev:'reverse',gain:'volume',lpf:'low-pass',room:'reverb'} as Record<string,string>)[op]} ${op==='rev'?'%1':'%1 %2'}`,args0:[...(op==='rev'?[]:op==='fast'||op==='slow'?[{type:'field_dropdown',name:'VALUE',options:[['2×','2'],['4×','4']]}]:[{type:'field_number',name:'VALUE',value:op==='gain'?0.7:op==='lpf'?2000:0.15,min:op==='lpf'?100:0,max:op==='gain'?1:op==='lpf'?12000:0.5,precision:op==='lpf'?1:0.01}]),{type:'input_value',name:'P',check:'Pattern'}],output:'Pattern',colour:op==='fast'||op==='slow'||op==='rev'?35:210})),
];
Blockly.common.defineBlocksWithJsonArray(definitions);
export function blockToNode(block:Blockly.Block):MusicNode{
  const type=block.type.slice(6);
  if(type==='sound'||type==='notes'){
    const tokens=String(block.getFieldValue('STEPS')).trim().split(/\s+/);
    return type==='sound'?{kind:'sound',steps:tokens.map(x=>x==='~'?null:x) as any}:{kind:'notes',synth:block.getFieldValue('SYNTH'),steps:tokens.map(x=>x==='~'?null:Number(x))};
  }
  if(type==='stack')return {kind:'stack',children:[0,1,2,3].map(i=>block.getInputTargetBlock(`P${i}`)).filter((x):x is Blockly.Block=>!!x).map(blockToNode)};
  const child=block.getInputTargetBlock('P');if(!child)throw new Error('Connect a pattern to this block.');
  return {kind:'transform',op:type as Op,...(type!=='rev'?{value:Number(block.getFieldValue('VALUE'))}:{}),child:blockToNode(child)};
}
export function nodeToBlock(workspace:Blockly.Workspace,n:MusicNode):Blockly.Block{
  const b=workspace.newBlock(`music_${n.kind==='sound'?'sound':n.kind==='notes'?'notes':n.kind==='stack'?'stack':n.op}`);
  if(n.kind==='sound'||n.kind==='notes'){b.setFieldValue(n.steps.map(x=>x??'~').join(' '),'STEPS');if(n.kind==='notes')b.setFieldValue(n.synth,'SYNTH');}
  else if(n.kind==='stack')n.children.forEach((child,i)=>{const c=nodeToBlock(workspace,child);b.getInput(`P${i}`)!.connection!.connect(c.outputConnection!);});
  else {if(n.op!=='rev')b.setFieldValue(String(n.value),'VALUE');const c=nodeToBlock(workspace,n.child);b.getInput('P')!.connection!.connect(c.outputConnection!);}
  if(b instanceof Blockly.BlockSvg){b.initSvg();b.render();}
  return b;
}
export class BlockEditor{
  workspace:Blockly.WorkspaceSvg;
  private updating=false;
  constructor(container:HTMLElement,doc:ClipDocument,onChange:(doc:ClipDocument|null,error?:string)=>void,saved?:object){
    this.workspace=Blockly.inject(container,{toolbox:{kind:'categoryToolbox',contents:[{kind:'category',name:'Sounds',colour:'165',contents:[{kind:'block',type:'music_sound'},{kind:'block',type:'music_notes'}]},{kind:'category',name:'Structure',colour:'35',contents:[{kind:'block',type:'music_stack'},...['fast','slow','rev'].map(op=>({kind:'block',type:`music_${op}`}))]},{kind:'category',name:'Effects',colour:'210',contents:['gain','lpf','room'].map(op=>({kind:'block',type:`music_${op}`}))}]},trashcan:true,zoom:{controls:true,wheel:true,startScale:0.85,minScale:0.3,maxScale:1.5},move:{scrollbars:true,drag:true,wheel:true},grid:{spacing:24,length:2,colour:'#b9c2ce',snap:false}});
    this.updating=true;Blockly.Events.disable();
    if(saved)try{Blockly.serialization.workspaces.load(saved,this.workspace);}catch{this.workspace.clear();nodeToBlock(this.workspace,doc.root);}
    else nodeToBlock(this.workspace,doc.root);
    Blockly.Events.enable();this.updating=false;this.workspace.zoomToFit();
    this.workspace.addChangeListener(event=>{if(this.updating||event.isUiEvent)return;
      try{const roots=this.workspace.getTopBlocks(false);if(roots.length!==1)throw new Error('Connect all blocks into one pattern. Detached blocks are not applied.');onChange(validateDocument({schemaVersion:1,root:blockToNode(roots[0])}));}
      catch(e){onChange(null,e instanceof Error?e.message:'Incomplete blocks.');}
    });
  }
  save(){return Blockly.serialization.workspaces.save(this.workspace);}
  dispose(){this.workspace.dispose();}
}
