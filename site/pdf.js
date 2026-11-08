"use strict";
let alphaFontPromise;
function alphaFonts(){
  if(!alphaFontPromise)alphaFontPromise=Promise.all(["Vera.ttf","VeraBd.ttf"].map(async name=>{
    const response=await fetch(new URL(`fonts/${name}`,document.baseURI));if(!response.ok)throw new Error("No se pudo cargar la tipografía del PDF.");
    const bytes=new Uint8Array(await response.arrayBuffer());let raw="";for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);
  })).catch(error=>{alphaFontPromise=null;throw error;});
  return alphaFontPromise;
}
window.buildAlphaPdf=async function(agreement){
  const fonts=await alphaFonts();const {jsPDF}=window.jspdf;
  const doc=new jsPDF({unit:"mm",format:"a4",compress:true});
  doc.addFileToVFS("Vera.ttf",fonts[0]);doc.addFont("Vera.ttf","Vera","normal");
  doc.addFileToVFS("VeraBd.ttf",fonts[1]);doc.addFont("VeraBd.ttf","Vera","bold");
  doc.setProperties({title:`Alpha Dueños - Acuerdo v${agreement.version}`,author:"Alpha Dueños",subject:"Acuerdo de responsabilidades para firma manuscrita"});
  const data=agreement.snapshot,names=Object.fromEntries(data.partners.map(p=>[p.slug,p.name]));
  const ink=[20,20,28],muted=[100,100,119],line=[222,222,235],accent=[63,47,230];let y=29;
  function ensure(mm){if(y+mm>270){doc.addPage();y=29;}}
  function measure(value,{size=9,bold=false,after=2,width=170,lineHeight}={}){
    doc.setFont("Vera",bold?"bold":"normal");doc.setFontSize(size);
    return doc.splitTextToSize(String(value),width).length*(lineHeight||size*.3528*1.48)+after;
  }
  function text(value,{size=9,bold=false,color=ink,after=2,width=170,lineHeight}={}){
    doc.setFont("Vera",bold?"bold":"normal");doc.setFontSize(size);doc.setTextColor(...color);
    const lines=doc.splitTextToSize(String(value),width);const lead=lineHeight||size*.3528*1.48;
    for(const part of lines){ensure(lead);doc.text(part,20,y);y+=lead;}y+=after;
  }
  function rule(){doc.setDrawColor(...line);doc.setLineWidth(.3);doc.line(20,y,190,y);y+=7;}
  text("ALPHA DUEÑOS",{size:8,color:accent,bold:true,after:4});
  text("Acuerdo de responsabilidades",{size:22,bold:true,after:4,lineHeight:10});
  const stamp=new Intl.DateTimeFormat("es-MX",{dateStyle:"long",timeStyle:"short",timeZone:"America/Mexico_City"}).format(new Date(agreement.created_at));
  text(`Versión ${agreement.version} · ${stamp}, Ciudad de México`,{size:8,color:muted,after:4});rule();
  text("Este documento reúne las responsabilidades operativas aprobadas por los socios. Las nuevas decisiones requieren tres votos a favor o dos votos finales a favor después de una discusión. Cada función indica su titular, frecuencia, entregable, métrica y penalización acordada, cuando corresponda.");
  text("Este ejemplar está pendiente de la firma manuscrita de los tres socios. Las firmas corresponden exclusivamente a esta versión y a las responsabilidades que contiene.");
  text(`Identificador de versión: ${agreement.digest.slice(0,16)}`,{size:8,color:muted,after:4});
  function taskParts(r,number){
    const votes=r.approval?.votes||{};const yes=Object.entries(votes).filter(([,v])=>v==="approve").map(([s])=>names[s]).join(", ");const no=Object.entries(votes).filter(([,v])=>v==="reject").map(([s])=>names[s]).join(", ");const pending=data.partners.filter(p=>!votes[p.slug]).map(p=>p.name).join(", ");
    let approval=`${r.approval?.discussion?.appeal_of?`Apelación resuelta: propuesta ${r.approval.discussion.status==="approved"?"aprobada":"negada; se conserva la función anterior"}. `:""}${Object.keys(r.approval?.discussion?.resolution_votes||{}).length?"Votación final tras discusión. ":""}A favor: ${yes}.`;if(no)approval+=` En contra: ${no}.`;if(pending)approval+=` Sin voto registrado al cierre: ${pending}.`;
    return [
      [`${String(number).padStart(2,"0")}. ${r.title}`,{size:10,bold:true,after:2}],
      [`${r.category} · ${r.scope}`,{size:7.5,color:muted,after:2}],
      ...(r.description?[[r.description,{}]]:[]),
      [`Frecuencia: ${r.frequency}`,{after:1}],
      [`Entregable: ${r.deliverable}`,{after:1}],
      [`Métrica: ${r.metric?`${r.metric.name}. Meta: ${r.metric.direction==="lte"?"máximo":"mínimo"} ${r.metric.target} ${r.metric.unit} por frecuencia indicada.`:"Sin definir."}`,{after:1}],
      [`Penalización por incumplimiento: ${r.penalty||"Sin definir."}`,{after:2}],
      [approval,{size:7.5,color:muted,after:4}],
    ];
  }
  let count=0;
  for(const partner of data.partners){
    const tasks=data.responsibilities.filter(r=>r.owner===partner.slug);
    const firstHeight=tasks.length?taskParts(tasks[0],count+1).reduce((sum,[v,o])=>sum+measure(v,o),0):12;
    ensure(2+measure(partner.name,{size:14,bold:true,after:2})+Math.min(firstHeight,180));
    y+=2;text(partner.name,{size:14,bold:true,after:2});
    if(!tasks.length)text("Sin responsabilidades aprobadas en esta versión.",{color:muted,after:6});
    for(const r of tasks){
      const parts=taskParts(r,++count),height=parts.reduce((sum,[v,o])=>sum+measure(v,o),0);
      ensure(Math.min(height,180));
      for(const [value,options] of parts)text(value,options);
    }
  }
  doc.addPage();y=30;
  text("Firmas de los tres socios",{size:20,bold:true,after:6});
  text(`Alpha Dueños · Acuerdo versión ${agreement.version} · ${agreement.digest.slice(0,16)}`,{size:8,color:muted,after:5});
  text("Al firmar, cada socio deja constancia de haber revisado el contenido de esta versión del acuerdo de responsabilidades.",{after:8});
  for(const p of data.partners){
    text(p.name,{size:13,bold:true,after:2});y+=15;
    doc.setDrawColor(...line);doc.setLineWidth(.25);doc.line(20,y,190,y);y+=5;
    text("Firma manuscrita",{size:8,color:muted,after:4});
    text("Nombre completo: ___________________________________________________",{size:8,color:muted,after:2});
    text("Fecha: ____________________    Lugar: ________________________________",{size:8,color:muted,after:8});
  }
  text("Conservar el ejemplar con las tres firmas junto a esta versión del acuerdo.",{size:8,color:muted});
  function brandLogo(x,y,size){
    const point=(a,b)=>[x+a*size/100,y+b*size/100];
    function polygon(points,color){doc.setFillColor(...color);doc.path(points.map(([a,b],i)=>({op:i?"l":"m",c:point(a,b)})).concat({op:"h",c:[]})).fill();}
    polygon([[50,12],[88,84],[74,84],[50,38],[26,84],[12,84]],accent);
    polygon([[50,12],[53,18],[50,24],[47,18]],[255,255,255]);
    doc.setFillColor(...ink);
    for(const [a,b,w,h] of [[38,60,24,4],[33,55,4,14],[63,55,4,14],[29,58,3,8],[68,58,3,8]])doc.roundedRect(x+a*size/100,y+b*size/100,w*size/100,h*size/100,.08,.08,"F");
  }
  const pages=doc.getNumberOfPages();
  for(let n=1;n<=pages;n++){
    doc.setPage(n);doc.setFont("Vera","normal");doc.setFontSize(7);doc.setTextColor(...muted);
    brandLogo(19,8,11);
    doc.text("ALPHA DUEÑOS / ACUERDO DE RESPONSABILIDADES",33,16);
    doc.setTextColor(...accent);doc.text("ALPHA GYM",190,16,{align:"right"});
    doc.setTextColor(...muted);
    doc.setDrawColor(...line);doc.setLineWidth(.2);doc.line(20,279,190,279);
    doc.text(`Versión ${agreement.version} · ${agreement.digest.slice(0,16)} · Pendiente de firma`,20,285);
    doc.text(`Página ${n} de ${pages}`,190,285,{align:"right"});
  }
  return doc.output("blob");
};
