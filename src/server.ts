// The composition root: it owns the routing table and nothing else. Handlers
// live in their own modules, so several people can work at once without two of
// them editing the same file. Adding a route is the one change that belongs
// here.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "./markdown.ts";
import { cleanHandle, cookieHeader, identify, persist, rename, type Visitor } from "./identity.ts";
import { act, state } from "./feature.ts";
import { record, stream } from "./events.ts";
import { page, readmePage } from "./page.ts";
import {createProject,command,snapshot,projectStream,roomHeartbeat,exportProject,importProject,projectChat,sendProjectChat,deleteProjectChat,mySounds,saveSound,deleteSound,myProjects,publicProjects,heartbeat,CommandError} from './studio.ts';
import {friendsView,friendAction,notifications,clearNotification,accountStream,createInvitation,listInvitations,revokeInvitation,previewInvitation,acceptInvitation,redeemViewLink,redeemListenLink,makeRecovery,recover,me} from './social.ts';
import {startPerformance,endPerformance,audienceSnapshot,audienceStream,livePerformances,performanceChat,sendPerformanceChat,react,moderate,rotateListenLink,guestCommand} from './performances.ts';
import {closeAll} from './hub.ts';
import {projectAccess,performanceAccess} from './access.ts';
import {appPage,archiveHtml} from './studio-page.ts';
import {PACKS} from '../shared/presets.ts';

const PORT = Number(process.env.PORT ?? 8080);
// fileURLToPath, not .pathname: a path with a space in it arrives
// percent-encoded otherwise, and every read of README.md or public/ fails.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

const send = (
  res: ServerResponse,
  status: number,
  type: string,
  body: string | Buffer,
  extra: Record<string, string> = {},
): void => {
  res.writeHead(status, { "content-type": type, ...extra });
  res.end(body);
};

const json = (res: ServerResponse, status: number, body: unknown, extra = {}): void =>
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body), extra);
// Anything that depends on who is asking must never sit in a shared cache.
const PRIVATE = { "cache-control": "private, no-store" };

const html = (res: ServerResponse, status: number, body: string, extra = {}): void =>
  send(res, status, "text/html; charset=utf-8", body, extra);

// Bodies are small by design; anything larger is a mistake or an attack, and
// either way the app should not hold it in memory.
async function readJson(req: IncomingMessage, limit = 64*1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");

  // A plain <form> post is form-encoded, and the no-JS path depends on it
  // being understood here exactly like the fetch path's JSON.
  if ((req.headers["content-type"] ?? "").includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    throw new Error("body is not json");
  }
}

// A browser submitting a real form wants a page back, not JSON. Answering with
// a redirect also means a reload won't re-post the same text.
const wantsHtml = (req: IncomingMessage): boolean =>
  (req.headers["content-type"] ?? "").includes("application/x-www-form-urlencoded") ||
  (!(req.headers.accept ?? "").includes("application/json") &&
    (req.headers.accept ?? "").includes("text/html"));


