"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const Board=require("../site/board-model.js");
const role={id:"role",title:"Corte mensual",owner:"josue",category:"Finanzas",description:"Conciliar ingresos",deliverable:"Corte con comprobantes"};
const state={me:{slug:"josue"},partners:[{slug:"josue",name:"Josue Garza"},{slug:"brandon",name:"Brandon"},{slug:"tono",name:"Toño"}],responsibilities:[role]};
const motion=(overrides={})=>({id:"one",kind:"create",responsibility_id:"role",title:"Corte mensual",payload:{...role},proposer:"brandon",status:"pending",votes:{},resolution_votes:{},created_at:"2026-11-01T12:00:00Z",...overrides});
test("separates gym ideas from role decisions, including appeals and retirements",()=>{
 const roles=motion(),gym=motion({id:"gym",kind:"improvement",responsibility_id:null,payload:{category:"Instalaciones"},appeal_of:"original"}),retire=motion({id:"retire",kind:"retire",payload:{}}),old=motion({id:"old",status:"approved",superseded_by:"one"});
 assert.deepEqual(Board.filter([roles,gym,retire,old],{scope:"roles"},state).map(m=>m.id),["one","retire"]);assert.deepEqual(Board.filter([roles,gym],{scope:"gym"},state).map(m=>m.id),["gym"]);assert.equal(Board.categoryOf(retire,state),"Finanzas y administración");assert.equal(Board.categoryOf(motion({kind:"improvement",payload:{}}),state),"General");
});
test("my pending votes use a fresh ballot for discussions and appeals",()=>{
 const voted=motion({votes:{josue:"approve"}}),discussion=motion({id:"discussion",status:"discussion",votes:{josue:"approve"},appeal_of:"old"});
 assert.equal(Board.needsVote(voted,"josue"),false);assert.equal(Board.needsVote(discussion,"josue"),true);assert.equal(Board.needsVote({...discussion,resolution_votes:{josue:"reject"}},"josue"),false);assert.equal(Board.needsVote({...discussion,status:"approved"},"josue"),false);
 assert.deepEqual(Board.filter([voted,discussion],{needsMyVote:true},state).map(m=>m.id),["discussion"]);
});
test("search and category/person filters work together without changing records",()=>{
 const list=[motion(),motion({id:"service",kind:"improvement",payload:{category:"Servicios y experiencia",description:"Atención al cliente"},title:"Ampliar horarios"})],before=JSON.stringify(list);
 assert.deepEqual(Board.filter(list,{search:"atencion",category:"Servicios y experiencia",person:"brandon"},state).map(m=>m.id),["service"]);assert.equal(Board.filter(list,{scope:"roles",person:"josue",search:"finanzas"},state).length,1);assert.equal(Board.filter(list,{scope:"roles",person:"tono"},state).length,0);assert.equal(JSON.stringify(list),before);
});
test("prioritizes a missing final vote and excludes superseded outcomes from counts",()=>{
 const oldest=motion({id:"oldest"}),discussion=motion({id:"discussion",status:"discussion",created_at:"2026-11-06T12:00:00Z"}),voted=motion({id:"voted",votes:{josue:"approve"}}),superseded=motion({id:"superseded",status:"approved",superseded_by:"decision"}),decision=motion({id:"decision",status:"rejected",appeal_of:"superseded"});
 assert.deepEqual(Board.sort([oldest,voted,discussion],"josue").map(m=>m.id),["discussion","oldest","voted"]);assert.deepEqual(Board.counts({...state,motions:[superseded,decision]},"roles"),{pending:0,discussion:0,approved:0,rejected:1,cancelled:0});assert.deepEqual(Board.filter([discussion,decision],{appealsOnly:true},state).map(m=>m.id),["decision"]);
});
