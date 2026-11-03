"use strict";
// Local-only preview with disposable data. Never used by the published site.
const http=require("node:http");
const {openDatabase,rpc,seedDemo}=require("./test-db.cjs");
(async()=>{
  const db=await openDatabase();await seedDemo(db);
  const server=http.createServer(async(req,res)=>{
    res.setHeader("Access-Control-Allow-Origin","http://127.0.0.1:8018");
    res.setHeader("Access-Control-Allow-Headers","Content-Type");
    res.setHeader("Cache-Control","no-store");
    if(req.method==="OPTIONS"){res.writeHead(204);res.end();return;}
    if(req.method!=="POST"||req.url!=="/rest/v1/rpc/alpha_api"){res.writeHead(404);res.end();return;}
    try{
      let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>30000)throw new Error("Solicitud demasiado grande");}
      const body=JSON.parse(raw),result=await rpc(db,body.p_action,body.p_token,body.p_payload);
      res.setHeader("Content-Type","application/json");res.end(JSON.stringify(result));
    }catch{res.writeHead(400);res.end(JSON.stringify({error:"Solicitud inválida.",status:400}));}
  });
  server.listen(8017,"127.0.0.1",()=>console.log("Vista previa local con datos desechables: API en 127.0.0.1:8017"));
})().catch(error=>{console.error(error);process.exitCode=1;});
