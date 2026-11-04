"use strict";
const numberFormat=new Intl.NumberFormat("es-MX",{maximumFractionDigits:4});
function sameMetric(a,b){return (!a&&!b)||!!(a&&b&&["name","target","unit","direction"].every(k=>a[k]===b[k]));}
function metricLabel(m){return m?`${m.name} · ${m.direction==="lte"?"Máximo":"Mínimo"} ${numberFormat.format(m.target)} ${m.unit}`:"Sin métrica definida";}
function responsibilityTerms(r){return h("div",{class:"terms"},h("div",{},h("strong",{},"Métrica y meta"),h("p",{},metricLabel(r.metric))),h("div",{},h("strong",{},"Penalización por incumplimiento"),h("p",{},r.penalty||"Sin definir")));}
function termsForm(data){
  const penalty=h("textarea",{id:"penalty",name:"penalty",rows:3,maxLength:1200,value:data.penalty||"",placeholder:"Qué ocurre, en qué casos y en qué plazo. Ej.: reponer la tarea en 48 h y cubrir el costo acordado."});
  const enabled=h("input",{id:"metric-enabled",type:"checkbox",checked:!!data.metric});
  const metricName=h("input",{id:"metric-name",maxLength:120,value:data.metric?.name||"",placeholder:"Ej.: cortes entregados a tiempo"});
  const target=h("input",{id:"metric-target",type:"number",min:0,max:1e12,step:"any",value:data.metric?.target??"",placeholder:"Ej.: 100"});
  const unit=h("input",{id:"metric-unit",maxLength:30,value:data.metric?.unit||"",placeholder:"%, reportes, días…"});
  const direction=select("metric-direction",[{value:"gte",label:"Mínimo: alcanzar o superar"},{value:"lte",label:"Máximo: no superar"}],data.metric?.direction||"gte");
  const controls=h("div",{},field("Indicador",metricName),h("div",{class:"form-grid"},field("Meta numérica",target),field("Unidad",unit)),field("Criterio de cumplimiento",direction,"La meta se revisa según la frecuencia de esta responsabilidad."));
  function toggle(){controls.hidden=!enabled.checked;for(const el of [metricName,target,unit,direction]){el.disabled=!enabled.checked;el.required=enabled.checked;}}
  enabled.addEventListener("change",toggle);toggle();
  return {element:h("section",{class:"terms-form"},h("h3",{},"Compromisos y seguimiento"),field("Penalización por incumplimiento",penalty,"Se vota junto con la función. Incluyan las condiciones y excepciones que acuerden."),h("label",{class:"check-label",htmlFor:"metric-enabled"},enabled,"Definir una métrica y su meta"),controls),read(){return enabled.checked?{name:metricName.value.trim(),target:Number(target.value),unit:unit.value.trim(),direction:direction.value}:null;}};
}
function metricMet(actual,m){return m.direction==="lte"?actual<=m.target:actual>=m.target;}
function metricResult(entry){const met=metricMet(entry.actual,entry.metric);return h("div",{class:"metric-result"},h("strong",{},`${numberFormat.format(entry.actual)} ${entry.metric.unit}`),badge(met?"Meta cumplida":"Fuera de meta",met?"green":"amber"),h("p",{class:"muted small"},`${metricLabel(entry.metric)} · ${entry.period}`));}
function trackingSummary(items){return h("div",{class:"stats-grid"},items.map(([label,value])=>h("div",{class:"stat"},h("strong",{},value),h("span",{},label))));}
function metricsView(){
  const active=state.responsibilities.filter(r=>r.status==="active"&&r.metric),entries=state.measurements||[];
  // Entries keep the original target and owner; do not compare past results against amended terms.
  const latest=active.map(r=>entries.find(e=>e.responsibility_id===r.id&&e.owner===r.owner&&sameMetric(e.metric,r.metric))).filter(Boolean);
  const box=h("section",{},trackingSummary([["Funciones con métrica",active.length],["Últimos resultados en meta",latest.length?`${latest.filter(e=>metricMet(e.actual,e.metric)).length} / ${latest.length}`:"Sin datos"],["Sin resultado con la meta vigente",active.length-latest.length]]));
  if(!active.length)box.append(empty("Definan cómo medir cada función","Al proponer o cambiar una función, activen su métrica, escriban la meta y apruébenla entre dos socios.",()=>responsibilityForm()));
  else box.append(h("div",{class:"tracking-grid"},active.map(r=>{const entry=latest.find(e=>e.responsibility_id===r.id);return h("article",{class:"tracking-card"},badge(name(r.owner)),h("h3",{},r.title),h("p",{class:"small muted"},`${metricLabel(r.metric)} · ${r.frequency}`),entry?metricResult(entry):h("p",{class:"no-result"},"Sin resultados con esta meta"),button("Registrar resultado",()=>measurementForm(r),"","plus",{"data-mutation":"true",disabled:busy||offline}));})));
  if(entries.length)box.append(h("details",{class:"archived"},h("summary",{},`Historial de resultados (${entries.length})`),h("p",{class:"small muted"},"Para corregir un dato, registra otro resultado para el mismo periodo; el original se conserva."),entries.map(e=>h("article",{class:"record"},h("h3",{},e.title),h("p",{class:"small muted"},`${name(e.owner)} · registrado por ${name(e.actor)} · ${date(e.created_at)}`),metricResult(e),e.note?h("p",{class:"record-detail"},e.note):null))));
  return box;
}
function measurementForm(r){
  const period=h("input",{id:"measure-period",required:true,maxLength:80,placeholder:"Ej.: noviembre 2026 o semana del 2 al 8"}),actual=h("input",{id:"measure-actual",type:"number",min:0,max:1e12,step:"any",required:true,placeholder:`Resultado en ${r.metric.unit}`}),note=h("textarea",{id:"measure-note",rows:3,maxLength:1200,placeholder:"Observaciones y referencia al comprobante o evidencia."});
  const form=h("form",{onSubmit:e=>{e.preventDefault();if(!form.reportValidity())return;mutate(async()=>{await api("/api/measure",{responsibility_id:r.id,period:period.value.trim(),actual:Number(actual.value),note:note.value.trim()});modal.close();},"Resultado registrado.");}},h("p",{class:"notice"},`${r.title} · ${metricLabel(r.metric)} · ${r.frequency}`),field("Periodo evaluado",period),field(`Resultado (${r.metric.unit})`,actual),field("Evidencia y observaciones",note),h("div",{class:"modal-actions"},button("Volver",()=>modal.close(),"ghost"),h("button",{type:"submit",class:"button primary","data-mutation":"true"},"Guardar resultado")));
  showModal("Registrar resultado",form);
}
function penaltiesView(){
  const active=state.responsibilities.filter(r=>r.status==="active"&&r.penalty),incidents=state.incidents||[];
  const box=h("section",{},trackingSummary([["Funciones con penalización",active.length],["Incumplimientos por revisar",incidents.filter(i=>i.status==="open").length],["Registros cerrados",incidents.filter(i=>i.status!=="open").length]]),h("p",{class:"notice"},"La penalización se acuerda con dos votos. Registrar un incumplimiento permite revisarlo y documentar su resolución; no genera cobros automáticos."));
  if(!active.length)box.append(empty("Acuerden qué pasa si no se cumple","Incluyan la penalización y sus condiciones al proponer una función o un cambio.",()=>responsibilityForm()));
  else box.append(h("div",{class:"tracking-grid"},active.map(r=>h("article",{class:"tracking-card"},badge(name(r.owner)),h("h3",{},r.title),h("p",{class:"record-detail"},r.penalty),button("Registrar incumplimiento",()=>incidentForm(r),"danger","plus",{"data-mutation":"true",disabled:busy||offline})))));
  if(incidents.length)box.append(h("h2",{class:"records-title"},"Seguimiento de incumplimientos"),...incidents.map(i=>h("article",{class:"record"},h("div",{class:"task-meta"},badge(i.status==="open"?"Por revisar":i.status==="resolved"?"Resuelto":"Descartado",i.status==="open"?"amber":"green"),badge(name(i.owner))),h("h3",{},i.title),h("p",{class:"small muted"},`${i.occurred_on.split("-").reverse().join("/")} · registrado por ${name(i.actor)}`),h("p",{class:"record-detail"},i.detail),h("div",{class:"deliverable"},h("strong",{},"Penalización vigente al registrar"),i.penalty),i.status==="open"?button("Registrar resolución",()=>resolutionForm(i),"","",{"data-mutation":"true",disabled:busy||offline}):h("div",{class:"resolution"},h("strong",{},"Resolución"),h("p",{},i.resolution),h("p",{class:"small muted"},`${name(i.resolved_by)} · ${date(i.resolved_at)}`)))));
  return box;
}
function incidentForm(r){
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const occurred=h("input",{id:"incident-date",type:"date",required:true,value:today,max:today}),detail=h("textarea",{id:"incident-detail",required:true,rows:4,maxLength:1200,placeholder:"Qué no se hizo, periodo afectado y evidencia para revisarlo."});
  const form=h("form",{onSubmit:e=>{e.preventDefault();if(!form.reportValidity())return;mutate(async()=>{await api("/api/incident",{responsibility_id:r.id,occurred_on:occurred.value,detail:detail.value.trim()});modal.close();},"Incumplimiento registrado para revisión.");}},h("p",{class:"notice warning"},`${r.title} · ${name(r.owner)}. Penalización acordada: ${r.penalty}`),field("Fecha del incumplimiento",occurred),field("Descripción y evidencia",detail),h("div",{class:"modal-actions"},button("Volver",()=>modal.close(),"ghost"),h("button",{type:"submit",class:"button primary","data-mutation":"true"},"Guardar registro")));
  showModal("Registrar incumplimiento",form);
}
function resolutionForm(i){
  const status=select("incident-status",[{value:"resolved",label:"Resuelto: se atendió el incumplimiento"},{value:"dismissed",label:"Descartado: no procede"}],"resolved"),resolution=h("textarea",{id:"incident-resolution",required:true,maxLength:1200,rows:4,placeholder:"Qué se acordó, cómo se atendió o por qué se descartó."});
  const form=h("form",{onSubmit:e=>{e.preventDefault();if(!form.reportValidity())return;mutate(async()=>{await api("/api/resolve_incident",{incident_id:i.id,status:status.value,resolution:resolution.value.trim()});modal.close();},"Resolución registrada.");}},h("p",{class:"notice"},`${i.title} · ${name(i.owner)}. El registro original se conservará en el historial.`),field("Resultado de la revisión",status),field("Resolución",resolution),h("div",{class:"modal-actions"},button("Volver",()=>modal.close(),"ghost"),h("button",{type:"submit",class:"button primary","data-mutation":"true"},"Guardar resolución")));
  showModal("Resolver incumplimiento",form);
}