async function serveStatic(res: ServerResponse, pathname: string, assets=false): Promise<boolean> {
  // normalize collapses '..' before anything is joined; a path that still
  // escapes public/ afterwards is refused rather than cleaned, so there is no
  // sanitiser to outsmart.
  const rel = normalize(pathname.replace(assets ? /^\/assets\// : /^\/static\//, ""));
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  try {
    const body = await readFile(join(ROOT, assets ? 'dist/client' : "public", rel));
    send(res, 200, TYPES[extname(rel)] ?? "application/octet-stream", body, {
      // Revalidate every time. With max-age a browser kept the old app.js
      // for five minutes after a deploy, running it against new HTML. These
      // files are small; a stale script that disagrees with its page is not.
      "cache-control": "no-cache",
    });
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";

  // Set on the first response to a new browser; sending it on every response
  // would reset the year-long expiry for no reason. Fly terminates TLS in
  // front of the app, so HTTPS shows up only in the forwarded header.
  const secure = req.headers["x-forwarded-proto"] === "https";
  const cookie = (visitor: Visitor): Record<string, string> =>
    visitor.fresh ? { "set-cookie": cookieHeader(visitor, secure) } : {};

  try {
    // Fly's health check, and the one route that touches neither the database
    // nor a cookie --- so it still answers when something else is broken.
    if (path === "/healthz") return json(res, 200, { ok: true });

    if (path.startsWith('/assets/')) {
      if(await serveStatic(res,url.pathname,true))return;
      return json(res,404,{error:'Asset not found.'});
    }

    if(method === 'POST'){
      // A sandboxed or file:// page sends "Origin: null", which is not a URL.
      // Anything that will not parse is treated as another site rather than as
      // a reason to fail: before this, it threw and the server answered 500.
      const origin=req.headers.origin;
      const foreign=origin===undefined?false:(()=>{try{return new URL(origin).host!==req.headers.host;}catch{return true;}})();
      if(req.headers['sec-fetch-site']==='cross-site'||foreign)return json(res,403,{error:'Send changes from this studio.'});
    }

    if (path.startsWith("/static/")) {
      if (await serveStatic(res, url.pathname)) return;
      return send(res, 404, "text/plain; charset=utf-8", "not found");
    }

    // README.md is read per request, not cached at boot: the spec compares the
    // served headings against the file on disk, and a stale copy fails it.
    if (path === "/readme") {
      const markdown = await readFile(join(ROOT, "README.md"), "utf8");
      return html(res, 200, readmePage(render(markdown)));
    }

    const visitor = identify(req.headers.cookie);
    const cursorOf = () => { const c = Number(req.headers['last-event-id'] ?? url.searchParams.get('since') ?? 0); return Number.isFinite(c) ? c : 0; };
    const ok = (body: unknown, status = 200) => json(res, status, body, { ...PRIVATE, ...cookie(visitor) });

    if (path === '/api/time') return json(res,200,{serverNowMs:Date.now()},PRIVATE);
    // Every Ensemble mutation is JSON. A plain form may still create a mix, so
    // the no-script landing page keeps working.
    if(method==='POST'&&path.startsWith('/api/')&&!['/api/act','/api/handle','/api/projects'].includes(path)&&!(req.headers['content-type']??'').includes('application/json'))return json(res,415,{error:'Send JSON.'});
    if(path === '/api/projects' && method === 'POST'){
      const result=createProject(visitor,(await readJson(req)).title);
      if(wantsHtml(req)){res.writeHead(303,{location:`/p/${result.id}?new=1`,...cookie(visitor)});return res.end();}
      return ok(result,201);
    }
    if(path === '/api/projects' && method === 'GET')return ok({projects:myProjects(visitor)});
    if(path === '/api/discover' && method === 'GET')return ok({projects:publicProjects(Number(url.searchParams.get('page')??0))});
    if(path === '/api/live' && method === 'GET')return ok({performances:livePerformances(Number(url.searchParams.get('page')??0))});
    if(path === '/api/presets' && method === 'GET')return json(res,200,{packs:PACKS},{'cache-control':'no-cache'});
    if(path === '/api/import' && method === 'POST')return ok(importProject(visitor,await readJson(req,512*1024)),201);
    if(path === '/api/sounds'){if(method==='GET')return ok({sounds:mySounds(visitor)});if(method==='POST')return ok(saveSound(visitor,await readJson(req)),201);}
    const sound=path.match(/^\/api\/sounds\/([0-9a-f-]+)\/delete$/);if(sound&&method==='POST')return ok(deleteSound(visitor,sound[1]));
    if(path === '/api/friends'){if(method==='GET')return ok(friendsView(visitor));if(method==='POST')return ok(friendAction(visitor,await readJson(req)));}
    if(path === '/api/notifications' && method==='GET')return ok({notifications:notifications(visitor)});
    const note=path.match(/^\/api\/notifications\/(\d+)\/clear$/);if(note&&method==='POST')return ok(clearNotification(visitor,Number(note[1])));
    if(path === '/api/account/events' && method==='GET'){res.setHeader('set-cookie',cookieHeader(visitor,secure));accountStream(visitor,res,cursorOf());return;}
    if(path === '/api/heartbeat' && method==='POST'){heartbeat(visitor);return ok({ok:true});}
    if(path === '/api/recovery' && method==='POST')return ok(makeRecovery(visitor));
    if(path === '/api/recover' && method==='POST'){
      const found=recover(visitor,(await readJson(req)).code,String(req.headers['fly-client-ip']??req.socket.remoteAddress??''));
      // A new signed session for the recovered identity on this device.
      return json(res,200,{id:found.id,handle:found.handle},{...PRIVATE,'set-cookie':cookieHeader({...found,fresh:true},secure)});
    }
    if(path === '/api/invitations' && method==='POST')return ok(createInvitation(visitor,await readJson(req)),201);
    const invite=path.match(/^\/api\/invitations\/([0-9a-f-]+)\/(preview|accept|decline|revoke)$/);
    if(invite&&method==='POST'){
      const [,iid,act2]=invite,body=await readJson(req);
      if(act2==='preview')return ok(previewInvitation(visitor,iid,body.token));
      if(act2==='revoke')return ok(revokeInvitation(visitor,iid));
      return ok(acceptInvitation(visitor,iid,body.token,act2==='decline'));
    }
    const apiProject=path.match(/^\/api\/projects\/([0-9a-f-]+)(?:\/(commands|events|presence|export|chat|invitations|view-link|go-live))?$/);
    if(apiProject){
      const [,id,action]=apiProject;
      if(!action && method==='GET')return ok(snapshot(visitor,id));
      if(action==='commands'&&method==='POST')return ok(command(visitor,id,await readJson(req)));
      if(action==='events'&&method==='GET'){res.setHeader('set-cookie',cookieHeader(visitor,secure));projectStream(id,visitor,res,cursorOf());return;}
      if(action==='presence'&&method==='POST'){roomHeartbeat(visitor,id);return ok({ok:true});}
      if(action==='export'&&method==='GET')return json(res,200,exportProject(visitor,id),{...PRIVATE,'content-disposition':'attachment; filename="ensemble-mix.json"',...cookie(visitor)});
      if(action==='chat'&&method==='GET')return ok(projectChat(visitor,id,url.searchParams.get('before')));
      if(action==='chat'&&method==='POST'){const body=await readJson(req);return ok(body.delete!==undefined?deleteProjectChat(visitor,id,body.delete):sendProjectChat(visitor,id,body));}
      if(action==='invitations'&&method==='GET')return ok({invitations:listInvitations(visitor,'project',id)});
      if(action==='view-link'&&method==='POST')return ok(redeemViewLink(visitor,id,(await readJson(req)).token));
      if(action==='go-live'&&method==='POST')return ok(startPerformance(visitor,id,await readJson(req)),201);
      return json(res,405,{error:'Method not allowed.'},{allow:['commands','presence','view-link','go-live'].includes(action)?'POST':'GET'});
    }
    const apiPerf=path.match(/^\/api\/performances\/([0-9a-f-]+)(?:\/(events|chat|react|moderate|end|listen-link|rotate-link|commands|invitations))?$/);
    if(apiPerf){
      const [,pid,action]=apiPerf;
      if(!action&&method==='GET')return ok(audienceSnapshot(visitor,pid));
      if(action==='events'&&method==='GET'){res.setHeader('set-cookie',cookieHeader(visitor,secure));audienceStream(visitor,pid,res,cursorOf());return;}
      if(action==='chat'&&method==='GET')return ok(performanceChat(visitor,pid));
      if(action==='invitations'&&method==='GET')return ok({invitations:listInvitations(visitor,'perform',pid)});
      if(method==='POST'){
        const body=await readJson(req);
        if(action==='chat')return ok(sendPerformanceChat(visitor,pid,body));
        if(action==='react')return ok(react(visitor,pid,body.reaction));
        if(action==='moderate')return ok(moderate(visitor,pid,body));
        if(action==='end')return ok(endPerformance(visitor,pid));
        if(action==='listen-link')return ok(redeemListenLink(visitor,pid,body.token));
        if(action==='rotate-link')return ok(rotateListenLink(visitor,pid));
        if(action==='commands')return ok(guestCommand(visitor,pid,body));
      }
      return json(res,405,{error:'Method not allowed.'});
    }
    // Pages. A project room is rendered only for someone who may read it; a
    // private project answers exactly like a missing one.
    const room=path.match(/^\/p\/([0-9a-f-]+)(?:\/(compose|perform))?$/);
    if(room){
      if(room[2]){res.writeHead(301,{location:`/p/${room[1]}`});return res.end();}
      const a=projectAccess(visitor,room[1]);
      // A view link carries its token in the fragment, which the server never
      // sees: the page loads generically and exchanges the token by POST.
      if(!a)return html(res,404,await appPage({view:'room',projectId:room[1],missing:true}),{...PRIVATE,...cookie(visitor)});
      return html(res,200,await appPage({view:'room',projectId:room[1],title:a.project.title}),{...PRIVATE,...cookie(visitor)});
    }
    const livePage=path.match(/^\/live\/([0-9a-f-]+)$/);
    if(livePage){const a=performanceAccess(visitor,livePage[1]);return html(res,200,await appPage({view:'audience',performanceId:livePage[1],title:a?.performance.title}),{...PRIVATE,...cookie(visitor)});}
    if(path==='/live')return html(res,200,await appPage({view:'live'}),{...PRIVATE,...cookie(visitor)});
    if(path==='/friends')return html(res,200,await appPage({view:'friends'}),{...PRIVATE,...cookie(visitor)});
    if(path==='/discover')return html(res,200,await appPage({view:'discover'}),{...PRIVATE,...cookie(visitor)});
    const invitePage=path.match(/^\/invite\/([0-9a-f-]+)$/);
    // The invitation token is in the fragment, which is never sent anywhere;
    // same-origin keeps the invitation URL itself out of other sites' logs
    // while leaving same-origin form posts working.
    if(invitePage)return html(res,200,await appPage({view:'invite',invitationId:invitePage[1]}),{...PRIVATE,'referrer-policy':'same-origin',...cookie(visitor)});
    if(path === '/')return html(res,200,await appPage({view:'play'}),{...PRIVATE,...cookie(visitor)});
    if(path === '/archive')return html(res,200,readmePage(`<h1>Earlier source sketches</h1>${archiveHtml()}`),cookie(visitor));
    if (path === "/legacy") {
      return html(res, 200, page(state(visitor)), cookie(visitor));
    }

    if (path === "/api/me") return json(res, 200, me(visitor), { ...PRIVATE, ...cookie(visitor) });

    if (path === "/api/state") {
      return json(res, 200, state(visitor), cookie(visitor));
    }

    if (path === "/api/events" && method === "GET") {
      const last = Number(req.headers["last-event-id"] ?? url.searchParams.get("since") ?? 0);
      stream(res, Number.isFinite(last) ? last : 0);
      return;
    }

    if (path === "/api/handle" && method === "POST") {
      const handle = cleanHandle((await readJson(req)).handle);
      if (!handle) {
        const error = "A name needs at least one character.";
        return wantsHtml(req)
          ? html(res, 400, page(state(visitor), error), cookie(visitor))
          : json(res, 400, { error });
      }
      rename(visitor, handle);
      record(visitor.id, "visitor.renamed", { handle });
      if (wantsHtml(req)) {
        res.writeHead(303, { location: "/", ...cookie(visitor) });
        return res.end();
      }
      return json(res, 200, { ...visitor, handle }, cookie(visitor));
    }

    if (path === "/api/act" && method === "POST") {
      const input = await readJson(req);
      persist(visitor);
      const result = act(visitor, input);
      if (wantsHtml(req)) {
        if (result.ok) {
          res.writeHead(303, { location: "/", ...cookie(visitor) });
          return res.end();
        }
        // The refused text goes back into the editor: without a script there
        // is no other copy of it, and a refusal shouldn't cost someone what
        // they wrote.
        const draft = typeof input.body === "string" ? input.body : undefined;
        return html(res, result.status, page(state(visitor), result.error, draft), cookie(visitor));
      }
      return result.ok
        ? json(res, 200, result.state, cookie(visitor))
        : json(res, result.status, { error: result.error }, cookie(visitor));
    }

    // A GET to a POST-only route is a mistake worth naming, not a 404.
    if (["/api/act", "/api/handle"].includes(path)) {
      return json(res, 405, { error: `${path} wants POST` }, { allow: "POST" });
    }

    return html(res, 404, page(state(visitor), "There's nothing at that address."), cookie(visitor));
  } catch (error) {
    if(error instanceof CommandError)return json(res,error.status,{error:error.message,current:error.current},error.status===429?{'retry-after':'1'}:{});
    const message = error instanceof Error ? error.message : "unknown";
    // Logged here and nowhere else, so week 11's instruments have one seam to
    // widen rather than a scatter of console calls.
    console.error(JSON.stringify({ at: Date.now(), level: "error", path, method, message }));
    if (res.headersSent) return res.end();
    const status = message === "body too large" ? 413 : message === "body is not json" ? 400 : 500;
    return json(res, status, { error: status < 500 ? message : "something broke" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ at: Date.now(), level: "info", msg: `listening on ${PORT}` }));
});

// Fly stops the machine when nobody's using it: close cleanly so WAL is
// checkpointed and the next visitor doesn't open a half-written database.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  // Live streams never end on their own, so they are closed explicitly;
  // otherwise close() would wait for them until Fly gives up and kills us.
  process.on(signal, () => { closeAll(); server.close(() => process.exit(0)); server.closeAllConnections(); });
}
