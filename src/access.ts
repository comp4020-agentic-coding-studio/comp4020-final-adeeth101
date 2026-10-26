// Who may see and change what. Visibility decides who may read; roles decide
// who may write. Every route asks here before it reads a row, and unauthorised
// requests for private things get the same answer as missing ones.
import {createHash,randomBytes} from 'node:crypto';
import {one} from './errors.ts';
import {hidden} from './errors.ts';
import type {Visitor} from './identity.ts';

export type Visibility='private'|'unlisted'|'public';
export type ProjectRole='owner'|'member';
export type ProjectAccess={project:Record<string,any>;role:ProjectRole|null;read:'member'|'view'};

export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export const newToken=()=>randomBytes(24).toString('base64url');

export function memberRole(projectId:string,visitorId:string):ProjectRole|null{
  return (one('select role from project_member where project_id=? and visitor_id=? and removed_at is null',projectId,visitorId)?.role as ProjectRole)??null;
}
export function hasGrant(visitorId:string,kind:string,resourceId:string,linkVersion:number){
  return !!one('select 1 from capability_grant where visitor_id=? and kind=? and resource_id=? and link_version=?',visitorId,kind,resourceId,linkVersion);
}
// Members read everything; others read only the published mix of a public
// project, or of an unlisted one whose view link they have redeemed.
export function projectAccess(v:Visitor,projectId:string):ProjectAccess|null{
  const project=one('select * from project where id=?',projectId);
  if(!project)return null;
  const role=memberRole(projectId,v.id);
  if(role)return {project,role,read:'member'};
  if(project.visibility==='public')return {project,role:null,read:'view'};
  if(project.visibility==='unlisted'&&hasGrant(v.id,'view',projectId,project.view_link_version))return {project,role:null,read:'view'};
  return null;
}
export function readProject(v:Visitor,projectId:string){const a=projectAccess(v,projectId);if(!a)throw hidden();return a;}
export function memberOf(v:Visitor,projectId:string){const a=projectAccess(v,projectId);if(!a||a.read!=='member')throw hidden();return a as ProjectAccess&{role:ProjectRole};}

// Performances: public ones are open while live; unlisted ones need the
// listen link (redeemed into a grant for this session's identity) or a role.
export type PerformanceAccess={performance:Record<string,any>;role:'host'|'member'|'performer'|'listener'};
export function performanceAccess(v:Visitor,performanceId:string):PerformanceAccess|null{
  const p=one('select * from performance where id=?',performanceId);
  if(!p)return null;
  const part=one('select * from performance_participant where performance_id=? and visitor_id=?',performanceId,v.id);
  if(part?.removed)return null;
  const member=memberRole(p.project_id,v.id);
  if(p.host_id===v.id&&member)return {performance:p,role:'host'};
  if(member)return {performance:p,role:'member'};
  // Guest and audience access lasts only as long as the session.
  if(p.status!=='live')return null;
  if(part?.role==='performer')return {performance:p,role:'performer'};
  if(p.visibility==='public')return {performance:p,role:'listener'};
  if(hasGrant(v.id,'listen',performanceId,p.link_version))return {performance:p,role:'listener'};
  return null;
}
export function readPerformance(v:Visitor,id:string){const a=performanceAccess(v,id);if(!a)throw hidden();return a;}
