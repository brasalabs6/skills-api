import { Hono } from "hono";
import type { Context } from "hono";
import type { Vars } from "../types";
import { p } from "./auth";
import { ApiError, aud, canonical, dbError, hasRole, hydrateSkill, json, limited, normalizeSkill, parse, render, requireHuman, sha256, uid, validateDefinition } from "./core";
const r=new Hono<Vars>();type C=Context<Vars>;
const type=(c:C):"prompt"|"skill"=>c.req.param("kind")==="prompts"?"prompt":c.req.param("kind")==="skills"?"skill":(()=>{throw new ApiError("asset_not_found",404)})();
const human=(c:C,roles:string[]=[])=>(requireHuman(p(c),roles),p(c));
async function asset(c:C,archived=false){
  const a=p(c), row=await c.env.DB.prepare("SELECT * FROM ai_assets WHERE workspace_id=? AND type=? AND (id=? OR name=?)").bind(a.workspace_id,type(c),c.req.param("id"),c.req.param("id")).first<any>();
  if(!row||(!archived&&row.status!=="active"))throw new ApiError("asset_not_found",404);
  if(a.kind==="service" && (row.sharing_scope!=="workspace"||!a.scopes?.includes("asset:resolve")))throw new ApiError("asset_not_found",404);
  if(a.kind==="human" && row.sharing_scope==="private" && row.created_by!==a.id && row.owner_user_id!==a.id && a.role!=="admin")throw new ApiError("asset_not_found",404);
  return row;
}
async function ver(c:C,a:any,n:number){
  const v=Number.isSafeInteger(n)?await c.env.DB.prepare("SELECT * FROM ai_asset_versions WHERE asset_id=? AND version=?").bind(a.id,n).first<any>():null;
  if(!v)throw new ApiError("version_not_found",404);return v;
}
async function revision(c:C,a:any,b:any){
  const who=human(c,["editor","publisher","admin"]);validateDefinition(a.type,b.definition);
  const def=a.type==="skill"?await normalizeSkill(c.env,b.definition):b.definition;
  const raw=canonical(def),hash=await sha256(raw),dupe=await c.env.DB.prepare("SELECT version FROM ai_asset_versions WHERE asset_id=? AND definition_hash=?").bind(a.id,hash).first<{version:number}>();
  if(dupe)return {version:dupe.version,definition_hash:hash,deduplicated:true};
  if(!Number.isInteger(b.expected_latest_version)||b.expected_latest_version!==a.latest_version)throw new ApiError("version_conflict",409);
  const n=a.latest_version+1,g=uid();const sql=[
    c.env.DB.prepare("INSERT INTO version_write_guards(id,asset_id,expected_latest_version) VALUES(?,?,?)").bind(g,a.id,a.latest_version),
    c.env.DB.prepare("UPDATE ai_assets SET latest_version=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND latest_version=?").bind(n,a.id,a.latest_version),
    c.env.DB.prepare("INSERT INTO ai_asset_versions(id,asset_id,version,definition_json,definition_hash,notes,created_by) VALUES(?,?,?,?,?,?,?)").bind(uid(),a.id,n,raw,hash,String(b.notes??""),who.id),
    c.env.DB.prepare("DELETE FROM version_write_guards WHERE id=?").bind(g)
  ];
  if(a.type==="skill")for(const [name,f0] of Object.entries((def as any).assets??{})){const f=f0 as any;sql.push(c.env.DB.prepare("INSERT INTO skill_files(asset_id,version,filename,r2_key,sha256,size_bytes,mime) VALUES(?,?,?,?,?,?,?)").bind(a.id,n,name,f.r2_key,f.sha256,f.size_bytes,name.endsWith(".json")?"application/json":"text/plain"));}
  try{await c.env.DB.batch(sql);}catch(e){dbError(e);}
  return {version:n,definition_hash:hash,deduplicated:false};
}
r.get("/:kind",async c=>{
  const actor=human(c),k=type(c),q=(c.req.query("q")??"").slice(0,100),limit=Math.min(100,Math.max(1,Number(c.req.query("limit")??30)||30));
  const res=await c.env.DB.prepare("SELECT a.*, (SELECT version FROM ai_asset_aliases WHERE asset_id=a.id AND alias='production') AS production_version, (SELECT version FROM ai_asset_aliases WHERE asset_id=a.id AND alias='staging') AS staging_version FROM ai_assets a WHERE a.workspace_id=? AND a.type=? AND a.status='active' AND (a.sharing_scope='workspace' OR a.created_by=? OR a.owner_user_id=? OR ?='admin') AND (a.name LIKE ? OR a.title LIKE ?) ORDER BY a.updated_at DESC LIMIT ?").bind(actor.workspace_id,k,actor.id,actor.id,actor.role,"%"+q+"%","%"+q+"%",limit).all<any>();
  return c.json({items:res.results.map(x=>({...x,tags:parse(x.tags_json,[]),tags_json:undefined}))});
});
r.post("/:kind",async c=>{
  const who=human(c,["editor","publisher","admin"]),k=type(c),b=await c.req.json<any>();limited(b);
  if(typeof b.name!=="string"||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(b.name)||b.name.length<3||b.name.length>80||typeof b.title!=="string"||!b.title.trim()||!["private","workspace"].includes(b.sharing_scope))throw new ApiError("validation_error",422);
  validateDefinition(k,b.definition);const d=k==="skill"?await normalizeSkill(c.env,b.definition):b.definition,raw=canonical(d),hash=await sha256(raw),id=uid();
  const sql=[
    c.env.DB.prepare("INSERT INTO ai_assets(id,workspace_id,type,name,title,description,owner_user_id,sharing_scope,tags_json,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(id,who.workspace_id,k,b.name,b.title,String(b.description??""),who.id,b.sharing_scope,json(b.tags??[]),who.id),
    c.env.DB.prepare("INSERT INTO ai_asset_versions(id,asset_id,version,definition_json,definition_hash,notes,created_by) VALUES(?,?,?,?,?,?,?)").bind(uid(),id,1,raw,hash,String(b.notes??""),who.id),
    aud(c.env.DB,who,"asset.created",id,1,null,{name:b.name})
  ];
  if(k==="skill")for(const [name,f0] of Object.entries(d.assets??{})){const f=f0 as any;sql.push(c.env.DB.prepare("INSERT INTO skill_files(asset_id,version,filename,r2_key,sha256,size_bytes,mime) VALUES(?,?,?,?,?,?,?)").bind(id,1,name,f.r2_key,f.sha256,f.size_bytes,name.endsWith(".json")?"application/json":"text/plain"));}
  try{await c.env.DB.batch(sql);}catch(e){dbError(e);}
  return c.json({id,name:b.name,type:k,version:1,definition_hash:hash},201);
});
r.get("/:kind/:id",async c=>{
  const a=await asset(c,true);human(c);
  const v=await c.env.DB.prepare("SELECT version,definition_hash,created_at FROM ai_asset_versions WHERE asset_id=? ORDER BY version DESC").bind(a.id).all();
  const aliases=await c.env.DB.prepare("SELECT alias,version,revision,reason,moved_at FROM ai_asset_aliases WHERE asset_id=?").bind(a.id).all();
  return c.json({...a,tags:parse(a.tags_json,[]),tags_json:undefined,versions:v.results,aliases:aliases.results});
});
r.patch("/:kind/:id",async c=>{
  const a=await asset(c),who=human(c,["editor","publisher","admin"]),b=await c.req.json<any>();limited(b);
  const title=b.title??a.title,desc=b.description??a.description,scope=b.sharing_scope??a.sharing_scope,tags=b.tags??parse(a.tags_json,[]);
  if(typeof title!=="string"||!title.trim()||typeof desc!=="string"||!["private","workspace"].includes(scope)||!Array.isArray(tags)||tags.some(x=>typeof x!=="string"))throw new ApiError("validation_error",422);
  await c.env.DB.batch([c.env.DB.prepare("UPDATE ai_assets SET title=?,description=?,sharing_scope=?,tags_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(title,desc,scope,json(tags),a.id),aud(c.env.DB,who,"asset.metadata_updated",a.id,null,{title:a.title,sharing_scope:a.sharing_scope},{title,desc,scope,tags})]);return c.json({ok:true});
});
r.delete("/:kind/:id",async c=>{
  const a=await asset(c),who=human(c,["publisher","admin"]);
  await c.env.DB.batch([c.env.DB.prepare("UPDATE ai_assets SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(a.id),aud(c.env.DB,who,"asset.archived",a.id)]);
  return c.body(null,204);
});
r.get("/:kind/:id/versions",async c=>{
  const a=await asset(c,true);human(c);const o=await c.env.DB.prepare("SELECT version,notes,definition_hash,created_at FROM ai_asset_versions WHERE asset_id=? ORDER BY version DESC").bind(a.id).all();return c.json({items:o.results});
});
r.post("/:kind/:id/versions",async c=>{const a=await asset(c),result=await revision(c,a,await c.req.json());return c.json(result,result.deduplicated?200:201);});
r.get("/:kind/:id/versions/:version",async c=>{const a=await asset(c,true);human(c);const v=await ver(c,a,Number(c.req.param("version")));return c.json({version:v.version,hash:v.definition_hash,notes:v.notes,definition:parse(v.definition_json,{})});});
r.get("/:kind/:id/diff",async c=>{
 const a=await asset(c,true);human(c);const x=await ver(c,a,Number(c.req.query("from"))),y=await ver(c,a,Number(c.req.query("to")));
 const before=parse<Record<string,unknown>>(x.definition_json,{}),after=parse<Record<string,unknown>>(y.definition_json,{});
 const changes=Array.from(new Set([...Object.keys(before),...Object.keys(after)])).filter(k=>canonical(before[k]??null)!==canonical(after[k]??null)).map(field=>({field,before:before[field]??null,after:after[field]??null}));
 return c.json({from:x.version,to:y.version,changes});
});
async function move(c:C,alias:"production"|"staging",v:number,expected:number,reason:string,action:"stage"|"publish"|"rollback"){
  const a=await asset(c),who=human(c,alias==="production"?["publisher","admin"]:["editor","publisher","admin"]);
  if(!Number.isInteger(expected)||expected<0||!Number.isInteger(v)||v<1)throw new ApiError("validation_error",422);
  if(alias==="production"&&!reason.trim())throw new ApiError("reason_required",422);
  await ver(c,a,v);const guard=uid();
  try{
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO alias_write_guards(id,asset_id,alias,expected_revision) VALUES(?,?,?,?)").bind(guard,a.id,alias,expected),
      c.env.DB.prepare("INSERT INTO ai_asset_aliases(id,asset_id,alias,version,revision,reason,action,moved_by) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(asset_id,alias) DO UPDATE SET version=excluded.version,revision=ai_asset_aliases.revision+1,reason=excluded.reason,action=excluded.action,moved_by=excluded.moved_by,moved_at=CURRENT_TIMESTAMP").bind(uid(),a.id,alias,v,expected+1,reason,action,who.id),
      c.env.DB.prepare("DELETE FROM alias_write_guards WHERE id=?").bind(guard)
    ]);
  }catch(e){dbError(e);}
  const row=await c.env.DB.prepare("SELECT alias,version,revision,moved_at FROM ai_asset_aliases WHERE asset_id=? AND alias=?").bind(a.id,alias).first();
  return {asset_id:a.id,...row};
}
r.post("/:kind/:id/aliases/:alias",async c=>{
  const alias=c.req.param("alias");if(alias!=="staging"&&alias!=="production")throw new ApiError("alias_not_found",404);
  const b=await c.req.json<any>();return c.json(await move(c,alias,Number(b.version),Number(b.expected_revision),String(b.reason??""),alias==="staging"?"stage":"publish"));
});
r.post("/:kind/:id/rollback",async c=>{
 const b=await c.req.json<any>(),a=await asset(c),current=await c.env.DB.prepare("SELECT version FROM ai_asset_aliases WHERE asset_id=? AND alias='production'").bind(a.id).first<{version:number}>();
 if(!current||!Number.isInteger(b.version)||b.version>=current.version)throw new ApiError("validation_error",422);
 return c.json(await move(c,"production",b.version,Number(b.expected_revision),String(b.reason??""),"rollback"));
});
r.post("/:kind/:id/resolve",async c=>{
  const start=Date.now(),a=await asset(c),who=p(c),b=await c.req.json<any>(),ref=b.ref;
  if(!ref||typeof ref!=="object"||(Number.isInteger(ref.version)?1:0)+(typeof ref.alias==="string"?1:0)!==1)throw new ApiError("validation_error",422);
  let v=ref.version;
  if(ref.alias){
    if(!["staging","production"].includes(ref.alias))throw new ApiError("alias_not_found",404);
    const res=await c.env.DB.withSession("first-primary").prepare("SELECT version FROM ai_asset_aliases WHERE asset_id=? AND alias=?").bind(a.id,ref.alias).first<{version:number}>();
    if(!res)throw new ApiError("alias_not_found",404);v=res.version;
  }
  const resolved=await ver(c,a,v),d=parse<any>(resolved.definition_json,{}),trace_id=uid();
  const definition=a.type==="skill"?await hydrateSkill(c.env,d):d;
  const response:any={asset_id:a.id,name:a.name,type:a.type,requested_ref:String(ref.alias??ref.version),resolved_version:v,definition_hash:resolved.definition_hash,trace_id,definition};
  if(a.type==="prompt")response.rendered_content=render(d.content,d.variables??[],b.variables??{});
  await c.env.DB.prepare("INSERT INTO ai_asset_executions(id,workspace_id,asset_id,requested_ref,resolved_version,definition_hash,trace_id,caller_app,environment,status,latency_ms) VALUES(?,?,?,?,?,?,?,?,?,'resolved',?)").bind(uid(),who.workspace_id,a.id,response.requested_ref,v,resolved.definition_hash,trace_id,String(b.caller_app??""),String(b.environment??""),Date.now()-start).run();
  return c.json(response);
});
r.get("/:kind/:id/test-cases",async c=>{const a=await asset(c,true);human(c);const o=await c.env.DB.prepare("SELECT * FROM ai_asset_test_cases WHERE asset_id=?").bind(a.id).all<any>();return c.json({items:o.results.map(x=>({...x,input:parse(x.input_json,{}),expected_output:parse(x.expected_output_json,null)}))});});
r.post("/:kind/:id/test-cases",async c=>{
 const a=await asset(c),who=human(c,["editor","publisher","admin"]),b=await c.req.json<any>();
 if(typeof b.name!=="string"||!b.name.trim()||!["exact","includes","nonempty"].includes(b.evaluator?.type??"nonempty"))throw new ApiError("validation_error",422);
 const id=uid();
 await c.env.DB.batch([c.env.DB.prepare("INSERT INTO ai_asset_test_cases(id,asset_id,name,input_json,expected_output_json,evaluator_json,required_for_production,created_by) VALUES(?,?,?,?,?,?,?,?)").bind(id,a.id,b.name,json(b.input??{}),b.expected_output===undefined?null:json(b.expected_output),json(b.evaluator??{type:"nonempty"}),b.required_for_production?1:0,who.id),aud(c.env.DB,who,"asset.test_case_created",a.id,null,null,{id})]);return c.json({id},201);
});
r.post("/:kind/:id/test-cases/:testId/run",async c=>{
 const a=await asset(c),who=human(c,["editor","publisher","admin"]),b=await c.req.json<any>();
 const tc=await c.env.DB.prepare("SELECT * FROM ai_asset_test_cases WHERE asset_id=? AND id=?").bind(a.id,c.req.param("testId")).first<any>();
 if(!tc)throw new ApiError("test_case_not_found",404);
 const n=Number(b.version),v=await ver(c,a,n),d=parse<any>(v.definition_json,{}),inputs=parse<any>(tc.input_json,{});
 const rendered=a.type==="prompt"?render(d.content,d.variables??[],inputs):d.body;
 const output=typeof b.output==="string"?b.output:rendered, evaluator=parse<any>(tc.evaluator_json,{type:"nonempty"}),expected=parse<any>(tc.expected_output_json,null);
 let status:"passed"|"failed"|"not_evaluated"="not_evaluated";
 if(evaluator.type==="exact")status=expected===output?"passed":"failed";
 else if(evaluator.type==="includes")status=typeof expected==="string"&&output.includes(expected)?"passed":"failed";
 else if(evaluator.type==="nonempty")status=output.trim()?"passed":"failed";
 const id=uid(),input_hash=await sha256(canonical(inputs)),output_hash=await sha256(output);
 await c.env.DB.batch([c.env.DB.prepare("INSERT INTO ai_asset_test_runs(id,asset_id,version,test_case_id,case_revision,status,input_hash,output_hash,run_by) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,a.id,n,tc.id,tc.case_revision,status,input_hash,output_hash,who.id),aud(c.env.DB,who,"asset.test_run",a.id,n,null,{status,test_case_id:tc.id})]);
 return c.json({id,status,version:n,case_revision:tc.case_revision,output});
});
r.post("/:kind/:id/reviews",async c=>{
 const a=await asset(c),who=human(c,["editor","publisher","admin"]),b=await c.req.json<any>();
 await ver(c,a,Number(b.version));const id=uid();
 await c.env.DB.batch([c.env.DB.prepare("INSERT INTO ai_asset_reviews(id,asset_id,version,status,requested_by) VALUES(?, ?, ?, 'pending', ?)").bind(id,a.id,b.version,who.id),aud(c.env.DB,who,"asset.review_requested",a.id,b.version)]);return c.json({id,status:"pending"},201);
});
r.post("/:kind/:id/reviews/:reviewId",async c=>{
 const a=await asset(c),who=human(c,["publisher","admin"]),b=await c.req.json<any>(),status=b.status;
 if(!["approved","rejected"].includes(status))throw new ApiError("validation_error",422);
 const rv=await c.env.DB.prepare("SELECT * FROM ai_asset_reviews WHERE asset_id=? AND id=? AND status='pending'").bind(a.id,c.req.param("reviewId")).first<any>();
 if(!rv)throw new ApiError("review_not_found",404);
 if(rv.requested_by===who.id)throw new ApiError("self_approval_forbidden",403);
 await c.env.DB.batch([c.env.DB.prepare("UPDATE ai_asset_reviews SET status=?,reviewed_by=?,comment=? WHERE id=? AND status='pending'").bind(status,who.id,b.comment??null,rv.id),aud(c.env.DB,who,"asset.review_"+status,a.id,rv.version)]);
 return c.json({status});
});
r.post("/:kind/:id/playground",async c=>{
 const a=await asset(c),who=human(c,["editor","publisher","admin"]),b=await c.req.json<any>();
 const v=await ver(c,a,Number(b.version)),d=parse<any>(v.definition_json,{});
 if(a.type!=="prompt")throw new ApiError("skill_execution_not_supported",422);
 const rendered=render(d.content,d.variables??[],b.variables??{});
 if(b.execute!==true)return c.json({rendered_content:rendered,version:v.version,executed:false});
 const model=c.env.AI_MODEL||"@cf/meta/llama-3.1-8b-instruct-fast";
 const output=await c.env.AI.run(model as any,{prompt:rendered});
 const text=typeof output==="string"?output:JSON.stringify(output),id=uid();
 await c.env.DB.prepare("INSERT INTO ai_asset_test_runs(id,asset_id,version,status,model,run_by,input_hash,output_hash) VALUES(?,?,?,'not_evaluated',?,?,?,?)").bind(id,a.id,v.version,model,who.id,await sha256(rendered),await sha256(text)).run();
 return c.json({rendered_content:rendered,version:v.version,executed:true,output,run_id:id,model});
});
export default r;
