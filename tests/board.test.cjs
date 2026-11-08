"use strict";
const {test,before,after,beforeEach}=require("node:test");
const assert=require("node:assert/strict");
const {openDatabase,rpc,loginAll,sample,schema,testKey}=require("../tools/test-db.cjs");
let db,tokens;
before(async()=>{db=await openDatabase();});
after(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec("truncate alpha_private.sessions,alpha_private.events,alpha_private.discussion_comments,alpha_private.resolution_votes,alpha_private.votes,alpha_private.agreements,alpha_private.motions,alpha_private.responsibilities restart identity cascade; update alpha_private.board set revision=0;");
  tokens=await loginAll(db);
});
const call=(action,actor="josue",payload={})=>rpc(db,action,tokens[actor],payload);
async function proposed(payload=sample()){return call("create","josue",payload);}
async function active(){const m=await proposed();await call("vote","josue",{motion_id:m.motion_id,value:"approve"});await call("vote","brandon",{motion_id:m.motion_id,value:"approve"});await call("vote","tono",{motion_id:m.motion_id,value:"approve"});return m;}
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
  state=await call("state");assert.equal(state.motions[0].status,"pending");assert.equal(state.responsibilities[0].status,"proposed");
  await call("vote","tono",{motion_id:m.motion_id,value:"approve"});
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
test("changes and reassignments take effect only after three approvals",async()=>{
  const m=await active();const edit=await call("motion","tono",{responsibility_id:m.id,kind:"edit",payload:sample({owner:"brandon",frequency:"Semanal"}),reason:"Repartir el trabajo"});assert.ok(edit.motion_id);
  assert.equal((await call("state")).responsibilities[0].owner,"josue");
  assert.equal((await call("motion","tono",{responsibility_id:m.id,kind:"retire",reason:"Otra propuesta"})).status,409);
  await call("vote","tono",{motion_id:edit.motion_id,value:"approve"});await call("vote","josue",{motion_id:edit.motion_id,value:"approve"});await call("vote","brandon",{motion_id:edit.motion_id,value:"approve"});
  const r=(await call("state")).responsibilities[0];assert.equal(r.owner,"brandon");assert.equal(r.frequency,"Semanal");
});
test("rejected edits retain the original responsibility",async()=>{
  const m=await active();const edit=await call("motion","tono",{responsibility_id:m.id,kind:"edit",payload:sample({title:"Otro título"}),reason:"Probar el cambio"});
  await call("vote","josue",{motion_id:edit.motion_id,value:"reject"});await call("vote","brandon",{motion_id:edit.motion_id,value:"reject"});
  assert.equal((await call("state")).responsibilities[0].title,sample().title);
});
test("retirement remains pending until all three approve",async()=>{
  const m=await active();const retire=await call("motion","brandon",{responsibility_id:m.id,kind:"retire",reason:"La función ya no aplica"});
  await call("vote","brandon",{motion_id:retire.motion_id,value:"approve"});assert.equal((await call("state")).responsibilities[0].status,"active");
  await call("vote","tono",{motion_id:retire.motion_id,value:"approve"});assert.equal((await call("state")).responsibilities[0].status,"active");await call("vote","josue",{motion_id:retire.motion_id,value:"approve"});assert.equal((await call("state")).responsibilities[0].status,"retired");
});
test("agreements require active functions and no open votes",async()=>{
  assert.equal((await call("agreement")).status,409);const m=await proposed();assert.equal((await call("agreement")).status,409);
  await call("vote","josue",{motion_id:m.motion_id,value:"approve"});await call("vote","brandon",{motion_id:m.motion_id,value:"approve"});await call("vote","tono",{motion_id:m.motion_id,value:"approve"});assert.equal((await call("agreement")).version,1);
});
test("agreement versions are immutable, include votes and avoid duplicates",async()=>{
  const m=await active();const a=await call("agreement");assert.deepEqual(await call("agreement","brandon"),a);
  const original=await call("agreement_data","josue",{agreement_id:a.id});assert.equal(original.snapshot.responsibilities[0].approval.votes.brandon,"approve");
  const edit=await call("motion","tono",{responsibility_id:m.id,kind:"edit",payload:sample({owner:"tono"}),reason:"Nuevo reparto"});
  await call("vote","josue",{motion_id:edit.motion_id,value:"approve"});await call("vote","tono",{motion_id:edit.motion_id,value:"approve"});await call("vote","brandon",{motion_id:edit.motion_id,value:"approve"});
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
  await call("vote","brandon",{motion_id:edit.motion_id,value:"approve"});await call("vote","josue",{motion_id:edit.motion_id,value:"approve"});
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
  await call("vote","josue",{motion_id:edit.motion_id,value:"approve"});await call("vote","tono",{motion_id:edit.motion_id,value:"approve"});await call("vote","brandon",{motion_id:edit.motion_id,value:"approve"});
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
  const m=await proposed(payload);await call("vote","josue",{motion_id:m.motion_id,value:"approve"});await call("vote","brandon",{motion_id:m.motion_id,value:"approve"});await call("vote","tono",{motion_id:m.motion_id,value:"approve"});
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
  await call("vote","tono",{motion_id:retire.motion_id,value:"approve"});assert.equal((await call("state")).responsibilities[0].status,"active");await call("vote","josue",{motion_id:retire.motion_id,value:"approve"});
  assert.equal((await call("trash","tono",{type:"responsibility",id:m.id})).ok,true);
  assert.equal((await call("restore","josue",{type:"responsibility",id:m.id})).ok,true);
  assert.equal((await call("state")).responsibilities[0].status,"retired");
});
test("penalty removal requires three votes and preserves earlier agreements and incidents",async()=>{
  const m=await active(),a=await call("agreement"),original=await call("agreement_data","josue",{agreement_id:a.id});
  await call("incident","tono",{responsibility_id:m.id,occurred_on:"2026-01-01",detail:"Pendiente de revisión"});
  const edit=await call("motion","tono",{responsibility_id:m.id,kind:"edit",payload:sample({penalty:""}),reason:"Quitar penalización"});
  await call("vote","tono",{motion_id:edit.motion_id,value:"approve"});assert.equal((await call("state")).responsibilities[0].penalty,sample().penalty);
  await call("vote","brandon",{motion_id:edit.motion_id,value:"approve"});await call("vote","josue",{motion_id:edit.motion_id,value:"approve"});assert.equal((await call("state")).responsibilities[0].penalty,"");
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

const improvement=(overrides={})=>({title:"Renovar bicicletas de cardio",description:"Sustituir las bicicletas que ya fallan.",benefit:"Más equipos disponibles y mejor experiencia.",budget:"Pendiente de cotización",...overrides});
async function split(m,actors=["josue","brandon","tono"]){
  for(const actor of actors)assert.equal((await call("vote",actor,{motion_id:m.motion_id,value:actor==="tono"?"reject":"approve"})).ok,true);
}
test("2–1 enters discussion in every vote order and preserves the proposed function",async()=>{
  for(const actors of [["josue","brandon","tono"],["tono","josue","brandon"],["josue","tono","brandon"]]){
    const m=await proposed(sample({title:actors.join(" ")}));await split(m,actors);
    const state=await call("state"),motion=state.motions.find(x=>x.id===m.motion_id);
    assert.equal(motion.status,"discussion");assert.equal(motion.decided_at,null);assert.deepEqual(motion.votes,{josue:"approve",brandon:"approve",tono:"reject"});
    assert.equal(state.responsibilities.find(x=>x.id===m.id).status,"proposed");assert.ok(!state.trash.length);
    assert.equal((await call("trash","josue",{type:"responsibility",id:m.id})).status,409);
    assert.equal((await call("cancel","josue",{motion_id:m.motion_id})).status,409);
    assert.equal((await call("vote","tono",{motion_id:m.motion_id,value:"approve"})).status,409);
  }
});
test("discussion records comments and needs two distinct final votes to approve",async()=>{
  const m=await proposed();await split(m);
  assert.equal((await call("agreement")).status,409);
  assert.equal((await call("comment","tono",{motion_id:m.motion_id,reason:""})).status,400);
  assert.equal((await call("comment","tono",{motion_id:m.motion_id,reason:"Acordemos un alcance menor",partner:"josue"})).ok,true);
  for(let n=0;n<2;n++)assert.equal((await call("resolve_discussion","josue",{motion_id:m.motion_id,value:"approve",reason:"Acordamos el alcance"})).status,"discussion");
  assert.equal((await call("state")).responsibilities[0].status,"proposed");
  assert.equal((await call("resolve_discussion","brandon",{motion_id:m.motion_id,value:"approve",reason:"De acuerdo con el alcance"})).status,"approved");
  const state=await call("state"),motion=state.motions[0];assert.equal(state.responsibilities[0].status,"active");assert.equal(motion.votes.tono,"reject");assert.equal(motion.comments[0].partner,"tono");assert.equal(Object.keys(motion.resolution_votes).length,2);
  assert.equal((await call("resolve_discussion","tono",{motion_id:m.motion_id,value:"reject",reason:"Llegó tarde"})).status,409);
  const a=await call("agreement"),saved=await call("agreement_data","josue",{agreement_id:a.id});
  assert.equal(saved.snapshot.responsibilities[0].approval.discussion.votes.tono,"reject");
  assert.equal(saved.snapshot.responsibilities[0].approval.votes.brandon,"approve");
});
test("a discussion can be denied and final votes can change while open",async()=>{
  const m=await proposed();await split(m);
  await call("resolve_discussion","josue",{motion_id:m.motion_id,value:"approve",reason:"Inicialmente a favor"});
  await call("resolve_discussion","josue",{motion_id:m.motion_id,value:"reject",reason:"El costo es excesivo"});
  assert.equal((await call("resolve_discussion","tono",{motion_id:m.motion_id,value:"reject",reason:"No conviene"})).status,"rejected");
  const state=await call("state");assert.equal(state.responsibilities[0].status,"rejected");assert.equal(state.motions[0].comments.length,3);assert.equal(state.trash.length,0);
});
test("changes in discussion keep the current role and prevent competing motions",async()=>{
  const m=await active(),edit=await call("motion","brandon",{responsibility_id:m.id,kind:"edit",payload:sample({owner:"tono"}),reason:"Nuevo reparto"});
  await split(edit);assert.equal((await call("state")).responsibilities[0].owner,"josue");
  assert.equal((await call("motion","tono",{responsibility_id:m.id,kind:"retire",reason:"Compite"})).status,409);
  assert.equal((await call("agreement")).status,409);
  await call("resolve_discussion","josue",{motion_id:edit.motion_id,value:"approve",reason:"Reparto acordado"});
  await call("resolve_discussion","tono",{motion_id:edit.motion_id,value:"approve",reason:"Acepto"});
  assert.equal((await call("state")).responsibilities[0].owner,"tono");
});
test("gym improvements do not create roles, metrics, penalties or block role agreements",async()=>{
  await active();const m=await call("create_improvement","brandon",improvement({owner:"tono",scope:"Como socio"}));assert.ok(m.motion_id);
  let state=await call("state");assert.equal(state.responsibilities.length,1);assert.equal(state.motions.find(x=>x.id===m.motion_id).kind,"improvement");assert.equal(state.motions.find(x=>x.id===m.motion_id).payload.owner,undefined);
  assert.equal((await call("agreement")).version,1);
  await split(m);state=await call("state");assert.equal(state.motions.find(x=>x.id===m.motion_id).status,"discussion");
  await call("comment","tono",{motion_id:m.motion_id,reason:"Cotizar primero"});
  await call("resolve_discussion","tono",{motion_id:m.motion_id,value:"approve",reason:"Costo confirmado"});
  assert.equal((await call("resolve_discussion","brandon",{motion_id:m.motion_id,value:"approve",reason:"Presupuesto viable"})).status,"approved");
  const backup=await call("backup"),motion=backup.motions.find(x=>x.id===m.motion_id);assert.equal(motion.comments.length,3);assert.equal(motion.resolution_votes.tono,"approve");assert.equal(backup.responsibilities.length,1);
});
test("gym improvements support unanimous approval, denial and cancellation",async()=>{
  for(const expected of ["approved","rejected","cancelled"]){
    const m=await call("create_improvement","josue",improvement());
    if(expected==="cancelled")await call("cancel","brandon",{motion_id:m.motion_id});
    else for(const actor of expected==="approved"?["josue","brandon","tono"]:["tono","josue"])await call("vote",actor,{motion_id:m.motion_id,value:expected==="approved"?"approve":"reject"});
    assert.equal((await call("state")).motions.find(x=>x.id===m.motion_id).status,expected);
  }
  assert.equal((await call("state")).responsibilities.length,0);
});
test("validates gym improvements, discussion actions, and private discussion tables",async()=>{
  for(const overrides of [{title:" "},{description:42},{benefit:""},{budget:"x".repeat(301)}])assert.equal((await call("create_improvement","josue",improvement(overrides))).status,400);
  const m=await call("create_improvement","josue",improvement());
  assert.equal((await call("comment","josue",{motion_id:m.motion_id,reason:"Fuera de discusión"})).status,409);
  await split(m);
  for(const payload of [{value:"approve",reason:" "},{value:"invalid",reason:"Motivo"},{value:"approve",reason:42}])assert.equal((await call("resolve_discussion","josue",{motion_id:m.motion_id,...payload})).status,400);
  assert.equal((await rpc(db,"comment","",{motion_id:m.motion_id,reason:"Anónimo"})).status,401);
  for(const table of ["discussion_comments","resolution_votes"])await assert.rejects(db.transaction(async tx=>{await tx.exec("set local role anon");await tx.query(`select * from alpha_private.${table}`);}),/permission denied/);
  await db.exec(schema());assert.equal((await call("state")).motions[0].status,"discussion");
});

async function finish(m,value="approve",actors=["josue","brandon","tono"]){for(const actor of actors)assert.equal((await call("vote",actor,{motion_id:m.motion_id,value})).ok,true);}
async function appeal(m,reason="Reconsiderar la decisión"){return call("appeal","tono",{motion_id:m.motion_id,reason});}
async function resolve(m,value){for(const actor of ["josue","brandon"])assert.equal((await call("resolve_discussion",actor,{motion_id:m.motion_id,value,reason:"Resultado acordado"})).ok,true);}
async function rawMotion(id){return (await db.query("select to_jsonb(m) data from alpha_private.motions m where id=$1",[id])).rows[0].data;}
test("appeals keep the original approved function and votes until a new majority decides",async()=>{
  const m=await active(),original=await rawMotion(m.motion_id),originalVotes=(await call("state")).motions[0].votes;
  const a=await appeal(m);assert.ok(a.motion_id);let state=await call("state"),round=state.motions.find(x=>x.id===a.motion_id);
  assert.equal(round.status,"discussion");assert.equal(round.appeal_of,m.motion_id);assert.deepEqual(round.votes,{});assert.deepEqual(round.resolution_votes,{});assert.equal(round.proposer,"tono");assert.equal(state.responsibilities[0].status,"active");
  assert.equal((await call("agreement")).status,409);assert.equal(state.motions.find(x=>x.id===m.motion_id).superseded_by,null);
  for(let n=0;n<2;n++)await call("resolve_discussion","josue",{motion_id:a.motion_id,value:"reject",reason:"Hace falta reconsiderarla"});
  assert.equal((await call("state")).responsibilities[0].status,"active");
  await call("resolve_discussion","brandon",{motion_id:a.motion_id,value:"reject",reason:"No debe seguir vigente"});
  state=await call("state");assert.equal(state.responsibilities[0].status,"rejected");assert.equal(state.motions.find(x=>x.id===a.motion_id).status,"rejected");assert.equal(state.motions.find(x=>x.id===m.motion_id).superseded_by,a.motion_id);assert.deepEqual(state.motions.find(x=>x.id===m.motion_id).votes,originalVotes);assert.deepEqual(await rawMotion(m.motion_id),original);
  const next=await appeal(a);assert.ok(next.motion_id);await resolve(next,"approve");assert.equal((await call("state")).responsibilities[0].status,"active");
  const backup=await call("backup");assert.equal(backup.motions.length,3);assert.equal(backup.motions.find(x=>x.id===a.motion_id).appeal_of,m.motion_id);
});
test("denied functions can be appealed and activated without replacing the original denial",async()=>{
  const m=await proposed();await finish(m,"reject",["josue","brandon"]);const original=await rawMotion(m.motion_id);
  const a=await appeal(m);assert.ok(a.motion_id);assert.equal((await call("state")).responsibilities[0].status,"rejected");await resolve(a,"approve");
  assert.equal((await call("state")).responsibilities[0].status,"active");assert.deepEqual(await rawMotion(m.motion_id),original);
});
test("approved and denied gym improvements can be appealed without creating roles",async()=>{
  for(const value of ["approve","reject"]){
    const m=await call("create_improvement","josue",improvement());await finish(m,value,value==="approve"?["josue","brandon","tono"]:["josue","brandon"]);
    const original=await rawMotion(m.motion_id),a=await appeal(m);assert.ok(a.motion_id);await resolve(a,value==="approve"?"reject":"approve");
    const state=await call("state");assert.equal(state.responsibilities.length,0);assert.equal(state.motions.find(x=>x.id===a.motion_id).status,value==="approve"?"rejected":"approved");assert.deepEqual(await rawMotion(m.motion_id),original);
  }
});
test("appealing an approved edit restores its prior owner, terms and agreement history if denied",async()=>{
  const m=await active(),oldAgreement=await call("agreement"),oldSnapshot=await call("agreement_data","josue",{agreement_id:oldAgreement.id});
  const changed=sample({title:"Corte semanal",owner:"brandon",penalty:"Nueva penalización",metric:{name:"Errores",target:0,unit:"errores",direction:"lte"}});
  const edit=await call("motion","josue",{responsibility_id:m.id,kind:"edit",payload:changed,reason:"Reorganizar"});await finish(edit);
  const a=await appeal(edit);assert.ok(a.motion_id);assert.equal((await call("state")).responsibilities[0].owner,"brandon");await resolve(a,"reject");
  const state=await call("state"),r=state.responsibilities[0];assert.equal(r.status,"active");assert.equal(r.owner,"josue");assert.equal(r.title,sample().title);assert.equal(r.penalty,sample().penalty);assert.deepEqual(r.metric,sample().metric);
  const current=await call("agreement"),snapshot=await call("agreement_data","josue",{agreement_id:current.id});assert.equal(snapshot.snapshot.responsibilities[0].approval.motion_id,a.motion_id);assert.equal(snapshot.snapshot.responsibilities[0].approval.discussion.appeal_of,edit.motion_id);
  assert.deepEqual(await call("agreement_data","josue",{agreement_id:oldAgreement.id}),oldSnapshot);
});
test("appealing a denied edit can approve the proposed version",async()=>{
  const m=await active(),edit=await call("motion","tono",{responsibility_id:m.id,kind:"edit",payload:sample({owner:"tono"}),reason:"Nuevo reparto"});await finish(edit,"reject",["josue","brandon"]);
  const a=await appeal(edit);assert.ok(a.motion_id);await resolve(a,"approve");assert.equal((await call("state")).responsibilities[0].owner,"tono");
});
test("appeals reconsider both approved and denied retirements",async()=>{
  for(const value of ["approve","reject"]){
    const m=await active(),retire=await call("motion","josue",{responsibility_id:m.id,kind:"retire",reason:"Revisar retiro"});await finish(retire,value,value==="approve"?["josue","brandon","tono"]:["josue","brandon"]);
    const a=await appeal(retire);assert.ok(a.motion_id);const before=(await call("state")).responsibilities.find(x=>x.id===m.id).status;assert.equal(before,value==="approve"?"retired":"active");
    await resolve(a,value==="approve"?"reject":"approve");assert.equal((await call("state")).responsibilities.find(x=>x.id===m.id).status,value==="approve"?"active":"retired");
  }
});
test("legacy approved edits recover their previous approved version for appeal",async()=>{
  const m=await active(),edit=await call("motion","josue",{responsibility_id:m.id,kind:"edit",payload:sample({owner:"brandon"}),reason:"Reparto anterior"});await finish(edit);
  await db.query("update alpha_private.motions set before_state=null where id=$1",[edit.motion_id]);
  const a=await appeal(edit);assert.ok(a.motion_id);await resolve(a,"reject");assert.equal((await call("state")).responsibilities[0].owner,"josue");
});
test("duplicate and stale appeals cannot overwrite a newer decision or an open vote",async()=>{
  const m=await active(),edit=await call("motion","josue",{responsibility_id:m.id,kind:"edit",payload:sample({owner:"brandon"}),reason:"Nuevo reparto"});
  assert.equal((await appeal(m)).status,409);await finish(edit);assert.equal((await appeal(m)).status,409);
  assert.equal((await call("state")).motions.find(x=>x.id===m.motion_id).can_appeal,false);
  const results=await Promise.all([appeal(edit),appeal(edit)]);assert.equal(results.filter(x=>x.motion_id).length,1);assert.equal(results.filter(x=>x.status===409).length,1);
  await resolve(results.find(x=>x.motion_id),"approve");assert.equal((await appeal(edit)).status,409);
});
test("appeal validation preserves sessions, author identity and closed decision data",async()=>{
  const m=await proposed();assert.equal((await appeal(m)).status,409);await finish(m);
  for(const reason of [" ",42,"x".repeat(1001),null])assert.equal((await appeal(m,reason)).status,400);
  assert.equal((await rpc(db,"appeal","",{motion_id:m.motion_id,reason:"Sin sesión"})).status,401);
  assert.equal((await appeal({motion_id:"not-a-uuid"})).status,400);assert.equal((await appeal({motion_id:"00000000-0000-0000-0000-000000000000"})).status,404);
  const a=await call("appeal","brandon",{motion_id:m.motion_id,reason:"Revisar alcance",actor:"josue",payload:sample({owner:"tono"}),before_state:sample({owner:"tono"})});assert.ok(a.motion_id);
  const round=(await call("state")).motions.find(x=>x.id===a.motion_id);assert.equal(round.proposer,"brandon");assert.equal(round.payload.owner,"josue");
  await db.exec(schema());assert.equal((await call("state")).motions.find(x=>x.id===a.motion_id).appeal_of,m.motion_id);
  assert.equal((await call("trash","josue",{type:"responsibility",id:m.id})).status,409);
});
test("hidden decisions must be restored before appeal",async()=>{
  const m=await proposed();await finish(m,"reject",["josue","brandon"]);await call("trash","josue",{type:"responsibility",id:m.id});assert.equal((await appeal(m)).status,409);
  await call("restore","josue",{type:"responsibility",id:m.id});assert.ok((await appeal(m)).motion_id);
});
