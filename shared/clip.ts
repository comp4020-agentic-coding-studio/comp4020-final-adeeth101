// A saved part is either a version 1 tree (Stream's grid model, kept for old
// pieces) or a version 2 expression (source-first). Both validate here; neither
// is converted into the other. A version 1 clip without stored source is shown
// as its deterministic print, which the version 2 parser accepts unchanged.
import {validateDocument,type ClipDocument} from './music.ts';
import {printNode} from './code.ts';
import {validateExpr,parseSource,type ExprDocument} from './expr.ts';

export type AnyDocument=ClipDocument|ExprDocument;
export function validateAny(doc:unknown):AnyDocument{
  return (doc as {schemaVersion?:unknown})?.schemaVersion===2?validateExpr(doc):validateDocument(doc);
}
export function sourceOf(doc:AnyDocument,source:string|null|undefined):string{
  if(typeof source==='string'&&source.length)return source;
  if(doc.schemaVersion===1)return printNode(doc.root);
  throw new Error('An expression part always carries its source.');
}
// What the server stores for submitted code: the source verbatim, and the
// expression parsed from it.
export function fromSource(source:string){const {document,bounds}=parseSource(source);return {document,source,bounds};}
