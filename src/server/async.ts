import type { Env } from "../types";
import { decrypt, now, uid } from "./core";

const sign = async (secret:string,body:string):Promise<string>=>{
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(body))),b=>b.toString(16).padStart(2,"0")).join("");
};
export async function sweep(env:Env):Promise<void>{
  const events=await env.DB.prepare("SELECT * FROM event_outbox WHERE status='pending' AND next_attempt_at<=CURRENT_TIMESTAMP LIMIT 30").all<any>();
  for(const event of events.results){
    const endpoints=await env.DB.prepare("SELECT id FROM webhook_endpoints WHERE workspace_id=? AND enabled=1 AND EXISTS (SELECT 1 FROM json_each(events_json) WHERE value=?)").bind(event.workspace_id,event.event_type).all<{id:string}>();
    for(const endpoint of endpoints.results)await env.DB.prepare("INSERT OR IGNORE INTO webhook_deliveries(id,event_id,endpoint_id) VALUES(?,?,?)").bind(uid(),event.id,endpoint.id).run();
    await env.DB.prepare("UPDATE event_outbox SET status='delivered' WHERE id=?").bind(event.id).run();
    try{await env.EVENT_QUEUE.send({event_id:event.id});}catch{/* Cron will requeue pending deliveries. */}
  }
  const due=await env.DB.prepare("SELECT DISTINCT event_id FROM webhook_deliveries WHERE status='pending' AND next_attempt_at<=CURRENT_TIMESTAMP LIMIT 30").all<{event_id:string}>();
  for(const row of due.results)try{await env.EVENT_QUEUE.send({event_id:row.event_id});}catch{/* retry next minute */}
}
export async function processEvent(env:Env,eventId:string):Promise<void>{
  const event=await env.DB.prepare("SELECT * FROM event_outbox WHERE id=?").bind(eventId).first<any>();
  if(!event)return;
  const deliveries=await env.DB.prepare("SELECT d.*,e.url,e.encrypted_secret,e.enabled FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id=d.endpoint_id WHERE d.event_id=? AND d.status='pending' AND d.next_attempt_at<=CURRENT_TIMESTAMP LIMIT 20").bind(eventId).all<any>();
  for(const row of deliveries.results){
    if(!row.enabled){await env.DB.prepare("UPDATE webhook_deliveries SET status='dead' WHERE id=?").bind(row.id).run();continue;}
    const lease=await env.DB.prepare("UPDATE webhook_deliveries SET status='processing',leased_until=datetime('now','+30 seconds'),attempts=attempts+1 WHERE id=? AND status='pending' RETURNING id").bind(row.id).first();
    if(!lease)continue;
    let code=0;
    try{
      const secret=await decrypt(env,row.encrypted_secret);
      const ts=String(Date.now());const body=JSON.stringify({id:event.id,event:event.event_type,workspace_id:event.workspace_id,...JSON.parse(event.payload_json),occurred_at:event.created_at});
      const signature=await sign(secret,ts+"."+body);
      const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),8000);
      try{
        const result=await fetch(row.url,{method:"POST",headers:{"content-type":"application/json","x-registry-event-id":event.id,"x-registry-timestamp":ts,"x-registry-signature":"v1="+signature},body,signal:controller.signal,redirect:"error"});
        code=result.status;
        if(result.ok){await env.DB.prepare("UPDATE webhook_deliveries SET status='delivered',leased_until=NULL,delivered_at=CURRENT_TIMESTAMP,last_response_code=? WHERE id=?").bind(code,row.id).run();continue;}
      }finally{clearTimeout(timer);}
    }catch{/* Network or decrypt error; retry */}
    if(row.attempts>=4)await env.DB.prepare("UPDATE webhook_deliveries SET status='dead',leased_until=NULL,last_response_code=? WHERE id=?").bind(code,row.id).run();
    else await env.DB.prepare("UPDATE webhook_deliveries SET status='pending',leased_until=NULL,last_response_code=?,next_attempt_at=datetime('now',?) WHERE id=?").bind(code,"+"+Math.min(60,2**row.attempts)+" minutes",row.id).run();
  }
}
