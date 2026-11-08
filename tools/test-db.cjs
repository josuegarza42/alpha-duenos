"use strict";
// Runs the production SQL unchanged in an isolated Postgres WASM database.
const {PGlite}=require("@electric-sql/pglite");
const {pgcrypto}=require("@electric-sql/pglite/contrib/pgcrypto");
const {readFileSync}=require("node:fs");
const {resolve}=require("node:path");
const {createHash}=require("node:crypto");
const partners=[{slug:"josue",name:"Josue Garza"},{slug:"brandon",name:"Brandon"},{slug:"tono",name:"Toño"}];
const testKey=slug=>`test-${slug}`;
const schema=()=>readFileSync(resolve(__dirname,"../supabase/schema.sql"),"utf8");
async function openDatabase(){
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec("create role anon; create role authenticated; create schema extensions;");
  await db.exec(schema());
  for(const p of partners)await db.query("insert into alpha_private.partners(slug,name,key_hash) values($1,$2,$3)",[p.slug,p.name,createHash("sha256").update(testKey(p.slug)).digest("hex")]);
  return db;
}
async function rpc(db,action,token="",payload={}){
  return db.transaction(async tx=>{
    await tx.exec("set local role anon");
    const result=await tx.query("select public.alpha_api($1,$2,$3::jsonb) result",[action,token,JSON.stringify(payload)]);
    return result.rows[0].result;
  });
}
async function loginAll(db){
  const tokens={};for(const p of partners){const r=await rpc(db,"login","",{key:testKey(p.slug)});if(r.error)throw new Error(r.error);tokens[p.slug]=r.token;}return tokens;
}
const sample=(overrides={})=>({title:"Preparar el corte mensual",description:"Reunir ingresos, egresos y comprobantes del periodo.",owner:"josue",category:"Finanzas",frequency:"Mensual",deliverable:"Corte con comprobantes y saldo conciliado.",scope:"Como socio",penalty:"Reponer la entrega en 48 horas y explicar el retraso.",metric:{name:"Entregas a tiempo",target:100,unit:"%",direction:"gte"},...overrides});
async function seedDemo(db){
  const tokens=await loginAll(db);
  const examples=[sample(),sample({title:"Coordinar la facturación SAT",owner:"brandon",category:"Fiscal",frequency:"Mensual y por solicitud",description:"Revisar las solicitudes y emitir las facturas correspondientes.",deliverable:"Facturas emitidas y relación de solicitudes atendidas."}),sample({title:"Revisar el equipo del gimnasio",owner:"tono",category:"Operación",frequency:"Semanal",description:"Detectar fallas y coordinar su atención.",deliverable:"Lista de revisión y reporte de mantenimiento."})];
  for(const value of examples){const m=await rpc(db,"create",tokens.josue,value);await rpc(db,"vote",tokens.josue,{motion_id:m.motion_id,value:"approve"});await rpc(db,"vote",tokens.brandon,{motion_id:m.motion_id,value:"approve"});await rpc(db,"vote",tokens.tono,{motion_id:m.motion_id,value:"approve"});}
  // Preview-only scenarios make every decision stage available for UI checks.
  const waiting=await rpc(db,"create",tokens.josue,sample({title:"Revisar el inventario de mantenimiento",owner:"tono",category:"Operación"}));
  await rpc(db,"vote",tokens.brandon,{motion_id:waiting.motion_id,value:"approve"});
  const discussion=await rpc(db,"create",tokens.josue,sample({title:"Coordinar las campañas de inscripción",owner:"brandon",category:"Marketing"}));
  await rpc(db,"vote",tokens.josue,{motion_id:discussion.motion_id,value:"approve"});await rpc(db,"vote",tokens.brandon,{motion_id:discussion.motion_id,value:"approve"});await rpc(db,"vote",tokens.tono,{motion_id:discussion.motion_id,value:"reject"});
  for(const [title,category,stage] of [["Renovar bicicletas de cardio","Equipo y mantenimiento","pending"],["Mejorar la ventilación de la sala","Instalaciones","discussion"],["Ampliar los horarios de fin de semana","Servicios y experiencia","rejected"]]){
    const m=await rpc(db,"create_improvement",tokens.brandon,{title,category,description:"Revisar opciones y cotizaciones para mejorar la experiencia de los clientes.",benefit:"Más comodidad y disponibilidad del gimnasio.",budget:"Pendiente de cotización"});
    if(stage==="discussion"){await rpc(db,"vote",tokens.josue,{motion_id:m.motion_id,value:"approve"});await rpc(db,"vote",tokens.brandon,{motion_id:m.motion_id,value:"approve"});await rpc(db,"vote",tokens.tono,{motion_id:m.motion_id,value:"reject"});}
    if(stage==="rejected"){await rpc(db,"vote",tokens.brandon,{motion_id:m.motion_id,value:"reject"});await rpc(db,"vote",tokens.tono,{motion_id:m.motion_id,value:"reject"});}
  }
  return tokens;
}
module.exports={openDatabase,rpc,loginAll,sample,seedDemo,schema,testKey};
