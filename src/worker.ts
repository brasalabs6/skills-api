import { Hono } from "hono";
import type { Env, Vars } from "./types";
import assets from "./server/assets";
import { authenticate, p } from "./server/auth";
import { ApiError, assertSameOrigin, aud, dbError, decrypt, encrypt, json, parse, requireHuman, sha256, uid } from "./server/core";
import { sweep, processEvent } from "./server/async";

const app=new Hono<Vars>();
app.onError((e,c)=>{
  const err=e instanceof ApiError?e:new ApiError("internal_error",500);
  if(err.status===500)console.error(JSON.stringify({event:"api.error",requestId:c.get("requestId"),message:String(e)}));
  return c.json({error:{code:err.code,message:err.code,details:err.details},request_id:c.get("requestId")},err.status as any);
});
app.use("*",async(c,next)=>{c.set("requestId",crypto.randomUUID());c.header("x-content-type-options","nosniff");c.header("referrer-policy","no-referrer");c.header("cache-control","no-store");await next();});
app.get("/healthz",c=>c.json({status:"ok",service:"skills-api"}));
app.use("/v1/*",async(c,next)=>{assertSameOrigin(c.req.raw);await next();});
app.use("/v1/*",authenticate);
app.get("/v1/me",async c=>{
  const who=p(c);
  return c.json({principal:{kind:who.kind,email:who.email??null,role:who.role,workspace_id:who.workspace_id,organization_id:who.organization_id,scopes:who.scopes??[]}});
});
app.get("/v1/audit-logs",async c=>{
  const who=p(c);requireHuman(who,["publisher","admin"]);
  const rows=await c.env.DB.prepare("SELECT id,actor_id,event_type,asset_id,version,before_json,after_json,reason,created_at FROM ai_asset_audit_logs WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100").bind(who.workspace_id).all<any>();
  return c.json({items:rows.results.map(x=>({...x,before:parse(x.before_json,null),after:parse(x.after_json,null),before_json:undefined,after_json:undefined}))});
});
app.get("/v1/executions",async c=>{
  const who=p(c);requireHuman(who);
  const rows=await c.env.DB.prepare("SELECT trace_id,asset_id,resolved_version,requested_ref,status,model,latency_ms,created_at FROM ai_asset_executions WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100").bind(who.workspace_id).all();
  return c.json({items:rows.results});
});
app.post("/v1/executions/:traceId",async c=>{
  const who=p(c),b=await c.req.json<any>();
  if(who.kind!=="service"||!who.scopes?.includes("execution:report"))throw new ApiError("permission_denied",403);
  if(!["success","failure"].includes(b.status))throw new ApiError("validation_error",422);
  const row=await c.env.DB.prepare("UPDATE ai_asset_executions SET status=?,model=?,latency_ms=?,input_hash=?,output_hash=? WHERE trace_id=? AND workspace_id=? AND status='resolved' RETURNING trace_id").bind(b.status,b.model??null,Number.isInteger(b.latency_ms)?b.latency_ms:null,b.input_hash??null,b.output_hash??null,c.req.param("traceId"),who.workspace_id).first();
  if(!row)throw new ApiError("execution_not_found",404);
  return c.json({ok:true});
});
app.get("/v1/admin/members",async c=>{
  const who=p(c);requireHuman(who,["admin"]);
  const rows=await c.env.DB.prepare("SELECT u.id,u.email,u.access_subject,m.role,m.active FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?").bind(who.workspace_id).all();
  return c.json({items:rows.results});
});
app.post("/v1/admin/members",async c=>{
  const who=p(c);requireHuman(who,["admin"]);const b=await c.req.json<any>();
  if(!["viewer","editor","publisher","admin"].includes(b.role)||typeof b.access_subject!=="string"||b.access_subject.length>200||typeof b.email!=="string"||!b.email.includes("@"))throw new ApiError("validation_error",422);
  const user=uid();
  try{await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO users(id,access_subject,email) VALUES(?,?,?) ON CONFLICT(access_subject) DO NOTHING").bind(user,b.access_subject,b.email.toLowerCase()),
    c.env.DB.prepare("INSERT INTO workspace_members(workspace_id,user_id,role,active) SELECT ?,id,?,1 FROM users WHERE access_subject=? ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,active=1").bind(who.workspace_id,b.role,b.access_subject),
    aud(c.env.DB,who,"member.upserted",null,null,null,{subject:b.access_subject,role:b.role})
  ]);}catch(e){dbError(e);}
  return c.json({ok:true},201);
});
app.get("/v1/admin/service-tokens",async c=>{
  const who=p(c);requireHuman(who,["admin"]);
  const res=await c.env.DB.prepare("SELECT id,name,scopes_json,created_at,expires_at,revoked_at FROM service_tokens WHERE workspace_id=? ORDER BY created_at DESC").bind(who.workspace_id).all<any>();
  return c.json({items:res.results.map(x=>({...x,scopes:parse(x.scopes_json,[]),scopes_json:undefined}))});
});
app.post("/v1/admin/service-tokens",async c=>{
 const who=p(c);requireHuman(who,["admin"]);const b=await c.req.json<any>();
 const allowed=["asset:resolve","execution:report"],scopes=b.scopes??["asset:resolve"];
 if(typeof b.name!=="string"||!b.name.trim()||!Array.isArray(scopes)||!scopes.length||scopes.some((s:any)=>!allowed.includes(s)))throw new ApiError("validation_error",422);
 const secret="reg_"+crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-",""),hash=await sha256(secret),id=uid();
 await c.env.DB.batch([c.env.DB.prepare("INSERT INTO service_tokens(id,workspace_id,name,token_hash,scopes_json,created_by,expires_at) VALUES(?,?,?,?,?,?,?)").bind(id,who.workspace_id,b.name,hash,json(scopes),who.id,b.expires_at??null),aud(c.env.DB,who,"service_token.created",null,null,null,{id,name:b.name})]);
 return c.json({id,token:secret,scopes},201);
});
app.delete("/v1/admin/service-tokens/:id",async c=>{
 const who=p(c);requireHuman(who,["admin"]);
 await c.env.DB.batch([c.env.DB.prepare("UPDATE service_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?").bind(c.req.param("id"),who.workspace_id),aud(c.env.DB,who,"service_token.revoked",null,null,null,{id:c.req.param("id")})]);return c.body(null,204);
});
app.get("/v1/webhooks",async c=>{
 const who=p(c);requireHuman(who,["admin","publisher"]);
 const o=await c.env.DB.prepare("SELECT id,url,events_json,enabled,created_at FROM webhook_endpoints WHERE workspace_id=? ORDER BY created_at DESC").bind(who.workspace_id).all<any>();
 return c.json({items:o.results.map(x=>({...x,events:parse(x.events_json,[]),events_json:undefined}))});
});
app.post("/v1/webhooks",async c=>{
 const who=p(c);requireHuman(who,["admin"]);const b=await c.req.json<any>();
 let url:URL;try{url=new URL(b.url);}catch{throw new ApiError("validation_error",422);}
 if(url.protocol!=="https:"||url.username||url.password||url.port||url.hostname==="localhost"||url.hostname.endsWith(".local")||url.hostname.endsWith(".internal")||url.hostname.endsWith(".localhost")||url.hostname.match(/^\d+\.\d+\.\d+\.\d+$/)||url.hostname.includes(":"))throw new ApiError("validation_error",422,{field:"url"});
 const types=["asset.published","asset.rollback","asset.version_created"],events=b.events??types;
 if(!Array.isArray(events)||!events.length||events.some((v:any)=>!types.includes(v)))throw new ApiError("validation_error",422);
 const raw=crypto.randomUUID()+crypto.randomUUID(),id=uid(),secret=await encrypt(c.env,raw);
 await c.env.DB.batch([c.env.DB.prepare("INSERT INTO webhook_endpoints(id,workspace_id,url,encrypted_secret,events_json) VALUES(?,?,?,?,?)").bind(id,who.workspace_id,url.toString(),secret,json(events)),aud(c.env.DB,who,"webhook.created",null,null,null,{id,url:url.origin})]);
 return c.json({id,secret:raw,events,url:url.toString()},201);
});
app.delete("/v1/webhooks/:id",async c=>{
 const who=p(c);requireHuman(who,["admin"]);
 await c.env.DB.batch([c.env.DB.prepare("UPDATE webhook_endpoints SET enabled=0 WHERE id=? AND workspace_id=?").bind(c.req.param("id"),who.workspace_id),aud(c.env.DB,who,"webhook.disabled",null,null,null,{id:c.req.param("id")})]);
 return c.body(null,204);
});
app.get("/v1/webhook-deliveries",async c=>{
 const who=p(c);requireHuman(who,["admin","publisher"]);
 const o=await c.env.DB.prepare("SELECT d.id,d.event_id,d.status,d.attempts,d.delivered_at,d.last_response_code,e.url FROM webhook_deliveries d JOIN webhook_endpoints e ON d.endpoint_id=e.id WHERE e.workspace_id=? ORDER BY d.next_attempt_at DESC LIMIT 100").bind(who.workspace_id).all();
 return c.json({items:o.results});
});
app.route("/v1",assets);
export default {
  fetch(request:Request,env:Env,ctx:ExecutionContext){return app.fetch(request,env,ctx);},
  async scheduled(_:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(sweep(env));},
  async queue(batch:MessageBatch<{event_id:string}>,env:Env,ctx:ExecutionContext){
    for(const message of batch.messages){try{await processEvent(env,message.body.event_id);message.ack();}catch(e){console.error("queue.error",String(e));message.retry();}}
  }
};
