"""Create private access material locally. Never prints keys or commits them."""
import html
import hashlib
import json
import secrets
from pathlib import Path
from urllib.parse import quote

ROOT=Path(__file__).resolve().parent.parent
private=ROOT/".private"
private.mkdir(mode=0o700,exist_ok=True)
keyfile=private/"access.json"
if keyfile.exists():
    config=json.loads(keyfile.read_text())
else:
    config={"partners":[{"slug":slug,"name":name,"key":secrets.token_urlsafe(32)} for slug,name in [("josue","Josue Garza"),("brandon","Brandon"),("tono","Toño")]]}
    keyfile.write_text(json.dumps(config,ensure_ascii=False,indent=2))
    keyfile.chmod(0o600)
def sql_quote(value):
    return "'"+value.replace("'", "''")+"'"

bootstrap=["-- PRIVATE: execute only in this project's Supabase SQL editor.","begin;"]
for p in config["partners"]:
    digest=hashlib.sha256(p["key"].encode()).hexdigest()
    bootstrap.append("insert into alpha_private.partners(slug,name,key_hash) values ("+",".join(map(sql_quote,[p["slug"],p["name"],digest]))+") on conflict(slug) do nothing;")
bootstrap.append("commit;")
bootstrapfile=private/"bootstrap.sql"
bootstrapfile.write_text("\n".join(bootstrap)+"\n");bootstrapfile.chmod(0o600)
setupfile=private/"supabase-setup.sql"
setupfile.write_text((ROOT/"supabase/schema.sql").read_text()+"\n"+bootstrapfile.read_text());setupfile.chmod(0o600)
site="https://josuegarza42.github.io/alpha-duenos/"
cards=[]
for p in config["partners"]:
    url=site+"#clave="+quote(p["key"])
    cards.append(f'<section><h2>{html.escape(p["name"])}</h2><p><a href="{html.escape(url,quote=True)}">Abrir acceso personal</a></p><label>Enlace para compartir solo con este socio<textarea readonly>{html.escape(url)}</textarea></label><label>Clave personal<input readonly value="{html.escape(p["key"],quote=True)}"></label></section>')
page='<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accesos privados · Alpha Dueños</title><style>body{font:15px system-ui;max-width:900px;margin:40px auto;padding:0 22px;background:#f6f5f0;color:#173d30}h1{font-size:28px}section{background:white;padding:22px;border:1px solid #d7ddcf;border-radius:12px;margin:20px 0}label{display:block;margin-top:16px;font-size:12px}textarea,input{box-sizing:border-box;width:100%;padding:12px;margin-top:7px;border:1px solid #c9d2c1;border-radius:6px;font:13px monospace}a{color:#173d30}</style><h1>Accesos privados · Alpha Dueños</h1><p>Entrega a cada socio únicamente su propio acceso. Quien tenga la clave podrá actuar y votar como ese socio.</p>'+''.join(cards)+'</html>'
pagefile=private/"accesos-socios.html"
pagefile.write_text(page);pagefile.chmod(0o600)
textfile=private/"ACCESOS ALPHA DUENOS.txt"
textfile.write_text("ALPHA DUEÑOS · ACCESOS PRIVADOS\n\nPágina: "+site+"\nLos tres tienen acceso administrador. Cada clave identifica los votos de un socio.\n\n"+"\n\n".join(p["name"]+"\nClave: "+p["key"]+"\nEnlace: "+site+"#clave="+quote(p["key"]) for p in config["partners"])+"\n")
textfile.chmod(0o600)
print("3 accesos preparados en .private/accesos-socios.html y configuración en .private/supabase-setup.sql. No se mostraron claves en la salida.")
