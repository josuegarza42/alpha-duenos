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
test("only the proposer cancels; history and votes remain",async()=>{
  const m=await proposed();await call("vote","tono",{motion_id:m.motion_id,value:"approve"});
  assert.equal((await call("cancel","brandon",{motion_id:m.motion_id})).status,403);
  assert.equal((await call("cancel","josue",{motion_id:m.motion_id})).ok,true);
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
