import type { Context, MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Vars, Principal } from "../types";
import { ApiError, now, parse, sha256, uid } from "./core";

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksIssuer: string | null = null;
function getJWKS(domain: string) {
  if (!jwksCache || jwksIssuer!==domain) {
    jwksCache=createRemoteJWKSet(new URL("/cdn-cgi/access/certs",domain));
    jwksIssuer=domain;
  }
  return jwksCache;
}
async function getIdentity(c:Context<Vars>):Promise<{sub:string;email:string}|null>{
  const env=c.env, cookie=c.req.header("cookie")?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  const token=c.req.header("cf-access-jwt-assertion")||cookie;
  if(token && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD){
    const issuer=env.ACCESS_TEAM_DOMAIN.replace(/\/$/,"");
    const verified=await jwtVerify(token,getJWKS(issuer),{issuer:issuer+"/",audience:env.ACCESS_AUD});
    const sub=String(verified.payload.sub??"");
    const email=String(verified.payload.email??"").toLowerCase();
    if(sub && email)return {sub,email};
  }
  // Only explicit localhost loopback opt-in; NEVER active on deployed workers.dev.
  if(env.APP_ENV==="local" && new URL(c.req.url).hostname==="localhost" && c.req.header("x-local-dev-key")===(env as any).LOCAL_DEV_KEY && (env as any).LOCAL_DEV_KEY){
    return {sub:"local-dev",email:String(env.BOOTSTRAP_ADMIN_EMAIL||"local@example.test").toLowerCase()};
  }
  return null;
}
async function bootstrap(c:Context<Vars>,sub:string,email:string):Promise<void>{
  const db=c.env.DB, allowed=c.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase();
  if(!allowed || email!==allowed)throw new ApiError("identity_not_provisioned",403);
  const existing=await db.prepare("SELECT COUNT(*) AS count FROM users").first<{count:number}>();
  if((existing?.count??1)!==0)throw new ApiError("identity_not_provisioned",403);
  const org=uid(),ws=uid(),user=uid();
  try{
    await db.batch([
      db.prepare("INSERT INTO organizations(id,name) VALUES(?,?)").bind(org,"Internal"),
      db.prepare("INSERT INTO workspaces(id,organization_id,name) VALUES(?,?,?)").bind(ws,org,"Default Workspace"),
      db.prepare("INSERT INTO users(id,access_subject,email) VALUES(?,?,?)").bind(user,sub,email),
      db.prepare("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(?,?,'admin')").bind(ws,user)
    ]);
  }catch{throw new ApiError("identity_not_provisioned",403);}
}
export const authenticate:MiddlewareHandler<Vars>=async(c,next)=>{
  const authorization=c.req.header("authorization");
  let principal:Principal|null=null;
  if(authorization?.startsWith("Bearer reg_")){
    const token=authorization.slice(7);
    const hashed=await sha256(token);
    const row=await c.env.DB.prepare("SELECT t.*,w.organization_id FROM service_tokens t JOIN workspaces w ON w.id=t.workspace_id WHERE t.token_hash=? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>CURRENT_TIMESTAMP)").bind(hashed).first<any>();
    if(row)principal={kind:"service",id:row.id,workspace_id:row.workspace_id,organization_id:row.organization_id,role:"service",scopes:parse(row.scopes_json,[])};
  } else {
    let identity=null;
    try{identity=await getIdentity(c);}catch{throw new ApiError("authentication_required",401);}
    if(identity){
      let rows=await c.env.DB.prepare("SELECT u.id,u.email,m.role,m.workspace_id,w.organization_id FROM users u JOIN workspace_members m ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id WHERE u.access_subject=? AND m.active=1").bind(identity.sub).all<any>();
      if(!rows.results.length){await bootstrap(c,identity.sub,identity.email);rows=await c.env.DB.prepare("SELECT u.id,u.email,m.role,m.workspace_id,w.organization_id FROM users u JOIN workspace_members m ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id WHERE u.access_subject=? AND m.active=1").bind(identity.sub).all<any>();}
      const selected=c.req.header("x-workspace-id");
      const member=selected?rows.results.find(r=>r.workspace_id===selected):rows.results[0];
      if(member)principal={kind:"human",id:member.id,workspace_id:member.workspace_id,organization_id:member.organization_id,role:member.role,email:member.email};
    }
  }
  if(!principal)throw new ApiError("authentication_required",401);
  c.set("principal",principal);
  await next();
};
export function p(c:Context<Vars>):Principal{return c.get("principal");}
export function requireScope(c:Context<Vars>,scope:string):void{
  const actor=p(c);
  if(actor.kind!=="service" || !actor.scopes?.includes(scope))throw new ApiError("permission_denied",403);
}
