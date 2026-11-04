"use strict";
const {test,before,after,beforeEach}=require("node:test");
const assert=require("node:assert/strict");
const {openDatabase,rpc,loginAll,sample,schema,testKey}=require("../tools/test-db.cjs");
let db,tokens;
before(async()=>{db=await openDatabase();});
after(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec("truncate alpha_private.sessions,alpha_private.events,alpha_private.votes,alpha_private.agreements,alpha_private.motions,alpha_private.responsibilities restart identity cascade; update alpha_private.board set revision=0;");
  tokens=await loginAll(db);
});
const call=(action,actor="josue",payload={})=>rpc(db,action,tokens[actor],payload);
async function proposed(payload=sample()){return call("create","josue",payload);}
async function active(){const m=await proposed();await call("vote","josue",{motion_id:m.motion_id,value:"approve"});await call("vote","brandon",{motion_id:m.motion_id,value:"approve"});return m;}
test("login rejects wrong keys; state requires a personal session",async()=>{
  assert.equal((await rpc(db,"login","",{key:"incorrect-but-long-enough-key"})).status,401);
  assert.equal((await rpc(db,"state")).status,401);
  assert.equal((await rpc(db,"state","x".repeat(80))).status,401);
  assert.equal((await call("state","tono")).me.slug,"tono");
  await call("logout","tono");assert.equal((await call("state","tono")).status,401);
});
test("expired sessions no longer authorize actions",async()=>{
  await db.exec("update alpha_private.sessions set expires_at=now()-interval '1 minute'");
  assert.equal((await call("state")).status,401);
});
test("proposing is not a vote; the same partner cannot create a majority",async()=>{
  const m=await proposed();let state=await call("state");assert.deepEqual(state.motions[0].votes,{});
  for(let n=0;n<2;n++)await call("vote","josue",{motion_id:m.motion_id,value:"approve"});
  state=await call("state");assert.equal(state.motions[0].status,"pending");assert.equal(state.responsibilities[0].status,"proposed");assert.equal(Object.keys(state.motions[0].votes).length,1);
  await call("vote","brandon",{motion_id:m.motion_id,value:"approve"});
  state=await call("state");assert.equal(state.motions[0].status,"approved");assert.equal(state.responsibilities[0].status,"active");
  assert.equal((await call("vote","tono",{motion_id:m.motion_id,value:"reject"})).status,409);
});
test("votes can change while open; two against reject",async()=>{
  const m=await proposed();await call("vote","josue",{motion_id:m.motion_id,value:"approve"});await call("vote","josue",{motion_id:m.motion_id,value:"reject"});
  await call("vote","tono",{motion_id:m.motion_id,value:"reject"});const state=await call("state");
  assert.equal(state.motions[0].status,"rejected");assert.equal(state.responsibilities[0].status,"rejected");assert.equal(state.motions[0].votes.josue,"reject");
});
test("all three admins may cancel proposals; history and votes remain",async()=>{
  const m=await proposed();await call("vote","tono",{motion_id:m.motion_id,value:"approve"});
  assert.equal((await call("state","brandon")).me.role,"admin");
  assert.equal((await call("cancel","brandon",{motion_id:m.motion_id})).ok,true);
  const state=await call("state");assert.equal(state.motions[0].status,"cancelled");assert.equal(state.motions[0].votes.tono,"approve");assert.equal(state.responsibilities[0].status,"cancelled");assert.ok(state.events.some(e=>e.action==="Propuesta cancelada"));
});
test("changes and reassignments take effect only after two approvals",async()=>{
  const m=await active();const edit=await call("motion","tono",{responsibility_id:m.id,kind:"edit",payload:sample({owner:"brandon",frequency:"Semanal"}),reason:"Repartir el trabajo"});assert.ok(edit.motion_id);
  assert.equal((await call("state")).responsibilities[0].owner,"josue");
  assert.equal((await call("motion","tono",{responsibility_id:m.id,kind:"retire",reason:"Otra propuesta"})).status,409);
  await call("vote","tono",{motion_id:edit.motion_id,value:"approve"});await call("vote","josue",{motion_id:edit.motion_id,value:"approve"});
  const r=(await call("state")).responsibilities[0];assert.equal(r.owner,"brandon");assert.equal(r.frequency,"Semanal");
});
test("rejected edits retain the original responsibility",async()=>{
  const m=await active();const edit=await call("motion","tono",{responsibility_id:m.id,kind:"edit",payload:sample({title:"Otro título"}),reason:"Probar el cambio"});
  await call("vote","josue",{motion_id:edit.motion_id,value:"reject"});await call("vote","brandon",{motion_id:edit.motion_id,value:"reject"});
  assert.equal((await call("state")).responsibilities[0].title,sample().title);
});
test("retirement remains pending until a two-person majority",async()=>{
  const m=await active();const retire=await call("motion","brandon",{responsibility_id:m.id,kind:"retire",reason:"La función ya no aplica"});
  await call("vote","brandon",{motion_id:retire.motion_id,value:"approve"});assert.equal((await call("state")).responsibilities[0].status,"active");
  await call("vote","tono",{motion_id:retire.motion_id,value:"approve"});assert.equal((await call("state")).responsibilities[0].status,"retired");
});
test("agreements require active functions and no open votes",async()=>{
  assert.equal((await call("agreement")).status,409);const m=await proposed();assert.equal((await call("agreement")).status,409);
  await call("vote","josue",{motion_id:m.motion_id,value:"approve"});await call("vote","brandon",{motion_id:m.motion_id,value:"approve"});assert.equal((await call("agreement")).version,1);
});
test("agreement versions are immutable, include votes and avoid duplicates",async()=>{
  const m=await active();const a=await call("agreement");assert.deepEqual(await call("agreement","brandon"),a);
  const original=await call("agreement_data","josue",{agreement_id:a.id});assert.equal(original.snapshot.responsibilities[0].approval.votes.brandon,"approve");
  const edit=await call("motion","tono",{responsibility_id:m.id,kind:"edit",payload:sample({owner:"tono"}),reason:"Nuevo reparto"});
  await call("vote","josue",{motion_id:edit.motion_id,value:"approve"});await call("vote","tono",{motion_id:edit.motion_id,value:"approve"});
  assert.equal((await call("agreement")).version,2);assert.deepEqual(await call("agreement_data","tono",{agreement_id:a.id}),original);
});
test("validates fields, vote values, nonexistent IDs and no-op edits",async()=>{
  for(const value of [sample({owner:"intruso"}),sample({title:" "}),sample({deliverable:"x".repeat(1201)}),sample({category:"Desconocida"}),sample({title:42})])assert.equal((await proposed(value)).status,400);
  const m=await active();assert.equal((await call("motion","josue",{responsibility_id:m.id,kind:"edit",payload:sample(),reason:"Sin cambio"})).status,400);
  assert.equal((await call("motion","josue",{responsibility_id:m.id,kind:"retire",reason:" "})).status,400);
  const next=await proposed(sample({title:"Nueva función"}));assert.equal((await call("vote","josue",{motion_id:next.motion_id,value:"invalid"})).status,400);
  assert.equal((await call("vote","josue",{motion_id:"not-a-uuid",value:"approve"})).status,400);
  assert.equal((await call("vote","josue",{motion_id:"00000000-0000-0000-0000-000000000000",value:"approve"})).status,404);
});
test("anonymous users cannot read private tables or invoke private helpers",async()=>{
  await assert.rejects(db.transaction(async tx=>{await tx.exec("set local role anon");await tx.query("select * from alpha_private.partners");}),/permission denied/);
  await assert.rejects(db.transaction(async tx=>{await tx.exec("set local role anon");await tx.query("select alpha_private.snapshot()");}),/permission denied/);
});
test("shared state and backups contain no keys, hashes or session credentials",async()=>{
  await active();await call("agreement");for(const action of ["state","backup"]){const data=JSON.stringify(await call(action));assert.ok(!data.includes("key_hash"));assert.ok(!data.includes("token_hash"));for(const slug of Object.keys(tokens)){assert.ok(!data.includes(tokens[slug]));assert.ok(!data.includes(testKey(slug)));}}
});
test("schema can be reapplied without losing responsibilities",async()=>{
  await active();await db.exec(schema());assert.equal((await call("state")).responsibilities[0].status,"active");
});
test("metric and penalty terms require a majority and stay fixed in past agreements",async()=>{
  const m=await active(),a=await call("agreement");
  const old=await call("agreement_data","josue",{agreement_id:a.id});
  assert.equal(old.snapshot.responsibilities[0].penalty,sample().penalty);
  assert.deepEqual(old.snapshot.responsibilities[0].metric,sample().metric);
  const changed=sample({penalty:"Nueva condición",metric:{name:"Errores",target:0,unit:"errores",direction:"lte"}});
  const edit=await call("motion","tono",{responsibility_id:m.id,kind:"edit",reason:"Ajustar la medición",payload:changed});
  await call("vote","tono",{motion_id:edit.motion_id,value:"approve"});
  assert.equal((await call("state")).responsibilities[0].penalty,sample().penalty);
  await call("vote","brandon",{motion_id:edit.motion_id,value:"approve"});
  assert.deepEqual((await call("state")).responsibilities[0].metric,changed.metric);
  assert.deepEqual(await call("agreement_data","josue",{agreement_id:a.id}),old);
});
test("measurements preserve the target, owner, author and correction history",async()=>{
  const m=await active();
  const payload={responsibility_id:m.id,period:"Noviembre 2026",actual:95.5,note:"Reporte entregado",actor:"tono",metric:{target:1}};
  assert.ok((await call("measure","brandon",payload)).id);
  assert.ok((await call("measure","brandon",{...payload,actual:100,note:"Corrección documentada"})).id);
  let entries=(await call("state")).measurements;assert.equal(entries.length,2);
  assert.ok(entries.some(e=>e.actual===95.5));
  for(const e of entries){assert.equal(e.owner,"josue");assert.equal(e.actor,"brandon");assert.deepEqual(e.metric,sample().metric);}
  const edit=await call("motion","josue",{responsibility_id:m.id,kind:"edit",reason:"Cambiar titular y meta",payload:sample({owner:"tono",metric:{...sample().metric,target:90}})});
  await call("vote","josue",{motion_id:edit.motion_id,value:"approve"});await call("vote","tono",{motion_id:edit.motion_id,value:"approve"});
  entries=(await call("backup")).measurements;assert.equal(entries.length,2);assert.equal(entries[0].metric.target,100);assert.equal(entries[0].owner,"josue");
});
test("incident tracking preserves agreed penalty and records admin resolution",async()=>{
  const m=await active();
  const result=await call("incident","brandon",{responsibility_id:m.id,occurred_on:"2026-01-01",detail:"No se entregó el corte",penalty:"Impuesta por cliente",owner:"tono"});
  assert.ok(result.id);let i=(await call("state")).incidents[0];assert.equal(i.owner,"josue");assert.equal(i.penalty,sample().penalty);assert.equal(i.actor,"brandon");assert.equal(i.status,"open");
  assert.equal((await call("resolve_incident","tono",{incident_id:i.id,status:"resolved",resolution:""})).status,400);
  assert.equal((await call("resolve_incident","tono",{incident_id:i.id,status:"resolved",resolution:"Se repuso la entrega"})).ok,true);
  i=(await call("backup")).incidents[0];assert.equal(i.status,"resolved");assert.equal(i.resolved_by,"tono");assert.equal(i.detail,"No se entregó el corte");
  assert.equal((await call("resolve_incident","josue",{incident_id:i.id,status:"dismissed",resolution:"Segundo cierre"})).status,409);
});
test("tracking validates terms, values, dates and active status",async()=>{
  for(const override of [{penalty:"x".repeat(1201)},{metric:{}},{metric:{...sample().metric,target:-1}},{metric:{...sample().metric,target:"100"}},{metric:{...sample().metric,direction:"invalid"}},{metric:{...sample().metric,name:" "}}])assert.equal((await proposed(sample(override))).status,400);
  const p=await proposed();assert.equal((await call("measure","josue",{responsibility_id:p.id,period:"Mes",actual:1})).status,409);
  await call("cancel","tono",{motion_id:p.motion_id});const m=await active();
  for(const override of [{actual:-1},{actual:"100"},{actual:1e13},{period:" "},{note:42}])assert.equal((await call("measure","josue",{responsibility_id:m.id,period:"Mes",actual:1,...override})).status,400);
  for(const override of [{occurred_on:"2099-01-01"},{occurred_on:"2026-02-30"},{detail:" "}])assert.equal((await call("incident","josue",{responsibility_id:m.id,occurred_on:"2026-01-01",detail:"Retraso",...override})).status,400);
  await assert.rejects(db.transaction(async tx=>{await tx.exec("set local role anon");await tx.query("select * from alpha_private.measurements");}),/permission denied/);
});
test("optional terms are compatible with older proposals",async()=>{
  const payload=sample();delete payload.penalty;delete payload.metric;
  const m=await proposed(payload);await call("vote","josue",{motion_id:m.motion_id,value:"approve"});await call("vote","brandon",{motion_id:m.motion_id,value:"approve"});
  const r=(await call("state")).responsibilities[0];assert.equal(r.penalty,"");assert.equal(r.metric,null);
  assert.equal((await call("measure","tono",{responsibility_id:m.id,period:"Mes",actual:1})).status,409);
  assert.equal((await call("incident","tono",{responsibility_id:m.id,occurred_on:"2026-01-01",detail:"Sin acuerdo"})).status,409);
});
test("admins can set distinct simple keys and revoke the affected partner sessions",async()=>{
  const original=testKey("tono"),newKey="simple-test-password";
  try{
    assert.equal((await call("change_key","brandon",{partner:"tono",key:"abc"})).status,400);
    assert.equal((await call("change_key","brandon",{partner:"tono",key:testKey("josue")})).status,409);
    assert.equal((await call("change_key","brandon",{partner:"tono",key:newKey})).ok,true);
    assert.equal((await rpc(db,"login","",{key:original})).status,401);
    assert.equal((await call("state","tono")).status,401);
    const login=await rpc(db,"login","",{key:newKey});assert.equal(login.partner.slug,"tono");assert.equal(login.partner.role,"admin");
    assert.equal((await call("state","brandon")).me.slug,"brandon");
    assert.ok(!JSON.stringify(await call("backup","brandon")).includes(newKey));
  }finally{await db.query("update alpha_private.partners set key_hash=encode(extensions.digest($1,'sha256'),'hex') where slug='tono'",[original]);}
});
test("deleting a proposal cancels voting; restore keeps votes and does not reopen it",async()=>{
  const m=await proposed();await call("vote","tono",{motion_id:m.motion_id,value:"approve"});
  assert.equal((await call("trash","brandon",{type:"responsibility",id:m.id})).ok,true);
  let state=await call("state");assert.equal(state.responsibilities.length,0);assert.equal(state.motions.length,0);assert.equal(state.trash[0].id,m.id);
  const backup=await call("backup");assert.ok(backup.responsibilities[0].deleted_at);assert.equal(backup.motions[0].votes.tono,"approve");
  assert.equal((await call("vote","josue",{motion_id:m.motion_id,value:"approve"})).status,409);
  assert.equal((await call("motion","josue",{responsibility_id:m.id,kind:"retire",reason:"Oculta"})).status,404);
  assert.equal((await call("restore","tono",{type:"responsibility",id:m.id})).ok,true);
  state=await call("state");assert.equal(state.responsibilities[0].status,"cancelled");assert.equal(state.motions[0].status,"cancelled");assert.equal(state.motions[0].votes.tono,"approve");assert.equal(state.trash.length,0);
});
test("active functions cannot bypass majority by deletion; retired functions restore as retired",async()=>{
  const m=await active();assert.equal((await call("trash","brandon",{type:"responsibility",id:m.id})).status,409);
  const retire=await call("motion","brandon",{responsibility_id:m.id,kind:"retire",reason:"Ya no aplica"});
  await call("vote","brandon",{motion_id:retire.motion_id,value:"approve"});assert.equal((await call("trash","tono",{type:"responsibility",id:m.id})).status,409);
  await call("vote","tono",{motion_id:retire.motion_id,value:"approve"});
  assert.equal((await call("trash","tono",{type:"responsibility",id:m.id})).ok,true);
  assert.equal((await call("restore","josue",{type:"responsibility",id:m.id})).ok,true);
  assert.equal((await call("state")).responsibilities[0].status,"retired");
});
test("penalty removal requires two votes and preserves earlier agreements and incidents",async()=>{
  const m=await active(),a=await call("agreement"),original=await call("agreement_data","josue",{agreement_id:a.id});
  await call("incident","tono",{responsibility_id:m.id,occurred_on:"2026-01-01",detail:"Pendiente de revisión"});
  const edit=await call("motion","tono",{responsibility_id:m.id,kind:"edit",payload:sample({penalty:""}),reason:"Quitar penalización"});
  await call("vote","tono",{motion_id:edit.motion_id,value:"approve"});assert.equal((await call("state")).responsibilities[0].penalty,sample().penalty);
  await call("vote","brandon",{motion_id:edit.motion_id,value:"approve"});assert.equal((await call("state")).responsibilities[0].penalty,"");
  assert.equal((await call("state")).incidents[0].penalty,sample().penalty);assert.deepEqual(await call("agreement_data","josue",{agreement_id:a.id}),original);
});
test("incident deletion preserves evidence and resolution; hidden incidents cannot be resolved",async()=>{
  const m=await active(),i=await call("incident","tono",{responsibility_id:m.id,occurred_on:"2026-01-01",detail:"Evidencia original"});
  assert.equal((await call("trash","brandon",{type:"incident",id:i.id})).ok,true);assert.equal((await call("state")).incidents.length,0);
  assert.equal((await call("resolve_incident","josue",{incident_id:i.id,status:"resolved",resolution:"Oculto"})).status,409);
  await call("restore","josue",{type:"incident",id:i.id});await call("resolve_incident","josue",{incident_id:i.id,status:"resolved",resolution:"Atendido"});
  const original=(await call("state")).incidents[0];await call("trash","tono",{type:"incident",id:i.id});await call("restore","brandon",{type:"incident",id:i.id});
  assert.deepEqual((await call("state")).incidents[0],original);
});
test("agreement deletion and regeneration restore the identical version and snapshot",async()=>{
  await active();const a=await call("agreement"),original=await call("agreement_data","josue",{agreement_id:a.id});
  await call("trash","tono",{type:"agreement",id:a.id});assert.equal((await call("state")).agreements.length,0);assert.equal((await call("agreement_data","josue",{agreement_id:a.id})).status,404);
  assert.equal((await call("backup")).agreements[0].snapshot.responsibilities.length,1);
  assert.deepEqual(await call("agreement","brandon"),a);assert.deepEqual(await call("agreement_data","josue",{agreement_id:a.id}),original);
  await call("trash","josue",{type:"agreement",id:a.id});await call("restore","tono",{type:"agreement",id:a.id});
  assert.deepEqual(await call("agreement_data","josue",{agreement_id:a.id}),original);
  assert.equal((await call("trash","josue",{type:"unknown",id:a.id})).status,400);
  assert.equal((await call("restore","josue",{type:"agreement",id:a.id})).status,409);
});
