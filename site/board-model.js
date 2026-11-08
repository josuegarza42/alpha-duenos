"use strict";
// Shared presentation rules. Classification never changes stored decisions or votes.
(function(root){
  const gymCategories=["Equipo y mantenimiento","Instalaciones","Servicios y experiencia","Marketing y ventas","Administración y finanzas","General"];
  const roleAreas={Finanzas:"Finanzas y administración",Fiscal:"Fiscal y trámites",Trámites:"Fiscal y trámites",Operación:"Operación y mantenimiento",Marketing:"Marketing y ventas",Sistemas:"Sistemas y tecnología",General:"General"};
  const scopeOf=m=>m.kind==="improvement"?"gym":"roles";
  const current=r=>!r.superseded_by;
  const open=m=>["pending","discussion"].includes(m.status);
  const needsVote=(m,slug)=>open(m)&&!(m.status==="discussion"?m.resolution_votes:m.votes)?.[slug];
  const responsibility=(m,state)=>state.responsibilities.find(r=>r.id===m.responsibility_id);
  const ownerOf=(m,state)=>m.payload.owner||responsibility(m,state)?.owner;
  const categoryOf=(m,state)=>scopeOf(m)==="gym"?(gymCategories.includes(m.payload.category)?m.payload.category:"General"):(roleAreas[m.payload.category||responsibility(m,state)?.category]||"General");
  const normalize=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  function filter(motions,options,state){return motions.filter(m=>{
    if(!current(m)||(options.scope&&scopeOf(m)!==options.scope)||(options.status&&m.status!==options.status))return false;
    if(options.category&&options.category!=="all"&&categoryOf(m,state)!==options.category)return false;
    if(options.person&&options.person!=="all"&&(scopeOf(m)==="gym"?m.proposer:ownerOf(m,state))!==options.person)return false;
    if(options.needsMyVote&&!needsVote(m,state.me.slug))return false;
    if(options.appealsOnly&&!m.appeal_of)return false;
    const query=normalize(options.search);if(!query)return true;
    const owner=state.partners.find(p=>p.slug===ownerOf(m,state));
    return normalize([m.title,m.payload.description,m.payload.benefit,m.payload.deliverable,m.reason,categoryOf(m,state),owner?.name].join(" ")).includes(query);
  });}
  function sort(motions,slug){return [...motions].sort((a,b)=>{
    if(open(a)&&open(b))return Number(needsVote(b,slug))-Number(needsVote(a,slug))||Number(b.status==="discussion")-Number(a.status==="discussion")||new Date(a.created_at)-new Date(b.created_at)||a.id.localeCompare(b.id);
    return new Date(b.decided_at||b.created_at)-new Date(a.decided_at||a.created_at)||a.id.localeCompare(b.id);
  });}
  function counts(state,scope){const motions=state.motions.filter(m=>current(m)&&(!scope||scopeOf(m)===scope));return Object.fromEntries(["pending","discussion","approved","rejected","cancelled"].map(status=>[status,motions.filter(m=>m.status===status).length]));}
  const api={gymCategories,roleAreas,scopeOf,current,open,needsVote,ownerOf,categoryOf,normalize,filter,sort,counts};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;else root.AlphaBoard=Object.freeze(api);
})(typeof window!=="undefined"?window:globalThis);
