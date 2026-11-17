import { describe, it, expect } from "vitest";
import { canonical, validateDefinition, render, sha256, ApiError } from "../src/server/core";
describe("Canonical hash and prompt variables",()=>{
  it("sorts object keys recursively, preserving arrays",()=>{
    expect(canonical({z:1,a:{c:2,b:3}})).toBe('{"a":{"b":3,"c":2},"z":1}');
    expect(canonical([{b:2,a:1},2])).toBe('[{"a":1,"b":2},2]');
  });
  it("computes repeatable SHA-256",async()=>{
    expect(await sha256("test")).toBe("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
  });
  it("rejects undeclared variables",()=>{
    expect(()=>validateDefinition("prompt",{content:"Hello {{name}}",variables:[]})).toThrow(ApiError);
  });
  it("allows declared variables and safely renders literal text",()=>{
    const d={content:"Hi {{name}}",variables:[{name:"name",type:"string",required:true}]};
    expect(()=>validateDefinition("prompt",d)).not.toThrow();
    expect(render(d.content,d.variables,{name:"<script>alert(1)</script>"})).toBe("Hi <script>alert(1)</script>");
  });
  it("rejects secrets, invalid skills, oversized files",()=>{
    expect(()=>validateDefinition("prompt",{content:"-----BEGIN PRIVATE KEY-----",variables:[]})).toThrow();
    expect(()=>validateDefinition("skill",{description:"",body:"text"})).toThrow();
    expect(()=>validateDefinition("skill",{description:"Use",body:"Procedure",assets:{"a.js":{text_content:"echo"}}})).toThrow();
  });
});