function accessView(){return h("section",{},h("p",{class:"notice"},"Los tres pueden administrar funciones, cancelar propuestas abiertas, registrar resultados e incumplimientos y cambiar claves. Cada uno vota con su propia identidad; las decisiones siguen necesitando dos de tres votos."),h("div",{class:"partners-grid"},state.partners.map(p=>h("article",{class:"tracking-card"},badge("Administrador","brand"),h("h3",{},p.name),h("p",{class:"small muted"},"Acceso personal con los mismos permisos que los otros socios."),button("Cambiar clave",()=>changeKeyForm(p),"","",{"data-mutation":"true",disabled:busy||offline})))));}
function changeKeyForm(p){
  const key=h("input",{id:"new-key",type:"password",minLength:6,maxLength:150,required:true,autocomplete:"new-password",placeholder:"Al menos 6 caracteres"});
  const form=h("form",{onSubmit:e=>{e.preventDefault();if(!form.reportValidity())return;mutate(async()=>{await api("/api/change_key",{partner:p.slug,key:key.value.trim()});modal.close();},"Clave actualizada. La anterior dejó de funcionar.");}},h("p",{class:"notice warning"},`Cambiarás el acceso de ${p.name}. Su clave y enlace anteriores dejarán de funcionar y se cerrarán sus otras sesiones. Cada socio debe tener una clave distinta.`),field("Nueva clave",key),h("label",{class:"check-label"},h("input",{type:"checkbox",onChange:e=>{key.type=e.target.checked?"text":"password";}}),"Mostrar clave"),h("div",{class:"modal-actions"},button("Volver",()=>modal.close(),"ghost"),h("button",{type:"submit",class:"button primary","data-mutation":"true"},"Guardar nueva clave")));
  showModal(`Clave de ${p.name}`,form);
}
