"use strict";
const CONFIG=window.ALPHA_CONFIG;
const app=document.getElementById("app"),modal=document.getElementById("modal");
const storeKey="alpha-duenos-session-v1";
let token=localStorage.getItem(storeKey)||"",state=null,tab="proposals",busy=false,lastSync=null,offline=false;
let filterOwner="all",filterScope="all",voteOwner="all",toastTimer;
const kinds={create:"Nueva responsabilidad",edit:"Cambio de responsabilidad",retire:"Retiro de responsabilidad",improvement:"Mejora del gimnasio"};
const statuses={pending:"En votación",discussion:"En discusión",approved:"Aprobada",rejected:"Negada",cancelled:"Cancelada"};
function h(tag,attrs={},...kids){const el=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(v===null||v===undefined||v===false)continue;if(k.startsWith("on"))el.addEventListener(k.slice(2).toLowerCase(),v);else if(k==="class")el.className=v;else if(k in el&&!k.startsWith("aria"))el[k]=v;else el.setAttribute(k,v===true?"":v);}for(const child of kids.flat(Infinity)){if(child!==null&&child!==undefined&&child!==false)el.append(child instanceof Node?child:document.createTextNode(String(child)));}return el;}
function icon(name){const paths={plus:"M12 5v14M5 12h14",download:"M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4",logout:"M9 5H4v14h5m5-14 7 7-7 7m-6-7h13",check:"m5 12 4 4L19 6",close:"m6 6 12 12M18 6 6 18"};const s=document.createElementNS("http://www.w3.org/2000/svg","svg");s.setAttribute("viewBox","0 0 24 24");s.setAttribute("fill","none");s.setAttribute("stroke","currentColor");s.setAttribute("stroke-width","1.8");s.setAttribute("stroke-linecap","round");s.setAttribute("stroke-linejoin","round");s.setAttribute("aria-hidden","true");const p=document.createElementNS(s.namespaceURI,"path");p.setAttribute("d",paths[name]||paths.plus);s.append(p);return s;}
const badge=(text,tone="")=>h("span",{class:`badge ${tone}`},text);
const button=(label,click,variant="",ico="",attrs={})=>h("button",{type:"button",class:`button ${variant}`,onClick:click,...attrs},ico?icon(ico):null,label);
function toast(message,error=false){const el=document.getElementById("toast");el.textContent=message;el.className=`visible ${error?"error":""}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.className="";},error?8000:4500);}
function name(slug){return state?.partners.find(p=>p.slug===slug)?.name||slug;}
function shortName(slug){return name(slug).split(" ")[0];}
function date(value){return new Intl.DateTimeFormat("es-MX",{dateStyle:"medium",timeStyle:"short",timeZone:"America/Mexico_City"}).format(new Date(value));}
function rpcRoute(path,body){
  if(path==="/api/login")return ["login",body];
  if(path==="/api/logout")return ["logout",{}];
  if(path==="/api/state")return ["state",{}];
  if(["/api/measure","/api/incident","/api/resolve_incident","/api/change_key","/api/trash","/api/restore"].includes(path))return [path.slice(5),body];
  if(path==="/api/backup")return ["backup",{}];
  if(path==="/api/agreements")return ["agreement",{}];
  if(path==="/api/improvements")return ["create_improvement",body];
  if(path==="/api/responsibilities")return ["create",body];
  let match=path.match(/^\/api\/responsibilities\/([^/]+)\/motions$/);
  if(match)return ["motion",{...body,responsibility_id:match[1]}];
  match=path.match(/^\/api\/motions\/([^/]+)\/(vote|cancel|comment|resolve_discussion)$/);
  if(match)return [match[2],{...body,motion_id:match[1]}];
  match=path.match(/^\/api\/agreements\/([^/]+)\/pdf$/);
  if(match)return ["agreement_data",{agreement_id:match[1]}];
  throw new Error("Operación no disponible.");
}
async function api(path,body){
  const [action,payload]=rpcRoute(path,body);
  const headers={"Content-Type":"application/json"};let url,request;
  if(CONFIG.localApi){url=CONFIG.localApi+"/rest/v1/rpc/alpha_api";request={p_action:action,p_token:token,p_payload:payload};}
  else{
    if(!CONFIG.supabaseUrl||!CONFIG.publishableKey)throw new Error("El almacenamiento compartido aún necesita conectarse. Josue está terminando la activación.");
    url=CONFIG.supabaseUrl.replace(/\/$/,"")+"/rest/v1/rpc/alpha_api";
    headers.apikey=CONFIG.publishableKey;
    if(CONFIG.publishableKey.startsWith("eyJ"))headers.Authorization=`Bearer ${CONFIG.publishableKey}`;
    request={p_action:action,p_token:token,p_payload:payload};
  }
  let res;try{res=await fetch(url,{method:"POST",headers,body:JSON.stringify(request),cache:"no-store",credentials:"omit",signal:AbortSignal.timeout(20000)});}catch{throw new Error("No se pudo confirmar la conexión. Actualiza antes de repetir una operación.");}
  let data;try{data=await res.json();}catch{throw new Error("El servicio devolvió una respuesta no válida.");}
  if(!res.ok||data.error){const status=data.status||res.status;if(status===401&&action!=="login"){token="";localStorage.removeItem(storeKey);state=null;renderLogin();}throw new Error(data.error||data.message||"No se pudo completar la operación.");}
  return data;
}
async function sync(render=true){if(!token)return;try{const next=await api("/api/state");const changed=!state||state.revision!==next.revision||state.me.slug!==next.me.slug||offline;state=next;lastSync=new Date();offline=false;if(render&&changed)renderApp();}catch(error){offline=true;if(state&&render)renderApp();else if(!state){renderLogin();toast(error.message,true);}}}
async function mutate(job,success){if(busy)return;busy=true;document.querySelectorAll("button[data-mutation]").forEach(b=>b.disabled=true);try{await job();await sync();if(success)toast(success);}catch(error){toast(error.message,true);await sync();}finally{busy=false;document.querySelectorAll("button[data-mutation]").forEach(b=>b.disabled=false);}}
function field(label,input,help=""){return h("div",{class:"form-field"},h("label",{class:"field-label",htmlFor:input.id},label),input,help?h("p",{class:"field-help"},help):null);}
function select(id,options,value){const el=h("select",{id,name:id});for(const o of options)el.append(h("option",{value:typeof o==="string"?o:o.value},typeof o==="string"?o:o.label));el.value=value;return el;}
function brandMark(decorative=false){return h("img",{class:"brand-mark",src:"assets/alpha-gym-logo.svg",width:48,height:48,alt:decorative?"":"Alpha Gym","aria-hidden":decorative?"true":null});}
function brand(){return h("div",{class:"brand"},brandMark(),h("div",{},h("p",{class:"brand-name"},"Alpha Dueños"),h("p",{class:"brand-sub"},"Mesa de socios · Alpha Gym")));}
function renderLogin(prefill=""){
  const error=h("p",{class:"form-error",role:"alert"});const input=h("input",{id:"access-key",name:"key",type:"password",required:true,minLength:6,maxLength:150,autocomplete:"current-password",placeholder:"Tu clave personal de socio",value:prefill});
  const submit=h("button",{class:"button primary",type:"submit"},"Entrar a la mesa");
  const form=h("form",{class:"login-form",onSubmit:async e=>{e.preventDefault();if(!form.reportValidity())return;submit.disabled=true;error.textContent="";try{const result=await api("/api/login",{key:input.value.trim()});token=result.token;localStorage.setItem(storeKey,token);await sync();}catch(exc){error.textContent=exc.message;submit.disabled=false;}}},h("label",{class:"field-label",htmlFor:"access-key"},"Clave de acceso"),input,error,submit);
  app.replaceChildren(h("main",{id:"main",class:"login-page"},h("section",{class:"login-story"},brand(),h("div",{},h("p",{class:"eyebrow"},"Tres socios. Un mismo acuerdo."),h("h1",{},"El trabajo claro.",h("br"),h("span",{},"Los acuerdos, por escrito.")),h("p",{},"Propongan mejoras para el gimnasio, acuerden responsabilidades y resuelvan las decisiones entre los tres."),h("div",{class:"login-steps"},["01 · Proponer","02 · Votar","03 · Firmar"].map(x=>h("span",{class:"login-step"},x)))),h("p",{class:"login-note"},"Tres votos a favor aprueban. Dos a favor y uno en contra abren una discusión.")),h("section",{class:"login-access"},h("div",{class:"login-box"},h("p",{class:"eyebrow"},"Acceso de socios"),h("h2",{},"Tu lugar en la mesa"),h("p",{},"Cada socio entra con su propia clave. Las propuestas y votos se comparten entre los tres."),form,h("p",{class:"login-help"},"Solicita a Josue tu enlace o clave personal. Consérvala para volver a entrar desde otro dispositivo.")))));
  if(prefill)form.requestSubmit();
}
function renderApp(){
  if(!state)return;
  const pending=state.motions.filter(m=>m.status==="pending"&&m.kind!=="improvement"),active=state.responsibilities.filter(r=>r.status==="active");
  const title={proposals:"Ideas para mejorar Alpha Gym.",discussion:"Las diferencias se hablan.",approved:"Lo que ya acordamos.",rejected:"Las decisiones también se conservan.",functions:"Un reparto que todos podemos ver.",votes:"Las decisiones se toman entre tres.",agreements:"Del acuerdo a las firmas.",history:"Cada cambio deja un registro.",metrics:"Las metas también se ven.",penalties:"Los compromisos tienen seguimiento.",access:"Los tres administran la mesa.",trash:"Lo eliminado se puede recuperar."}[tab];
  const subtitle={proposals:"Propongan mejoras de equipo, instalaciones, servicios o experiencia de los clientes.",discussion:"Dos votos a favor y uno en contra abren una discusión. Comenten y acuerden el resultado final por dos votos.",approved:"Propuestas aprobadas por los tres o por dos socios después de la discusión, con sus votos y comentarios.",rejected:"Las propuestas negadas conservan su contenido, sus votos y el motivo de la decisión.",functions:"Cada responsabilidad tiene un titular, una frecuencia y un resultado esperado.",votes:"Tres a favor aprueban. Dos a favor y uno en contra abren discusión. Dos en contra niegan la propuesta.",agreements:"Generen una versión fija, imprímanla y firmen los tres. Las versiones anteriores se conservan.",history:"Propuestas, votos, cambios y retiros, con nombre y fecha.",metrics:"Comparen cada resultado con su meta y conserven la evidencia por periodo.",penalties:"Revisen las penalizaciones acordadas y documenten los incumplimientos y su resolución.",access:"Cada socio tiene su propia clave y los mismos permisos de administrador.",trash:"Restauren funciones, registros de incumplimiento y acuerdos. Los votos y versiones originales se conservan."}[tab];
  const nav=h("nav",{class:"nav","aria-label":"Secciones"},[["proposals","Nuevas propuestas",state.motions.filter(m=>m.kind==="improvement"&&m.status==="pending").length],["discussion","En discusión",state.motions.filter(m=>m.status==="discussion").length],["approved","Aprobadas",state.motions.filter(m=>m.status==="approved").length],["rejected","Negadas",state.motions.filter(m=>m.status==="rejected").length],["functions","Funciones",active.length],["votes","Votaciones de funciones",pending.length],["metrics","Métricas",null],["penalties","Penalizaciones",(state.incidents||[]).filter(i=>i.status==="open").length],["agreements","Acuerdos",state.agreements.length],["trash","Papelera",(state.trash||[]).length],["history","Historial",null],["access","Accesos",null]].map(([id,label,count])=>h("button",{class:`tab ${tab===id?"active":""}`,type:"button","aria-current":tab===id?"page":null,onClick:()=>{tab=id;renderApp();}},label,count!==null?h("span",{class:"count"},count):null)));
  const main=h("main",{id:"main"},offline?h("div",{class:"sync-banner",role:"alert"},"Sin conexión con el servidor. Estos son los últimos datos recibidos. Reconecta antes de votar o proponer."):null,tab==="proposals"?proposalsView():["discussion","approved","rejected"].includes(tab)?decisionsView(tab):tab==="functions"?functionsView():tab==="votes"?votesView():tab==="agreements"?agreementsView():tab==="metrics"?metricsView():tab==="penalties"?penaltiesView():tab==="access"?accessView():tab==="trash"?trashView():historyView());
  app.replaceChildren(h("div",{class:"shell"},h("header",{class:"topbar"},brand(),h("div",{class:"account"},h("span",{class:"avatar","aria-hidden":"true"},shortName(state.me.slug)[0]),h("span",{class:"account-name"},state.me.name),badge("Admin","brand"),button("Salir",()=>mutate(async()=>{await api("/api/logout",{});token="";state=null;localStorage.removeItem(storeKey);renderLogin();}),"ghost small","logout"))),h("section",{class:"hero"},h("div",{},h("p",{class:"eyebrow"},"Mesa de socios"),h("h1",{},title),h("p",{},subtitle)),h("div",{class:"hero-aside"},h("span",{class:"rule"},"3 a favor · 2/1 a discusión"),button("Nueva propuesta",()=>improvementForm(),"primary","plus",{"data-mutation":"true",disabled:offline||busy}))),nav,main,h("footer",{class:"footer"},h("span",{},"Alpha Dueños · Acuerdos compartidos, responsabilidades claras."),button("Descargar respaldo",()=>mutate(downloadBackup),"ghost small","download"))));
}
function empty(title,text,action,label="Proponer una responsabilidad"){return h("section",{class:"empty"},brandMark(true),h("h2",{},title),h("p",{},text),action?button(label,action,"primary","plus"):null);}
function functionsView(){
  const owner=select("filter-owner",[{value:"all",label:"Todos los socios"},...state.partners.map(p=>({value:p.slug,label:p.name}))],filterOwner);owner.setAttribute("aria-label","Filtrar por socio");owner.addEventListener("change",()=>{filterOwner=owner.value;renderApp();});
  const scope=select("filter-scope",["Todos los tipos","Como socio","Trabajo remunerado","Apoyo puntual"],filterScope==="all"?"Todos los tipos":filterScope);scope.setAttribute("aria-label","Filtrar por tipo de función");scope.addEventListener("change",()=>{filterScope=scope.value==="Todos los tipos"?"all":scope.value;renderApp();});
  const box=h("section",{},h("div",{class:"section-header"},h("div",{},h("h2",{},"Funciones de los socios"),h("p",{},"Acuerden quién hace cada tarea y cómo se dará seguimiento.")),button("Proponer función",()=>responsibilityForm(),"","plus",{"data-mutation":"true",disabled:busy||offline})),h("div",{class:"toolbar"},h("div",{class:"filters"},owner,scope),h("div",{class:"sync"},h("span",{class:`dot ${offline?"offline":""}`}),offline?"Sin conexión":lastSync?`Actualizado ${lastSync.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})}`:"Conectando",button("Actualizar",()=>sync(),"ghost small"))));
  const visible=state.responsibilities.filter(r=>["active","proposed"].includes(r.status));
  if(!visible.length)box.append(empty("Construyamos el primer acuerdo","Empiecen por una función concreta: quién la realiza, cuándo y qué debe entregar. Ninguna propuesta se aprueba automáticamente.",()=>responsibilityForm()));
  else{
    if(visible.some(r=>r.status==="proposed"))box.append(h("p",{class:"notice"},"Las tarjetas marcadas «Por votar» son propuestas. Se activan con tres votos a favor o con el resultado aprobado de una discusión. Revisen alcance, meta y consecuencia antes de aprobar."));
    box.append(h("div",{class:"partners-grid"},state.partners.filter(p=>filterOwner==="all"||p.slug===filterOwner).map(p=>{
      const items=visible.filter(r=>r.owner===p.slug&&(filterScope==="all"||r.scope===filterScope)),approved=items.filter(r=>r.status==="active").length;
      return h("section",{class:"partner-column","aria-label":`Responsabilidades de ${p.name}`},h("div",{class:"partner-heading"},h("span",{class:"avatar","aria-hidden":"true"},p.name[0]),h("div",{},h("h2",{},p.name),h("p",{},`${approved} ${approved===1?"aprobada":"aprobadas"} · ${items.length-approved} por votar`))),h("div",{class:"task-list"},items.length?items.map(r=>r.status==="active"?taskCard(r):proposalCard(r)):h("p",{class:"empty-column"},"Sin funciones de este tipo para este socio.")));
    })));
  }
  const retired=state.responsibilities.filter(r=>r.status==="retired");
  if(retired.length)box.append(h("details",{class:"archived"},h("summary",{},`Responsabilidades retiradas (${retired.length})`),retired.map(r=>h("div",{class:"archived-row"},h("div",{},h("strong",{},r.title),h("p",{},name(r.owner))),badge("Retirada por votación"),trashButton("responsibility",r)))));
  const discarded=state.responsibilities.filter(r=>["cancelled","rejected"].includes(r.status));
  if(discarded.length)box.append(h("details",{class:"archived"},h("summary",{},`Propuestas canceladas o negadas (${discarded.length})`),discarded.map(r=>h("div",{class:"archived-row"},h("div",{},h("strong",{},r.title),h("p",{},name(r.owner))),badge(r.status==="cancelled"?"Cancelada":"Negada"),button("Volver a proponer",()=>responsibilityForm(null,{...r,id:undefined,status:undefined}),"ghost small"),trashButton("responsibility",r)))));
  return box;
}
function proposalCard(r){
  const motion=state.motions.find(m=>m.responsibility_id===r.id&&["pending","discussion"].includes(m.status)),yes=Object.values(motion?.votes||{}).filter(v=>v==="approve").length;
  return h("article",{class:"task proposed-task"},h("div",{class:"task-meta"},badge(motion?.status==="discussion"?"En discusión":"Por votar","amber"),badge(r.category),badge(r.scope)),h("h3",{},r.title),h("div",{class:"deliverable"},h("strong",{},"Entregable propuesto"),r.deliverable),h("p",{class:"task-frequency"},r.frequency),h("details",{class:"proposal-details"},h("summary",{},"Ver alcance, métrica y penalización"),h("p",{class:"description"},r.description),responsibilityTerms(r)),h("div",{class:"task-actions"},motion?button(`Revisar · ${yes}/3 a favor`,()=>{tab=motion.status==="discussion"?"discussion":"votes";voteOwner=r.owner;renderApp();document.getElementById(`motion-${motion.id}`)?.scrollIntoView({block:"start"});},"small"):null,motion?.status!=="discussion"?trashButton("responsibility",r):null));
}
function taskCard(r){const pending=state.motions.find(m=>m.responsibility_id===r.id&&["pending","discussion"].includes(m.status));return h("article",{class:"task"},h("div",{class:"task-meta"},badge(r.category),badge(r.scope)),h("h3",{},r.title),r.description?h("p",{class:"description"},r.description):null,h("div",{class:"deliverable"},h("strong",{},"Entregable"),r.deliverable),h("p",{class:"task-frequency"},"Frecuencia: ",r.frequency),responsibilityTerms(r),pending?h("div",{class:"inline-notice"},`${pending.kind==="retire"?"Retiro":"Cambio"} en votación. La función actual sigue vigente.`,button("Ver propuesta",()=>{tab=pending.status==="discussion"?"discussion":"votes";renderApp();},"ghost small")):h("div",{class:"task-actions"},button("Proponer cambio",()=>responsibilityForm(r),"ghost small","",{"data-mutation":"true",disabled:busy||offline}),button("Eliminar función",()=>retireForm(r),"ghost small danger","",{"data-mutation":"true",disabled:busy||offline})));}
function proposalsView(){
  const motions=state.motions.filter(m=>m.kind==="improvement"&&m.status==="pending");
  return h("section",{},h("p",{class:"notice"},"Este espacio es para mejorar el gimnasio: equipo, instalaciones, servicios y experiencia de los clientes. Las responsabilidades de cada socio se proponen en Funciones."),motions.length?h("div",{class:"motion-list"},motions.map(motionCard)):empty("La próxima mejora empieza aquí","Compartan qué quieren mejorar, el beneficio y el costo estimado, si lo conocen.",()=>improvementForm(),"Nueva propuesta"));
}
function decisionsView(status){
  const motions=state.motions.filter(m=>m.status===status);
  const texts={discussion:["No hay propuestas en discusión","Aquí llegarán las propuestas con dos votos a favor y uno en contra."],approved:["Todavía no hay propuestas aprobadas","Aquí se conservan las propuestas aprobadas y sus votos."],rejected:["No hay propuestas negadas","Las propuestas con dos votos en contra se conservan aquí."]};
  return h("section",{},motions.length?h("div",{class:"motion-list"},motions.map(motionCard)):empty(...texts[status]));
}
function votesView(){
  const pending=state.motions.filter(m=>m.status==="pending"&&m.kind!=="improvement");
  const ownerOf=m=>m.payload.owner||state.responsibilities.find(r=>r.id===m.responsibility_id)?.owner;
  const owner=select("vote-owner",[{value:"all",label:"Todos los socios"},...state.partners.map(p=>({value:p.slug,label:p.name}))],voteOwner);
  owner.setAttribute("aria-label","Filtrar propuestas por responsable");owner.addEventListener("change",()=>{voteOwner=owner.value;renderApp();});
  const shown=pending.filter(m=>voteOwner==="all"||ownerOf(m)===voteOwner);
  const box=h("section",{},trackingSummary(state.partners.map(p=>[`${p.name} · propuestas`,pending.filter(m=>ownerOf(m)===p.slug).length])),h("div",{class:"toolbar"},h("div",{class:"filters"},owner),h("p",{class:"small muted"},`${shown.length} propuestas por revisar`)),shown.length?h("div",{class:"motion-list"},shown.map(motionCard)):empty("Sin votaciones de funciones pendientes","Pueden proponer una función nueva o revisar En discusión, Aprobadas y Negadas.",()=>responsibilityForm()));
  const cancelled=state.motions.filter(m=>m.status==="cancelled");
  if(cancelled.length)box.append(h("details",{class:"archived"},h("summary",{},`Propuestas canceladas (${cancelled.length})`),cancelled.map(m=>h("div",{class:"archived-row"},h("strong",{},m.title),badge("Cancelada")))));
  return box;
}
function voteGrid(votes,label){return h("div",{class:"vote-grid","aria-label":label},state.partners.map(p=>{const vote=votes[p.slug];return h("div",{class:`voter ${vote==="approve"?"yes":vote==="reject"?"no":""}`},h("strong",{},shortName(p.slug)),h("span",{},vote==="approve"?"A favor":vote==="reject"?"En contra":"Sin votar"));}));}
function motionCard(m){
  const current=state.responsibilities.find(r=>r.id===m.responsibility_id),value=m.payload,owner=value.owner||current?.owner;
  const card=h("article",{class:`motion ${m.status==="discussion"?"discussion-card":""}`,id:`motion-${m.id}`},h("div",{class:"task-meta"},badge(kinds[m.kind]),badge(statuses[m.status],m.status==="approved"?"green":m.status==="rejected"?"red":"amber")),h("h3",{},m.title),h("p",{class:"motion-label"},`Propuesta de ${name(m.proposer)} · ${date(m.created_at)}`));
  if(m.kind==="improvement")card.append(h("p",{class:"motion-body"},value.description),h("div",{class:"deliverable"},h("strong",{},"Beneficio esperado"),value.benefit),value.budget?h("p",{class:"motion-body"},h("strong",{},"Costo estimado: "),value.budget):h("p",{class:"motion-label"},"Costo por definir"));
  if(m.kind==="create"||(m.kind==="edit"&&!["pending","discussion"].includes(m.status)))card.append(...[h("div",{class:"task-meta"},badge(name(owner)),badge(value.category),badge(value.scope)),value.description?h("p",{class:"motion-body"},value.description):null,h("div",{class:"deliverable"},h("strong",{},"Entregable"),value.deliverable),h("p",{class:"task-frequency"},"Frecuencia: ",value.frequency),responsibilityTerms(value)].filter(Boolean));
  if(m.kind==="retire")card.append(h("p",{class:"motion-body"},`Retiro de la función de ${name(owner)}. La función sigue vigente mientras la decisión esté abierta.`));
  if(m.reason)card.append(h("p",{class:"motion-body"},m.reason));
  if(m.kind==="edit"&&["pending","discussion"].includes(m.status)){
    const labels={title:"Título",description:"Descripción",owner:"Responsable",category:"Área",frequency:"Frecuencia",deliverable:"Entregable",scope:"Tipo de función",penalty:"Penalización",metric:"Métrica y meta"};
    const display=(key,v)=>key==="owner"?name(v):key==="metric"?metricLabel(v):v||"Sin definir";
    card.append(h("div",{class:"changes"},Object.entries(labels).filter(([key])=>JSON.stringify(value[key]??null)!==JSON.stringify(current?.[key]??null)).map(([key,label])=>h("div",{class:"change"},h("strong",{},label),h("del",{},display(key,current?.[key])),h("ins",{},display(key,value[key]))))));
  }
  card.append(h("p",{class:"motion-label"},"Votos iniciales"),voteGrid(m.votes,"Votos iniciales de los socios"));
  if(m.status==="pending"){
    card.append(h("div",{class:"motion-actions"},button(m.votes[state.me.slug]==="approve"?"Tu voto: a favor":"A favor",()=>castVote(m,"approve"),m.votes[state.me.slug]==="approve"?"primary":"","check",{"data-mutation":"true",disabled:busy||offline}),button(m.votes[state.me.slug]==="reject"?"Tu voto: en contra":"En contra",()=>castVote(m,"reject"),"danger","close",{"data-mutation":"true",disabled:busy||offline})),h("p",{class:"motion-foot"},"3 a favor: aprobada. 2 a favor y 1 en contra: discusión. 2 en contra: negada."));
    card.append(button("Cancelar propuesta",()=>confirmDialog("Cancelar propuesta",`Se cerrará la votación de «${m.title}». Quedará en el historial.`,"Cancelar propuesta",()=>mutate(()=>api(`/api/motions/${m.id}/cancel`,{}),"Propuesta cancelada.")),"ghost small danger","",{"data-mutation":"true",disabled:busy||offline}));
  }
  if(m.status==="discussion"||Object.keys(m.resolution_votes||{}).length){
    card.append(h("div",{class:"discussion-section"},h("h4",{},"Discusión y resultado final"),h("p",{class:"motion-foot"},"Los votos iniciales se conservan. Dos votos finales a favor aprueban; dos en contra niegan."),voteGrid(m.resolution_votes||{},"Votos finales tras la discusión"),(m.comments||[]).length?h("ol",{class:"discussion-comments"},m.comments.map(c=>h("li",{},h("strong",{},name(c.partner)),h("time",{dateTime:c.created_at},date(c.created_at)),h("p",{},c.body)))):h("p",{class:"motion-label"},"Aún no hay comentarios. Expliquen sus puntos y registren su decisión final.")));
  }
  if(m.status==="discussion"){
    card.append(h("div",{class:"motion-actions"},button("Comentar",()=>discussionForm(m),"","",{"data-mutation":"true",disabled:busy||offline}),button("Aprobar tras discusión",()=>discussionForm(m,"approve"),"primary","check",{"data-mutation":"true",disabled:busy||offline}),button("Negar tras discusión",()=>discussionForm(m,"reject"),"danger","close",{"data-mutation":"true",disabled:busy||offline})));
  }
  if(m.decided_at)card.append(h("p",{class:"motion-foot"},`Decisión registrada ${date(m.decided_at)}`));
  return card;
}
function castVote(m,value){if(m.votes[state.me.slug]===value)return;mutate(async()=>{const result=await api(`/api/motions/${m.id}/vote`,{value});if(result.status!=="pending")tab=result.status;},"Voto registrado.");}
function improvementForm(){
  const title=h("input",{id:"improvement-title",name:"title",required:true,maxLength:120,placeholder:"Por ejemplo: renovar las bicicletas de cardio"});
  const description=h("textarea",{id:"improvement-description",name:"description",required:true,maxLength:2000,rows:4,placeholder:"Qué propones mejorar y cómo se podría hacer."});
  const benefit=h("textarea",{id:"improvement-benefit",name:"benefit",required:true,maxLength:1200,rows:3,placeholder:"Qué ganan el gimnasio y sus clientes con esta mejora."});
  const budget=h("input",{id:"improvement-budget",name:"budget",maxLength:300,placeholder:"Por ejemplo: $15,000 MXN o pendiente de cotización"});
  const form=h("form",{onSubmit:e=>{e.preventDefault();if(!form.reportValidity())return;const payload=Object.fromEntries(new FormData(form));mutate(async()=>{await api("/api/improvements",payload);modal.close();tab="proposals";},"Mejora propuesta. Los tres pueden votar.");}},h("p",{class:"notice"},"Propón una mejora para Alpha Gym. Crear la propuesta no cuenta como votar."),field("Título de la propuesta",title),field("¿Qué quieres mejorar?",description),field("Beneficio esperado",benefit),field("Costo estimado (opcional)",budget),h("div",{class:"modal-actions"},button("Volver",()=>modal.close(),"ghost"),h("button",{class:"button primary",type:"submit","data-mutation":"true"},"Proponer mejora")));
  showModal("Nueva propuesta para el gimnasio",form);
}
function discussionForm(m,value=null){
  const reason=h("textarea",{id:"discussion-reason",required:true,maxLength:2000,rows:4,placeholder:value?"Explica el acuerdo alcanzado y el motivo de tu voto final.":"Explica tu punto de vista o plantea un ajuste para resolver la diferencia."});
  const label=value==="approve"?"Registrar voto final a favor":value==="reject"?"Registrar voto final en contra":"Publicar comentario";
  const form=h("form",{onSubmit:e=>{e.preventDefault();if(!form.reportValidity())return;mutate(async()=>{const result=await api(`/api/motions/${m.id}/${value?"resolve_discussion":"comment"}`,{reason:reason.value.trim(),...(value?{value}:{})});modal.close();if(result.status&&result.status!=="discussion")tab=result.status;},value?"Voto final registrado.":"Comentario guardado.");}},h("p",{class:"notice"},`«${m.title}». La discusión termina cuando dos socios coinciden en aprobar o negar. Cada socio tiene un voto final y puede cambiarlo mientras siga abierta.`),field(value?"Motivo del voto final":"Comentario",reason),h("div",{class:"modal-actions"},button("Volver",()=>modal.close(),"ghost"),h("button",{class:"button primary",type:"submit","data-mutation":"true"},label)));
  showModal(value?"Votar resultado de la discusión":"Comentar propuesta",form);
}
function agreementsView(){const pending=state.motions.filter(m=>m.kind!=="improvement"&&["pending","discussion"].includes(m.status)).length,active=state.responsibilities.filter(r=>r.status==="active").length;const box=h("section",{},h("div",{class:"section-header"},h("div",{},h("h2",{},"El documento que firmarán los tres"),h("p",{},"Cada PDF conserva las funciones aprobadas y el registro de votos de esa versión.")),button("Generar PDF para firmas",()=>confirmDialog("Generar acuerdo para firma","Se guardará una versión fija de las responsabilidades aprobadas. El PDF tendrá espacios para nombre, firma, fecha y lugar de los tres socios.","Generar y descargar",()=>mutate(async()=>{const a=await api("/api/agreements",{});await downloadPdf(a.id,a.version);},"Acuerdo preparado para imprimir y firmar.")),"primary","download",{"data-mutation":"true",disabled:busy||offline||pending>0||!active})),h("p",{class:`notice ${pending?"warning":""}`},pending?`Hay ${pending} ${pending===1?"votación abierta":"votaciones abiertas"}. Resuélvanlas o cancelen las propuestas antes de generar el acuerdo final.`:"Los votos aprueban las funciones por mayoría. El documento final queda pendiente de la firma manuscrita de los tres socios; generar el PDF no lo marca como firmado."));
  if(state.agreements.length)box.append(h("div",{class:"agreement-list"},state.agreements.map(a=>h("article",{class:"agreement"},h("div",{},badge("Para imprimir y firmar"),h("h3",{},`Acuerdo · Versión ${a.version}`),h("p",{},`${a.count} ${a.count===1?"responsabilidad":"responsabilidades"} · ${date(a.created_at)}`),h("div",{class:"digest"},`Identificador: ${a.digest.slice(0,16)}`)),h("div",{class:"task-actions"},button("Descargar PDF",()=>mutate(()=>downloadPdf(a.id,a.version)),"","download",{"data-mutation":"true",disabled:busy||offline}),trashButton("agreement",{id:a.id,title:`Acuerdo v${a.version}`}))))));else box.append(empty("El primer acuerdo está por escribirse",active?"Cuando no queden votaciones abiertas, podrán generar el primer PDF para firmas.":"Aprueben sus primeras responsabilidades para preparar el documento final."));return box;}
function trashButton(type,item){return button("Eliminar",()=>confirmDialog("Enviar a papelera",`«${item.title}» se ocultará y podrás restaurarlo desde Papelera. ${type==="responsibility"?"Si es una propuesta abierta, se cancelará su votación. ":type==="agreement"?"Su versión original se conserva; esto no invalida un documento ya firmado. ":"Se conservará la evidencia y su resolución. "}`,"Enviar a papelera",()=>mutate(()=>api("/api/trash",{type,id:item.id}),"Enviado a papelera. Puedes restaurarlo.")),"ghost small danger","",{"data-mutation":"true",disabled:busy||offline});}
function trashView(){
  const items=state.trash||[],labels={responsibility:"Función / responsabilidad",incident:"Registro de incumplimiento",agreement:"Acuerdo"};
  return h("section",{},h("p",{class:"notice"},"Restaurar una función conserva su estado: no la reactiva ni reabre su votación. Los acuerdos recuperan su misma versión. Para retirar una función vigente o quitar su penalización se debe aprobar la propuesta."),items.length?h("div",{class:"agreement-list"},items.map(i=>h("article",{class:"agreement"},h("div",{},badge(labels[i.type]),h("h3",{},i.title),h("p",{},`Eliminado ${date(i.deleted_at)}`)),button("Restaurar",()=>mutate(()=>api("/api/restore",{type:i.type,id:i.id}),"Elemento restaurado."),"","",{"data-mutation":"true",disabled:busy||offline})))):empty("La papelera está vacía","Aquí aparecerán los elementos eliminados para recuperarlos cuando lo necesiten."));
}
function historyView(){
  if(!state.events.length)return empty("Todo empieza con una propuesta","Aquí aparecerán las acciones de los tres socios, con nombre y fecha.",()=>responsibilityForm());
  return h("section",{},h("ol",{class:"activity"},state.events.map(e=>h("li",{},
    h("time",{dateTime:e.created_at},date(e.created_at)),
    h("div",{},h("strong",{},`${e.actor} · ${e.action}`),h("p",{},e.detail))
  ))));
}
function showModal(title,body){modal.replaceChildren(h("div",{class:"modal-head"},h("h2",{id:"modal-title"},title),button("Cerrar",()=>modal.close(),"ghost small","close")),h("div",{class:"modal-body"},body));modal.showModal();}
function responsibilityForm(current=null,overrides={}){
  const data={...(current||{title:"",description:"",owner:state.me.slug,category:"General",frequency:"Mensual",deliverable:"",scope:"Como socio",penalty:"",metric:null}),...overrides};const error=h("p",{class:"form-error",role:"alert"});
  const title=h("input",{id:"title",name:"title",value:data.title,maxLength:120,required:true,placeholder:"Por ejemplo: preparar el corte mensual"});
  const owner=select("owner",state.partners.map(p=>({value:p.slug,label:p.name})),data.owner),category=select("category",["Finanzas","Fiscal","Operación","Trámites","Marketing","Sistemas","General"],data.category),scope=select("scope",["Como socio","Trabajo remunerado","Apoyo puntual"],data.scope);
  const frequency=h("input",{id:"frequency",name:"frequency",value:data.frequency,maxLength:80,required:true,placeholder:"Cada viernes, mensual, por evento…"});
  const description=h("textarea",{id:"description",name:"description",value:data.description,rows:3,maxLength:2000,placeholder:"Qué incluye esta función y hasta dónde llega."});
  const deliverable=h("textarea",{id:"deliverable",name:"deliverable",value:data.deliverable,rows:2,maxLength:1200,required:true,placeholder:"Qué resultado o comprobante debe recibir el resto."});
  const terms=termsForm(data);
  const reason=h("textarea",{id:"reason",name:"reason",value:overrides.reason||"",rows:2,maxLength:1000,required:!!current,placeholder:"Explica por qué propones este cambio."});
  const form=h("form",{onSubmit:e=>{e.preventDefault();if(!form.reportValidity())return;const payload=Object.fromEntries(new FormData(form));payload.metric=terms.read();if(payload.metric===false)return;if(current&&["title","owner","category","scope","frequency","description","deliverable","penalty"].every(k=>payload[k].trim()===(current[k]||""))&&sameMetric(payload.metric,current.metric)){error.textContent="La propuesta debe incluir al menos un cambio.";return;}const body=current?{kind:"edit",payload,reason:payload.reason}:payload;mutate(async()=>{await api(current?`/api/responsibilities/${current.id}/motions`:"/api/responsibilities",body);modal.close();tab="votes";},"Propuesta abierta. Ahora pueden votar los tres.");}},h("p",{class:"notice"},current?"La función actual se conserva hasta que se apruebe el cambio.":"Esta función se activará cuando los tres voten a favor o dos la aprueben después de una discusión. Proponerla no emite un voto automático."),field("Título",title),h("div",{class:"form-grid"},field("Socio responsable",owner),field("Área",category)),h("div",{class:"form-grid"},field("Tipo de función",scope),field("Frecuencia",frequency)),field("Descripción y alcance",description),field("Entregable",deliverable),terms.element,current?field("Motivo del cambio",reason):null,error,h("div",{class:"modal-actions"},button("Volver",()=>modal.close(),"ghost"),h("button",{class:"button primary",type:"submit","data-mutation":"true"},current?"Abrir votación de cambio":"Proponer y abrir votación")));
  showModal(current?"Proponer un cambio":"Nueva responsabilidad",form);
}
function retireForm(r){const reason=h("textarea",{id:"retire-reason",rows:3,maxLength:1000,required:true,placeholder:"Explica por qué debería retirarse esta responsabilidad."});const form=h("form",{onSubmit:e=>{e.preventDefault();if(!form.reportValidity())return;mutate(async()=>{await api(`/api/responsibilities/${r.id}/motions`,{kind:"retire",reason:reason.value.trim()});modal.close();tab="votes";},"Retiro propuesto. La función sigue vigente hasta que se apruebe.");}},h("p",{class:"notice warning"},`«${r.title}» seguirá vigente hasta que se apruebe su retiro. El acuerdo y los votos anteriores se conservarán.`),field("Motivo del retiro",reason),h("div",{class:"modal-actions"},button("Volver",()=>modal.close(),"ghost"),h("button",{class:"button primary",type:"submit","data-mutation":"true"},"Proponer retiro")));showModal("Eliminar función vigente: proponer retiro",form);}
function confirmDialog(title,text,label,action){showModal(title,h("div",{},h("p",{class:"muted small"},text),h("div",{class:"modal-actions"},button("Volver",()=>modal.close(),"ghost"),button(label,()=>{modal.close();action();},"primary"))));}
function saveBlob(blob,filename){const a=h("a",{href:URL.createObjectURL(blob),download:filename});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),30000);}
async function downloadPdf(id,version){const agreement=await api(`/api/agreements/${id}/pdf`);const blob=await window.buildAlphaPdf(agreement);saveBlob(blob,`Alpha-Duenos-Acuerdo-v${version}.pdf`);}
async function downloadBackup(){const data=await api("/api/backup");saveBlob(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),`Alpha-Duenos-Respaldo-${new Date().toISOString().slice(0,10)}.json`);}
modal.addEventListener("click",e=>{if(e.target===modal){const rect=modal.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)modal.close();}});
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&token&&!busy)sync();});
setInterval(()=>{if(token&&!document.hidden&&!busy&&!modal.open)sync();},10000);
window.addEventListener("online",()=>{if(token)sync();});
const hash=new URLSearchParams(location.hash.slice(1)),invite=hash.get("clave");
if(invite){history.replaceState(null,"",location.pathname+location.search);token="";localStorage.removeItem(storeKey);renderLogin(invite);}else if(token){sync();}else renderLogin();
