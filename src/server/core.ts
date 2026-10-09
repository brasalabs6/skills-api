import type { Env, Principal } from "../types";

export class ApiError extends Error {
  constructor(public code: string, public status = 400, public details: Record<string, unknown> = {}) { super(code); }
}
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const json = (x: unknown) => JSON.stringify(x);
export function parse<T = any>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
export function canonical(input: unknown): string {
  if (input === null || typeof input !== "object") return JSON.stringify(input);
  if (Array.isArray(input)) return "[" + input.map(canonical).join(",") + "]";
  return "{" + Object.keys(input as Record<string, unknown>).sort().map(k => JSON.stringify(k) + ":" + canonical((input as any)[k])).join(",") + "}";
}
export async function sha256(s: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(hash), b=>b.toString(16).padStart(2,"0")).join("");
}
export function requireHuman(p: Principal, roles: string[] = []): void {
  if (p.kind !== "human" || (roles.length > 0 && !roles.includes(p.role))) throw new ApiError("permission_denied", 403);
}
export function hasRole(p: Principal, ...roles: string[]): boolean {
  return p.kind === "human" && roles.includes(p.role);
}
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i); return diff===0;
}
export function validateDefinition(type: "prompt"|"skill", input: any): void {
  if (!input || typeof input!=="object" || Array.isArray(input)) throw new ApiError("validation_error",422);
  const content = type==="prompt" ? input.content : input.body;
  if (typeof content!=="string" || !content.trim() || content.length > 250000) throw new ApiError("validation_error",422,{field:type==="prompt"?"content":"body"});
  if (type==="skill" && (typeof input.description!=="string" || !input.description.trim())) throw new ApiError("validation_error",422,{field:"description"});
  const raw=JSON.stringify(input);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:sk_(?:live|test)_[a-z0-9]{20,})|(?:AKIA[0-9A-Z]{16})|(?:ghp_[a-zA-Z0-9]{30,})/i.test(raw)) throw new ApiError("secret_detected",422);
  if (type==="prompt") {
    const vars=Array.isArray(input.variables)?input.variables:[];
    const declared = new Set<string>();
    for(const v of vars){
      if(!v || typeof v.name!=="string" || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v.name) || declared.has(v.name)) throw new ApiError("validation_error",422,{field:"variables"});
      declared.add(v.name);
    }
    for(const m of content.matchAll(/\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g))
      if(!declared.has(m[1])) throw new ApiError("validation_error",422,{undeclared:m[1]});
  } else {
    const assets=input.assets ?? {};
    if(typeof assets!=="object" || assets===null || Array.isArray(assets) || Object.keys(assets).length>10) throw new ApiError("validation_error",422,{field:"assets"});
    for(const [name, value] of Object.entries(assets)){
      if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}\.(md|txt|json)$/.test(name)) throw new ApiError("validation_error",422,{filename:name});
      const f = value as any;
      if(typeof f?.text_content==="string" && new TextEncoder().encode(f.text_content).length>1048576) throw new ApiError("validation_error",422,{filename:name});
      if(typeof f?.text_content!=="string" && (typeof f?.r2_key!=="string" || typeof f?.sha256!=="string")) throw new ApiError("validation_error",422,{filename:name});
    }
  }
}
export function render(content:string, declared:any[], variables:any):string {
  if(!variables || typeof variables!=="object" || Array.isArray(variables)) variables={};
  for(const v of declared??[]) {
    const value=variables[v.name]??v.default;
    if((value===undefined||value===null)&&v.required)throw new ApiError("validation_error",422,{variable:v.name});
    if(value!=null && v.type && typeof value!==v.type)throw new ApiError("validation_error",422,{variable:v.name, expected:v.type});
  }
  return content.replace(/\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g,(_,name)=>{
    const v = (declared??[]).find((x:any)=>x.name===name);
    if(!v)throw new ApiError("validation_error",422,{variable:name});
    const value=variables[name]??v.default??"";
    return typeof value==="string"?value:JSON.stringify(value);
  });
}
export async function normalizeSkill(env: Env, definition:any): Promise<any> {
  const assets=definition.assets??{}, output:Record<string,unknown>={};
  for(const [name,f0] of Object.entries(assets)){
    const f=f0 as any;
    if(typeof f.text_content==="string"){
      if(name.endsWith(".json")) {try{JSON.parse(f.text_content);}catch{throw new ApiError("validation_error",422,{filename:name});}}
      const hash=await sha256(f.text_content);
      const key="skill-files/sha256/"+hash;
      await env.ASSETS.put(key, f.text_content, {httpMetadata:{contentType:name.endsWith(".json")?"application/json":"text/plain"}});
      output[name]={r2_key:key,sha256:hash,size_bytes:new TextEncoder().encode(f.text_content).length,is_executable:false};
    } else {
      const obj=await env.ASSETS.head(f.r2_key);
      if(!obj || !f.r2_key.startsWith("skill-files/sha256/") || f.r2_key.slice(-64)!==f.sha256 || obj.size>1048576)throw new ApiError("validation_error",422,{filename:name});
      output[name]={r2_key:f.r2_key,sha256:f.sha256,size_bytes:obj.size,is_executable:false};
    }
  }
  return {...definition,assets:output};
}
export async function hydrateSkill(env:Env, definition:any):Promise<any>{
  const files:Record<string,unknown>={};
  for(const [name,val] of Object.entries(definition.assets??{})){
    const meta=val as any; const object=await env.ASSETS.get(meta.r2_key);
    if(!object)throw new ApiError("file_unavailable",503);
    files[name]={...meta,text_content:await object.text()};
  }
  return {...definition,assets:files};
}
export function dbError(e:unknown):never{
  if(e instanceof ApiError)throw e;
  const msg=String(e);
  for(const code of ["permission_denied","test_required","review_required","reason_required","alias_conflict","version_conflict","immutable_version"])
    if(msg.includes(code))throw new ApiError(code,["alias_conflict","version_conflict"].includes(code)?409:403);
  if(msg.includes("UNIQUE constraint failed"))throw new ApiError("conflict",409);
  throw e;
}
export function assertSameOrigin(request:Request):void {
  if(!["POST","PATCH","PUT","DELETE"].includes(request.method))return;
  const origin=request.headers.get("origin");
  if(origin && new URL(origin).origin!==new URL(request.url).origin)throw new ApiError("origin_forbidden",403);
}
export function limited(body:any,bytes=256000):void{
  if(JSON.stringify(body).length>bytes)throw new ApiError("payload_too_large",413);
}
export function aud(db:D1Database,p:Principal,event_type:string,asset_id:string|null=null,version:number|null=null,before:any=null,after:any=null,reason:string|null=null){
  return db.prepare("INSERT INTO ai_asset_audit_logs(id,workspace_id,actor_id,event_type,asset_id,version,before_json,after_json,reason) VALUES(?,?,?,?,?,?,?,?,?)")
   .bind(uid(),p.workspace_id,p.id,event_type,asset_id,version,before==null?null:json(before),after==null?null:json(after),reason);
}
export async function encrypt(env:Env, secret:string):Promise<string>{
  if(!env.WEBHOOK_ENCRYPTION_KEY)throw new ApiError("webhook_key_unconfigured",503);
  const raw=Uint8Array.from(atob(env.WEBHOOK_ENCRYPTION_KEY),c=>c.charCodeAt(0));
  if(raw.length!==32)throw new ApiError("webhook_key_invalid",503);
  const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt"]);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(secret)));
  return btoa(String.fromCharCode(...iv,...ct));
}
export async function decrypt(env:Env,data:string):Promise<string>{
  if(!env.WEBHOOK_ENCRYPTION_KEY)throw new ApiError("webhook_key_unconfigured",503);
  const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
  const raw=Uint8Array.from(atob(env.WEBHOOK_ENCRYPTION_KEY),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:bytes.slice(0,12)},key,bytes.slice(12)));
}
