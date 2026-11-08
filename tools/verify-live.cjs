"use strict";
// Checks the real API with the existing personal keys; never creates votes or proposals.
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");
const context={window:{},location:{hostname:"josuegarza42.github.io"}};
vm.runInNewContext(fs.readFileSync(path.join(root,"site/config.js"),"utf8"),context);
const config=context.window.ALPHA_CONFIG;
async function rpc(action,token="",payload={}){
  const response=await fetch(`${config.supabaseUrl}/rest/v1/rpc/alpha_api`,{method:"POST",headers:{"Content-Type":"application/json",apikey:config.publishableKey},body:JSON.stringify({p_action:action,p_token:token,p_payload:payload}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`La API respondió HTTP ${response.status}.`);
  return response.json();
}
(async()=>{
  assert.ok(config.publishableKey.startsWith("sb_publishable_"));
  assert.equal((await rpc("state")).status,401);
  assert.equal((await rpc("state","0".repeat(80))).status,401);
  assert.equal((await rpc("login","",{key:"invalid-key-for-production-check"})).status,401);
  const partners=JSON.parse(fs.readFileSync(path.join(root,".private/access.json"),"utf8")).partners;
  const results=[];
  for(const p of partners){
    const auth=await rpc("login","",{key:p.key});assert.equal(auth.partner?.slug,p.slug,`Acceso de ${p.name}`);
    try{
      const state=await rpc("state",auth.token);assert.equal(state.me.slug,p.slug);assert.equal(state.me.role,"admin");assert.ok(Array.isArray(state.measurements));assert.ok(Array.isArray(state.incidents));assert.ok(Array.isArray(state.trash));assert.equal(state.partners.length,3);assert.equal(state.rule.threshold,3);assert.equal(state.rule.discussion_threshold,2);for(const motion of state.motions){assert.ok(Array.isArray(motion.comments));assert.equal(typeof motion.resolution_votes,"object");}
      const backup=JSON.stringify(await rpc("backup",auth.token));assert.ok(!backup.includes("key_hash"));assert.ok(!backup.includes("token_hash"));assert.ok(!backup.includes(auth.token));for(const partner of partners)assert.ok(!backup.includes(partner.key));
      results.push({partner:p.name,responsibilities:state.responsibilities.length,motions:state.motions.length,agreements:state.agreements.length});
    }finally{await rpc("logout",auth.token);}
    assert.equal((await rpc("state",auth.token)).status,401);
  }
  const privateSchema=await fetch(`${config.supabaseUrl}/rest/v1/partners?select=key_hash`,{headers:{apikey:config.publishableKey,"Accept-Profile":"alpha_private"},signal:AbortSignal.timeout(20000)});
  assert.equal(privateSchema.status,406,"El esquema privado no debe estar expuesto por PostgREST");
  console.log(JSON.stringify({verified_at:new Date().toISOString(),accesses:results,private_schema:"not exposed",session_revocation:"passed"},null,2));
})().catch(error=>{console.error("Verificación incompleta:",error.message);process.exitCode=1;});
