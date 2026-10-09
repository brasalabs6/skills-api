import React, { useEffect, useState } from "react";
import {createRoot} from "react-dom/client";
import "./styles.css";

type Kind="prompts"|"skills";
type Item={id:string;name:string;title:string;description:string;sharing_scope:string;latest_version:number;production_version:number|null;staging_version:number|null;tags?:string[]};
type Version={version:number;definition:Record<string,any>};
const payload={
 prompts:{name:"",title:"",sharing_scope:"private",description:"",definition:{content:"You are a helpful assistant. Hello {{name}}.",variables:[{name:"name",type:"string",required:true}],model_config:{temperature:0.2}}},
 skills:{name:"",title:"",sharing_scope:"private",description:"",definition:{description:"Use when...",body:"Follow the steps below...\n1. Check requirements.\n2. Produce result.",allowed_tools:[],assets:{}}}
};
async function api(path:string,options:RequestInit={}):Promise<any>{
 const response=await fetch(path,{...options,headers:{"Content-Type":"application/json",...(options.headers??{})}});
 if(response.status===204)return {};
 let body:any;try{body=await response.json()}catch{body={}};
 if(!response.ok)throw new Error(body?.error?.code??String(response.status));
 return body;
}
function App(){
 const [person,setPerson]=useState<any>(null),[kind,setKind]=useState<Kind>("prompts"),[items,setItems]=useState<Item[]>([]),[selected,setSelected]=useState<Item|null>(null),[detail,setDetail]=useState<any>(null);
 const [edit,setEdit]=useState<string>(""),[notes,setNotes]=useState(""),[vars,setVars]=useState<string>("{}"),[input,setInput]=useState<string>(""),[result,setResult]=useState<any>(null);
 const [form,setForm]=useState<any>(payload.prompts),[mode,setMode]=useState<"catalog"|"new"|"detail"|"audit">("catalog"),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[q,setQ]=useState("");
 const [audit,setAudit]=useState<any[]>([]);
 useEffect(()=>{api("/v1/me").then(setPerson).catch(e=>setMessage("Access denied: "+e.message));},[]);
 async function load(nextKind=kind){try{const x=await api("/v1/"+nextKind+"?q="+encodeURIComponent(q));setItems(x.items)}catch(e){setMessage(String(e))}}
 useEffect(()=>{if(person)void load()},[kind,person]);
 async function open(it:Item){
  setSelected(it);setMode("detail");setMessage("");setResult(null);
  try{const d=await api("/v1/"+kind+"/"+it.id);setDetail(d);const v=await api("/v1/"+kind+"/"+it.id+"/versions/"+it.latest_version);setEdit(JSON.stringify(v.definition,null,2))}catch(e){setMessage(String(e))}
 }
 async function reload(it:Item){await load();await open(it);}
 async function run(fn:()=>Promise<void>){setBusy(true);setMessage("");try{await fn()}catch(e:any){setMessage(e.message??String(e))}finally{setBusy(false)}}
 function newAsset(){setForm(JSON.parse(JSON.stringify(payload[kind])));setMode("new");setResult(null)}
 function editor(value:string,callback:(x:string)=>void,rows=16){return <textarea spellCheck={false} rows={rows} value={value} onChange={e=>callback(e.target.value)}/>;}
 const editorAllowed=person?.principal?.kind==="human"&&["editor","publisher","admin"].includes(person.principal.role);
 const publishAllowed=person?.principal?.kind==="human"&&["publisher","admin"].includes(person.principal.role);
 return <div className="app"><aside className="sidebar">
  <header className="brand"><div className="logo">◆</div><div><strong>Registry Studio</strong><small>Prompt & Skill Registry</small></div></header>
  <nav aria-label="Main navigation">
    <button className={mode!=="audit"&&kind==="prompts"?"active":""} onClick={()=>{setKind("prompts");setMode("catalog");setSelected(null)}}>⌘ <span>Prompts</span></button>
    <button className={mode!=="audit"&&kind==="skills"?"active":""} onClick={()=>{setKind("skills");setMode("catalog");setSelected(null)}}>◈ <span>Skills</span></button>
    <button className={mode==="audit"?"active":""} onClick={()=>run(async()=>{const x=await api("/v1/audit-logs");setAudit(x.items);setMode("audit")})}>↺ <span>Audit history</span></button>
  </nav><footer><small>{person?.principal?.email??"Not authenticated"}</small><div className="muted">Cloudflare Workers • D1</div></footer></aside>
  <main><div className="topbar"><span className="muted">{mode==="detail"&&selected?selected.name:"Workspace / "+(mode==="audit"?"Audit":kind)}</span><span className="pill">{person?.principal?.role??"guest"}</span></div>
  <div className="content">
  {message&&<div role="alert" className="notice">{message}<button onClick={()=>setMessage("")}>×</button></div>}
  {mode==="catalog"&&<><div className="heading"><div><h1>{kind==="prompts"?"Prompts":"Skills"}</h1><p>Versioned, governed AI instructions.</p></div>{editorAllowed&&<button className="primary" onClick={newAsset}>+ New {kind==="prompts"?"prompt":"skill"}</button>}</div>
    <div className="toolbar"><input aria-label="Search catalog" placeholder="Search assets..." value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&void load()}/><button onClick={()=>void load()}>Search</button></div>
    <div className="collection">{items.length===0?<div className="empty">No assets yet. Create the first one to begin.</div>:items.map(it=><button key={it.id} className="asset" onClick={()=>void open(it)}><div className="asseticon">{kind==="prompts"?"⌘":"◈"}</div><div className="assetdetail"><strong>{it.title}</strong><small>{it.name} <span className="muted">• {it.sharing_scope}</span></small></div><div className="versions"><span className="pill">v{it.latest_version}</span>{it.production_version&&<span className="prod">production → v{it.production_version}</span>}</div><span className="muted">›</span></button>)}</div>
  </>}
  {mode==="new"&&<><div className="heading"><div><button className="back" onClick={()=>setMode("catalog")}>← Back</button><h1>Create {kind==="prompts"?"Prompt":"Skill"}</h1></div></div>
    <div className="panel"><div className="grid"><label>Name / slug<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="example-name"/></label><label>Title<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Display name"/></label></div>
    <label>Sharing<select value={form.sharing_scope} onChange={e=>setForm({...form,sharing_scope:e.target.value})}><option value="private">Private</option><option value="workspace">Workspace</option></select></label>
    <label>Description<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
    <label>Version 1 definition (JSON)</label>{editor(JSON.stringify(form.definition,null,2),v=>{try{setForm({...form,definition:JSON.parse(v)})}catch{setEdit(v)}},1)}
    <textarea rows={13} spellCheck={false} value={edit||JSON.stringify(form.definition,null,2)} onChange={e=>setEdit(e.target.value)}/>
    <div className="actions"><button className="primary" disabled={busy} onClick={()=>run(async()=>{const data={...form,definition:JSON.parse(edit||JSON.stringify(form.definition))};await api("/v1/"+kind,{method:"POST",body:JSON.stringify(data)});setMode("catalog");setEdit("");await load();setMessage("Created successfully.")})}>Create version 1</button></div></div>
  </>}
  {mode==="detail"&&selected&&<><div className="heading"><div><button className="back" onClick={()=>{setMode("catalog");setSelected(null)}}>← All {kind}</button><h1>{selected.title}</h1><p>{selected.name} · {selected.sharing_scope} · {selected.description}</p></div><span className="pill">v{detail?.latest_version??selected.latest_version}</span></div>
    <div className="grid"><div className="panel"><h2>Version editor</h2><p className="muted">Each content change creates an immutable snapshot. Use a JSON definition.</p>{editor(edit,setEdit,17)}
    <label>Change notes<input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Explain the changes"/></label>
    <div className="actions">{editorAllowed&&<button className="primary" disabled={busy} onClick={()=>run(async()=>{const b={expected_latest_version:detail.latest_version,definition:JSON.parse(edit),notes};const x=await api("/v1/"+kind+"/"+selected.id+"/versions",{method:"POST",body:JSON.stringify(b)});await reload(selected);setMessage(x.deduplicated?"Identical definition — existing version "+x.version:"Created v"+x.version)})}>Save new version</button>}</div></div>
    <div className="stack"><div className="panel"><h2>Environment aliases</h2><p className="muted">Promotion never changes previous version content.</p>
    {(detail?.aliases??[]).length>0?(detail.aliases as any[]).map(a=><div className="kv" key={a.alias}><strong>{a.alias}</strong><span>v{a.version} · revision {a.revision}</span></div>):<p className="muted">No published aliases</p>}
    {editorAllowed&&<div className="actions"><button disabled={busy} onClick={()=>run(async()=>{const current=detail.aliases.find((x:any)=>x.alias==="staging");await api("/v1/"+kind+"/"+selected.id+"/aliases/staging",{method:"POST",body:JSON.stringify({version:detail.latest_version,expected_revision:current?.revision??0})});await reload(selected)})}>Stage latest</button>
    {publishAllowed&&<button disabled={busy} className="primary" onClick={()=>run(async()=>{const current=detail.aliases.find((x:any)=>x.alias==="production");const reason=window.prompt("Reason for publication");if(!reason)return;await api("/v1/"+kind+"/"+selected.id+"/aliases/production",{method:"POST",body:JSON.stringify({version:detail.latest_version,expected_revision:current?.revision??0,reason})});await reload(selected)})}>Publish latest</button>}</div>}
    {publishAllowed&&detail?.aliases?.some((x:any)=>x.alias==="production"&&x.version>1)&&<button disabled={busy} onClick={()=>run(async()=>{const a=detail.aliases.find((x:any)=>x.alias==="production");const reason=window.prompt("Reason for rollback");if(!reason)return;await api("/v1/"+kind+"/"+selected.id+"/rollback",{method:"POST",body:JSON.stringify({version:a.version-1,expected_revision:a.revision,reason})});await reload(selected)})}>Rollback previous</button>}
    </div><div className="panel"><h2>Version history</h2>{(detail?.versions??[]).map((v:any)=><button className="kv navitem" key={v.version} onClick={()=>run(async()=>{const x=await api("/v1/"+kind+"/"+selected.id+"/versions/"+v.version);setEdit(JSON.stringify(x.definition,null,2));setMessage("Viewing v"+v.version+". Save uses latest version as base.")})}><strong>v{v.version}</strong><small>{v.definition_hash.slice(0,12)}</small></button>)}</div></div></div>
    <div className="panel"><h2>Playground and runtime resolution</h2><p className="muted">Preview variables or run inference manually using Workers AI. Skills return instructions only.</p><div className="grid">
    <label>Reference<select value={input} onChange={e=>setInput(e.target.value)}><option value="">Latest version</option><option value="production">Production alias</option><option value="staging">Staging alias</option></select></label><label>Variables (JSON)<input value={vars} onChange={e=>setVars(e.target.value)}/></label></div>
    <div className="actions"><button disabled={busy} onClick={()=>run(async()=>{const ref=input?{alias:input}:{version:detail.latest_version};setResult(await api("/v1/"+kind+"/"+selected.id+"/resolve",{method:"POST",body:JSON.stringify({ref,variables:JSON.parse(vars)})}))})}>Resolve</button>
    {kind==="prompts"&&editorAllowed&&<button disabled={busy} className="primary" onClick={()=>run(async()=>setResult(await api("/v1/"+kind+"/"+selected.id+"/playground",{method:"POST",body:JSON.stringify({version:detail.latest_version,variables:JSON.parse(vars),execute:true})})))}>Run with Workers AI</button>}</div>{result&&<pre className="output">{JSON.stringify(result,null,2)}</pre>}</div>
  </>}
  {mode==="audit"&&<><div className="heading"><div><h1>Audit history</h1><p>Append-only record of sensitive operations.</p></div></div><div className="collection">{audit.map(x=><div className="asset" key={x.id}><div className="assetdetail"><strong>{x.event_type}</strong><small>{x.asset_id??"Workspace"} · {x.created_at}</small></div><span className="pill">{x.version?"v"+x.version:"event"}</span></div>)}</div></>}
  </div></main></div>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
