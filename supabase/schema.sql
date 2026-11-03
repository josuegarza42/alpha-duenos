-- Alpha Dueños: application data stays in a private schema.
-- Only this RPC is exposed; every action except login requires a private session.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists alpha_private;
revoke all on schema alpha_private from public, anon, authenticated;

create table if not exists alpha_private.partners (
  slug text primary key check (slug in ('josue','brandon','tono')),
  name text not null,
  key_hash text not null
);
create table if not exists alpha_private.sessions (
  token_hash text primary key,
  partner text not null references alpha_private.partners(slug),
  expires_at timestamptz not null default now()+interval '30 days'
);
create table if not exists alpha_private.board (id int primary key check(id=1), revision bigint not null default 0);
insert into alpha_private.board(id) values(1) on conflict do nothing;
create table if not exists alpha_private.responsibilities (
  id uuid primary key default gen_random_uuid(),
  title text not null check(char_length(title) between 1 and 120),
  description text not null default '' check(char_length(description)<=2000),
  owner text not null references alpha_private.partners(slug),
  category text not null check(category in ('Finanzas','Fiscal','Operación','Trámites','Marketing','Sistemas','General')),
  frequency text not null check(char_length(frequency) between 1 and 80),
  deliverable text not null check(char_length(deliverable) between 1 and 1200),
  scope text not null check(scope in ('Como socio','Trabajo remunerado','Apoyo puntual')),
  status text not null default 'proposed' check(status in ('proposed','active','retired','rejected','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists alpha_private.motions (
  id uuid primary key default gen_random_uuid(),
  responsibility_id uuid not null references alpha_private.responsibilities(id),
  proposer text not null references alpha_private.partners(slug),
  kind text not null check(kind in ('create','edit','retire')),
  payload jsonb not null default '{}',
  reason text not null default '' check(char_length(reason)<=1000),
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  created_at timestamptz not null default now(), decided_at timestamptz
);
create unique index if not exists one_open_motion on alpha_private.motions(responsibility_id) where status='pending';
create table if not exists alpha_private.votes (
  motion_id uuid not null references alpha_private.motions(id),
  partner text not null references alpha_private.partners(slug),
  value text not null check(value in ('approve','reject')),
  updated_at timestamptz not null default now(),
  primary key(motion_id,partner)
);
create table if not exists alpha_private.agreements (
  id uuid primary key default gen_random_uuid(), version int not null unique,
  revision bigint not null, digest text not null unique, snapshot jsonb not null,
  created_by text not null references alpha_private.partners(slug), created_at timestamptz not null default now()
);
create table if not exists alpha_private.events (
  id bigserial primary key, actor text not null references alpha_private.partners(slug),
  action text not null, detail text not null, created_at timestamptz not null default now()
);

-- RLS is defense in depth in addition to the inaccessible schema.
alter table alpha_private.partners enable row level security;
alter table alpha_private.sessions enable row level security;
alter table alpha_private.board enable row level security;
alter table alpha_private.responsibilities enable row level security;
alter table alpha_private.motions enable row level security;
alter table alpha_private.votes enable row level security;
alter table alpha_private.agreements enable row level security;
alter table alpha_private.events enable row level security;
revoke all on all tables in schema alpha_private from public,anon,authenticated;
revoke all on all sequences in schema alpha_private from public,anon,authenticated;

create or replace function alpha_private.event(p_actor text,p_action text,p_detail text) returns void
language plpgsql set search_path='' as $$
begin
 update alpha_private.board set revision=revision+1 where id=1;
 insert into alpha_private.events(actor,action,detail) values(p_actor,p_action,left(p_detail,500));
end;$$;

create or replace function alpha_private.payload(p jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare k text; result jsonb='{}'; lim int;
begin
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'La propuesta no es válida.'; end if;
 foreach k in array array['title','description','owner','category','frequency','deliverable','scope'] loop
   if p ? k and jsonb_typeof(p->k)<>'string' then raise exception 'Los campos deben ser texto.'; end if;
   lim=case k when 'title' then 120 when 'description' then 2000 when 'owner' then 20 when 'frequency' then 80 when 'deliverable' then 1200 else 40 end;
   if char_length(coalesce(p->>k,''))>lim then raise exception 'Uno de los campos supera el tamaño permitido.'; end if;
   if k<>'description' and btrim(coalesce(p->>k,''))='' then raise exception 'Completa título, responsable, área, frecuencia, entregable y tipo de función.'; end if;
   result=result||jsonb_build_object(k,btrim(coalesce(p->>k,'')));
 end loop;
 if not exists(select 1 from alpha_private.partners where slug=result->>'owner') then raise exception 'Selecciona uno de los tres socios.'; end if;
 if result->>'category' not in ('Finanzas','Fiscal','Operación','Trámites','Marketing','Sistemas','General') or result->>'scope' not in ('Como socio','Trabajo remunerado','Apoyo puntual') then raise exception 'Selecciona un área y un tipo válidos.'; end if;
 return result;
end;$$;

create or replace function alpha_private.responsibility_json(r alpha_private.responsibilities) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'title',r.title,'description',r.description,'owner',r.owner,'category',r.category,'frequency',r.frequency,'deliverable',r.deliverable,'scope',r.scope,'status',r.status,'updated_at',r.updated_at);
$$;
create or replace function alpha_private.motion_json(m alpha_private.motions) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',m.id,'responsibility_id',m.responsibility_id,'title',coalesce(m.payload->>'title',r.title),'proposer',m.proposer,'kind',m.kind,'payload',m.payload,'reason',m.reason,'status',m.status,'created_at',m.created_at,'decided_at',m.decided_at,'votes',coalesce((select jsonb_object_agg(v.partner,v.value) from alpha_private.votes v where v.motion_id=m.id),'{}'::jsonb)) from alpha_private.responsibilities r where r.id=m.responsibility_id;
$$;

create or replace function alpha_private.snapshot() returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('name','Alpha Dueños','rule','Mayoría de dos de tres socios',
 'partners',(select jsonb_agg(jsonb_build_object('slug',p.slug,'name',p.name) order by case p.slug when 'josue' then 1 when 'brandon' then 2 else 3 end) from alpha_private.partners p),
 'responsibilities',coalesce((select jsonb_agg((alpha_private.responsibility_json(r)-'updated_at')||jsonb_build_object('approval',(
   select jsonb_build_object('motion_id',m.id,'date',m.decided_at,'votes',(select jsonb_object_agg(v.partner,v.value) from alpha_private.votes v where v.motion_id=m.id))
   from alpha_private.motions m where m.responsibility_id=r.id and m.status='approved' and m.kind in ('create','edit') order by m.decided_at desc,m.created_at desc limit 1
 )) order by r.owner,r.title,r.id) from alpha_private.responsibilities r where r.status='active'),'[]'::jsonb));
$$;

create or replace function public.alpha_api(p_action text,p_token text default '',p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text; person alpha_private.partners; r alpha_private.responsibilities; m alpha_private.motions; a alpha_private.agreements;
 data jsonb; snap jsonb; secret text; digest_value text; new_id uuid; yes_count int; no_count int; v text; kind text; reason text; rev bigint;
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>20000 then return jsonb_build_object('error','Solicitud inválida.','status',400); end if;
 if p_action='login' then
   secret=p_payload->>'key';
   if secret is null or char_length(secret)<24 or char_length(secret)>150 then return jsonb_build_object('error','La clave personal no es correcta.','status',401); end if;
   select * into person from alpha_private.partners where key_hash=encode(extensions.digest(btrim(secret),'sha256'),'hex');
   if not found then return jsonb_build_object('error','La clave personal no es correcta.','status',401); end if;
   secret=encode(extensions.gen_random_bytes(40),'hex');
   delete from alpha_private.sessions where expires_at<=now();
   insert into alpha_private.sessions(token_hash,partner) values(encode(extensions.digest(secret,'sha256'),'hex'),person.slug);
   return jsonb_build_object('token',secret,'partner',jsonb_build_object('slug',person.slug,'name',person.name));
 end if;
 if p_token is null or char_length(p_token)<>80 then return jsonb_build_object('error','Ingresa con tu clave de socio.','status',401); end if;
 select s.partner into actor from alpha_private.sessions s where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.expires_at>now();
 if actor is null then return jsonb_build_object('error','Tu sesión terminó. Vuelve a ingresar.','status',401); end if;
 if p_action='logout' then
   delete from alpha_private.sessions where token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
   return jsonb_build_object('ok',true);
 end if;
 -- Serialize decisions so simultaneous second/third votes cannot change a closed result.
 select revision into rev from alpha_private.board where id=1 for update;
 if p_action='state' then
   return jsonb_build_object('revision',rev,'me',(select jsonb_build_object('slug',p.slug,'name',p.name) from alpha_private.partners p where p.slug=actor),
     'partners',(select jsonb_agg(jsonb_build_object('slug',p.slug,'name',p.name) order by case p.slug when 'josue' then 1 when 'brandon' then 2 else 3 end) from alpha_private.partners p),
     'responsibilities',coalesce((select jsonb_agg(alpha_private.responsibility_json(r0) order by r0.created_at,r0.id) from alpha_private.responsibilities r0),'[]'::jsonb),
     'motions',coalesce((select jsonb_agg(alpha_private.motion_json(m0) order by m0.created_at desc,m0.id) from alpha_private.motions m0),'[]'::jsonb),
     'agreements',coalesce((select jsonb_agg(jsonb_build_object('id',a0.id,'version',a0.version,'created_at',a0.created_at,'digest',a0.digest,'count',jsonb_array_length(a0.snapshot->'responsibilities')) order by a0.version desc) from alpha_private.agreements a0),'[]'::jsonb),
     'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (select e0.id,p.name actor,e0.action,e0.detail,e0.created_at from alpha_private.events e0 join alpha_private.partners p on p.slug=e0.actor order by e0.id desc limit 120) e),'[]'::jsonb),
     'rule',jsonb_build_object('threshold',2,'partners',3,'signatures','handwritten'));
 elsif p_action='create' then
   data=alpha_private.payload(p_payload);
   insert into alpha_private.responsibilities(title,description,owner,category,frequency,deliverable,scope) values(data->>'title',data->>'description',data->>'owner',data->>'category',data->>'frequency',data->>'deliverable',data->>'scope') returning * into r;
   insert into alpha_private.motions(responsibility_id,proposer,kind,payload) values(r.id,actor,'create',data) returning id into new_id;
   perform alpha_private.event(actor,'Responsabilidad propuesta',r.title);
   return jsonb_build_object('id',r.id,'motion_id',new_id);
 elsif p_action='motion' then
   select * into r from alpha_private.responsibilities where id=(p_payload->>'responsibility_id')::uuid;
   if not found then return jsonb_build_object('error','La función no está disponible.','status',404); end if;
   if r.status<>'active' or exists(select 1 from alpha_private.motions where responsibility_id=r.id and status='pending') then return jsonb_build_object('error','La función no está aprobada o ya tiene una votación abierta.','status',409); end if;
   kind=p_payload->>'kind';reason=btrim(coalesce(p_payload->>'reason',''));
   if kind is null or kind not in ('edit','retire') or reason='' or char_length(reason)>1000 then return jsonb_build_object('error','Selecciona cambio o retiro y explica el motivo (máximo 1000 caracteres).','status',400); end if;
   data=case when kind='edit' then alpha_private.payload(p_payload->'payload') else '{}'::jsonb end;
   if kind='edit' and data=alpha_private.responsibility_json(r)-array['id','status','updated_at'] then return jsonb_build_object('error','Incluye al menos un cambio.','status',400); end if;
   insert into alpha_private.motions(responsibility_id,proposer,kind,payload,reason) values(r.id,actor,kind,data,reason) returning id into new_id;
   perform alpha_private.event(actor,case when kind='edit' then 'Cambio propuesto' else 'Retiro propuesto' end,r.title);
   return jsonb_build_object('motion_id',new_id);
 elsif p_action in ('vote','cancel') then
   select * into m from alpha_private.motions where id=(p_payload->>'motion_id')::uuid;
   if not found then return jsonb_build_object('error','La propuesta no está disponible.','status',404); end if;
   if m.status<>'pending' then return jsonb_build_object('error','Esta votación ya terminó.','status',409); end if;
   select * into r from alpha_private.responsibilities where id=m.responsibility_id;
   if p_action='cancel' then
     if m.proposer<>actor then return jsonb_build_object('error','Solo quien propuso puede cancelar su propuesta abierta.','status',403); end if;
     update alpha_private.motions set status='cancelled',decided_at=now() where id=m.id;
     if m.kind='create' then update alpha_private.responsibilities set status='cancelled',updated_at=now() where id=r.id; end if;
     perform alpha_private.event(actor,'Propuesta cancelada',r.title);
     return jsonb_build_object('ok',true);
   end if;
   v=p_payload->>'value';
   if v is null or v not in ('approve','reject') then return jsonb_build_object('error','El voto debe ser a favor o en contra.','status',400); end if;
   insert into alpha_private.votes(motion_id,partner,value) values(m.id,actor,v) on conflict(motion_id,partner) do update set value=excluded.value,updated_at=now();
   perform alpha_private.event(actor,case when v='approve' then 'Voto a favor' else 'Voto en contra' end,r.title);
   select count(*) filter(where value='approve'),count(*) filter(where value='reject') into yes_count,no_count from alpha_private.votes where motion_id=m.id;
   if yes_count>=2 or no_count>=2 then
     m.status=case when yes_count>=2 then 'approved' else 'rejected' end;
     update alpha_private.motions set status=m.status,decided_at=now() where id=m.id;
     if yes_count>=2 and m.kind='retire' then update alpha_private.responsibilities set status='retired',updated_at=now() where id=r.id;
     elsif yes_count>=2 then update alpha_private.responsibilities set title=m.payload->>'title',description=m.payload->>'description',owner=m.payload->>'owner',category=m.payload->>'category',frequency=m.payload->>'frequency',deliverable=m.payload->>'deliverable',scope=m.payload->>'scope',status='active',updated_at=now() where id=r.id;
     elsif m.kind='create' then update alpha_private.responsibilities set status='rejected',updated_at=now() where id=r.id; end if;
     perform alpha_private.event(actor,case when yes_count>=2 then 'Propuesta aprobada' else 'Propuesta rechazada' end,r.title||' · '||yes_count||' a favor / '||no_count||' en contra');
   end if;
   return jsonb_build_object('ok',true,'status',m.status);
 elsif p_action='agreement' then
   if exists(select 1 from alpha_private.motions where status='pending') then return jsonb_build_object('error','Resuelvan o cancelen las votaciones abiertas antes de generar el acuerdo final.','status',409); end if;
   snap=alpha_private.snapshot();
   if jsonb_array_length(snap->'responsibilities')=0 then return jsonb_build_object('error','Primero aprueben al menos una responsabilidad.','status',409); end if;
   digest_value=encode(extensions.digest(snap::text,'sha256'),'hex');
   select * into a from alpha_private.agreements where digest=digest_value;
   if not found then
     insert into alpha_private.agreements(version,revision,digest,snapshot,created_by) values((select coalesce(max(version),0)+1 from alpha_private.agreements),rev,digest_value,snap,actor) returning * into a;
     perform alpha_private.event(actor,'Acuerdo generado','Versión '||a.version||' · pendiente de firma de los tres socios');
   end if;
   return jsonb_build_object('id',a.id,'version',a.version);
 elsif p_action='agreement_data' then
   select * into a from alpha_private.agreements where id=(p_payload->>'agreement_id')::uuid;
   if not found then return jsonb_build_object('error','El acuerdo no está disponible.','status',404); end if;
   return jsonb_build_object('id',a.id,'version',a.version,'revision',a.revision,'created_at',a.created_at,'digest',a.digest,'snapshot',a.snapshot);
 elsif p_action='backup' then
   return jsonb_build_object('exported_at',now(),'responsibilities',coalesce((select jsonb_agg(alpha_private.responsibility_json(r1)) from alpha_private.responsibilities r1),'[]'::jsonb),'motions',coalesce((select jsonb_agg(alpha_private.motion_json(m1)) from alpha_private.motions m1),'[]'::jsonb),'agreements',coalesce((select jsonb_agg(to_jsonb(a1)) from alpha_private.agreements a1),'[]'::jsonb),'events',coalesce((select jsonb_agg(to_jsonb(e1)) from alpha_private.events e1),'[]'::jsonb));
 end if;
 return jsonb_build_object('error','Acción no disponible.','status',404);
exception
 when sqlstate 'P0001' then return jsonb_build_object('error',sqlerrm,'status',400);
 when unique_violation then return jsonb_build_object('error','Ya existe una operación equivalente. Actualiza antes de continuar.','status',409);
 when invalid_text_representation or not_null_violation or foreign_key_violation or check_violation then return jsonb_build_object('error','Revisa los datos de la solicitud.','status',400);
end;$$;
revoke all on all functions in schema alpha_private from public,anon,authenticated;
revoke all on function public.alpha_api(text,text,jsonb) from public;
grant execute on function public.alpha_api(text,text,jsonb) to anon,authenticated;
