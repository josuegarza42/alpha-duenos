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
-- Additive migration: existing functions and signed snapshots remain intact.
alter table alpha_private.responsibilities add column if not exists penalty text not null default '' check(char_length(penalty)<=1200);
alter table alpha_private.responsibilities add column if not exists metric jsonb;
create table if not exists alpha_private.measurements (
  id uuid primary key default gen_random_uuid(),
  responsibility_id uuid not null references alpha_private.responsibilities(id),
  title text not null, owner text not null references alpha_private.partners(slug),
  metric jsonb not null, period text not null check(char_length(period) between 1 and 80),
  actual numeric not null check(actual between 0 and 1000000000000),
  note text not null default '' check(char_length(note)<=1200),
  actor text not null references alpha_private.partners(slug), created_at timestamptz not null default now()
);
create table if not exists alpha_private.incidents (
  id uuid primary key default gen_random_uuid(),
  responsibility_id uuid not null references alpha_private.responsibilities(id),
  title text not null, owner text not null references alpha_private.partners(slug), penalty text not null,
  occurred_on date not null, detail text not null check(char_length(detail) between 1 and 1200),
  status text not null default 'open' check(status in ('open','resolved','dismissed')),
  resolution text not null default '' check(char_length(resolution)<=1200),
  actor text not null references alpha_private.partners(slug), created_at timestamptz not null default now(),
  resolved_by text references alpha_private.partners(slug), resolved_at timestamptz
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
-- Gym improvements share the decision workflow, without becoming partner roles.
alter table alpha_private.motions alter column responsibility_id drop not null;
alter table alpha_private.motions drop constraint if exists motions_kind_check;
alter table alpha_private.motions add constraint motions_kind_check check(kind in ('create','edit','retire','improvement'));
alter table alpha_private.motions drop constraint if exists motions_status_check;
alter table alpha_private.motions add constraint motions_status_check check(status in ('pending','discussion','approved','rejected','cancelled'));
alter table alpha_private.motions drop constraint if exists motions_subject_check;
alter table alpha_private.motions add constraint motions_subject_check check((kind='improvement')=(responsibility_id is null));
drop index if exists alpha_private.one_open_motion;
create unique index one_open_motion on alpha_private.motions(responsibility_id) where status in ('pending','discussion');
create table if not exists alpha_private.discussion_comments (
  id uuid primary key default gen_random_uuid(),
  motion_id uuid not null references alpha_private.motions(id),
  partner text not null references alpha_private.partners(slug),
  body text not null check(char_length(body) between 1 and 2100),
  created_at timestamptz not null default now()
);
create table if not exists alpha_private.resolution_votes (
  motion_id uuid not null references alpha_private.motions(id),
  partner text not null references alpha_private.partners(slug),
  value text not null check(value in ('approve','reject')),
  reason text not null check(char_length(reason) between 1 and 2000),
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
-- Recoverable deletion keeps votes, evidence and immutable agreement snapshots.
alter table alpha_private.responsibilities add column if not exists deleted_at timestamptz;
alter table alpha_private.incidents add column if not exists deleted_at timestamptz;
alter table alpha_private.agreements add column if not exists deleted_at timestamptz;

-- RLS is defense in depth in addition to the inaccessible schema.
alter table alpha_private.partners enable row level security;
alter table alpha_private.sessions enable row level security;
alter table alpha_private.board enable row level security;
alter table alpha_private.responsibilities enable row level security;
alter table alpha_private.motions enable row level security;
alter table alpha_private.votes enable row level security;
alter table alpha_private.agreements enable row level security;
alter table alpha_private.events enable row level security;
alter table alpha_private.measurements enable row level security;
alter table alpha_private.incidents enable row level security;
alter table alpha_private.discussion_comments enable row level security;
alter table alpha_private.resolution_votes enable row level security;
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
declare k text; result jsonb='{}'; lim int; metric jsonb;
begin
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'La propuesta no es válida.'; end if;
 foreach k in array array['title','description','owner','category','frequency','deliverable','scope','penalty'] loop
   if p ? k and jsonb_typeof(p->k)<>'string' then raise exception 'Los campos deben ser texto.'; end if;
   lim=case k when 'title' then 120 when 'description' then 2000 when 'owner' then 20 when 'frequency' then 80 when 'deliverable' then 1200 when 'penalty' then 1200 else 40 end;
   if char_length(coalesce(p->>k,''))>lim then raise exception 'Uno de los campos supera el tamaño permitido.'; end if;
   if k not in ('description','penalty') and btrim(coalesce(p->>k,''))='' then raise exception 'Completa título, responsable, área, frecuencia, entregable y tipo de función.'; end if;
   result=result||jsonb_build_object(k,btrim(coalesce(p->>k,'')));
 end loop;
 if not exists(select 1 from alpha_private.partners where slug=result->>'owner') then raise exception 'Selecciona uno de los tres socios.'; end if;
 if result->>'category' not in ('Finanzas','Fiscal','Operación','Trámites','Marketing','Sistemas','General') or result->>'scope' not in ('Como socio','Trabajo remunerado','Apoyo puntual') then raise exception 'Selecciona un área y un tipo válidos.'; end if;
 metric=p->'metric';
 if metric is not null and metric<>'null'::jsonb then
   if jsonb_typeof(metric)<>'object' or jsonb_typeof(metric->'name') is distinct from 'string' or char_length(btrim(metric->>'name')) not between 1 and 120
      or jsonb_typeof(metric->'unit') is distinct from 'string' or char_length(btrim(metric->>'unit')) not between 1 and 30
      or jsonb_typeof(metric->'target') is distinct from 'number' or (metric->>'target')::numeric not between 0 and 1000000000000
      or coalesce(metric->>'direction','') not in ('gte','lte') then raise exception 'Completa indicador, meta numérica, unidad y criterio de la métrica.'; end if;
   metric=jsonb_build_object('name',btrim(metric->>'name'),'target',(metric->>'target')::numeric,'unit',btrim(metric->>'unit'),'direction',metric->>'direction');
 else metric='null'::jsonb; end if;
 return result||jsonb_build_object('metric',metric);
end;$$;

create or replace function alpha_private.responsibility_json(r alpha_private.responsibilities) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'title',r.title,'description',r.description,'owner',r.owner,'category',r.category,'frequency',r.frequency,'deliverable',r.deliverable,'scope',r.scope,'penalty',r.penalty,'metric',r.metric,'status',r.status,'updated_at',r.updated_at);
$$;
create or replace function alpha_private.motion_json(m alpha_private.motions) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',m.id,'responsibility_id',m.responsibility_id,'title',coalesce(m.payload->>'title',(select r.title from alpha_private.responsibilities r where r.id=m.responsibility_id)),'proposer',m.proposer,'kind',m.kind,'payload',m.payload,'reason',m.reason,'status',m.status,'created_at',m.created_at,'decided_at',m.decided_at,
 'votes',coalesce((select jsonb_object_agg(v.partner,v.value) from alpha_private.votes v where v.motion_id=m.id),'{}'::jsonb),
 'resolution_votes',coalesce((select jsonb_object_agg(v.partner,v.value) from alpha_private.resolution_votes v where v.motion_id=m.id),'{}'::jsonb),
 'comments',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from alpha_private.discussion_comments c where c.motion_id=m.id),'[]'::jsonb));
$$;

create or replace function alpha_private.snapshot() returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('name','Alpha Dueños','rule','Tres a favor aprueban; dos a favor y uno en contra abren discusión; dos votos finales resuelven',
 'partners',(select jsonb_agg(jsonb_build_object('slug',p.slug,'name',p.name,'role','admin') order by case p.slug when 'josue' then 1 when 'brandon' then 2 else 3 end) from alpha_private.partners p),
 'responsibilities',coalesce((select jsonb_agg((alpha_private.responsibility_json(r)-'updated_at')||jsonb_build_object('approval',(
   select jsonb_build_object('motion_id',m.id,'date',m.decided_at,'votes',case when exists(select 1 from alpha_private.resolution_votes v where v.motion_id=m.id) then (select jsonb_object_agg(v.partner,v.value) from alpha_private.resolution_votes v where v.motion_id=m.id) else (select jsonb_object_agg(v.partner,v.value) from alpha_private.votes v where v.motion_id=m.id) end,'discussion',alpha_private.motion_json(m))
   from alpha_private.motions m where m.responsibility_id=r.id and m.status='approved' and m.kind in ('create','edit') order by m.decided_at desc,m.created_at desc limit 1
 )) order by r.owner,r.title,r.id) from alpha_private.responsibilities r where r.status='active' and r.deleted_at is null),'[]'::jsonb));
$$;

create or replace function public.alpha_api(p_action text,p_token text default '',p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
<<api>>
declare actor text; person alpha_private.partners; r alpha_private.responsibilities; m alpha_private.motions; a alpha_private.agreements;
 data jsonb; snap jsonb; secret text; digest_value text; new_id uuid; yes_count int; no_count int; v text; kind text; reason text; rev bigint;
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>20000 then return jsonb_build_object('error','Solicitud inválida.','status',400); end if;
 if p_action='login' then
   secret=p_payload->>'key';
   if secret is null or char_length(secret)<6 or char_length(secret)>150 then return jsonb_build_object('error','La clave personal no es correcta.','status',401); end if;
   select * into person from alpha_private.partners where key_hash=encode(extensions.digest(btrim(secret),'sha256'),'hex');
   if not found then return jsonb_build_object('error','La clave personal no es correcta.','status',401); end if;
   secret=encode(extensions.gen_random_bytes(40),'hex');
   delete from alpha_private.sessions where expires_at<=now();
   insert into alpha_private.sessions(token_hash,partner) values(encode(extensions.digest(secret,'sha256'),'hex'),person.slug);
   return jsonb_build_object('token',secret,'partner',jsonb_build_object('slug',person.slug,'name',person.name,'role','admin'));
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
   return jsonb_build_object('revision',rev,'me',(select jsonb_build_object('slug',p.slug,'name',p.name,'role','admin') from alpha_private.partners p where p.slug=actor),
     'partners',(select jsonb_agg(jsonb_build_object('slug',p.slug,'name',p.name,'role','admin') order by case p.slug when 'josue' then 1 when 'brandon' then 2 else 3 end) from alpha_private.partners p),
     'responsibilities',coalesce((select jsonb_agg(alpha_private.responsibility_json(r0) order by r0.created_at,r0.id) from alpha_private.responsibilities r0 where r0.deleted_at is null),'[]'::jsonb),
     'motions',coalesce((select jsonb_agg(alpha_private.motion_json(m0) order by m0.created_at desc,m0.id) from alpha_private.motions m0 left join alpha_private.responsibilities r0 on r0.id=m0.responsibility_id where r0.deleted_at is null),'[]'::jsonb),
     'agreements',coalesce((select jsonb_agg(jsonb_build_object('id',a0.id,'version',a0.version,'created_at',a0.created_at,'digest',a0.digest,'count',jsonb_array_length(a0.snapshot->'responsibilities')) order by a0.version desc) from alpha_private.agreements a0 where a0.deleted_at is null),'[]'::jsonb),
     'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (select e0.id,p.name actor,e0.action,e0.detail,e0.created_at from alpha_private.events e0 join alpha_private.partners p on p.slug=e0.actor order by e0.id desc limit 120) e),'[]'::jsonb),
     'measurements',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id) from alpha_private.measurements x),'[]'::jsonb),
     'incidents',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id) from alpha_private.incidents x where x.deleted_at is null),'[]'::jsonb),
     'trash',coalesce((select jsonb_agg(to_jsonb(x) order by x.deleted_at desc,x.id) from (
       select 'responsibility' type,id,title,status,deleted_at from alpha_private.responsibilities where deleted_at is not null
       union all select 'incident',id,title,status,deleted_at from alpha_private.incidents where deleted_at is not null
       union all select 'agreement',id,'Acuerdo v'||version,'snapshot',deleted_at from alpha_private.agreements where deleted_at is not null
     ) x),'[]'::jsonb),
     'rule',jsonb_build_object('threshold',3,'discussion_threshold',2,'rejection_threshold',2,'partners',3,'signatures','handwritten'));
 elsif p_action='create_improvement' then
   if jsonb_typeof(p_payload->'title') is distinct from 'string' or char_length(btrim(p_payload->>'title')) not between 1 and 120
     or jsonb_typeof(p_payload->'description') is distinct from 'string' or char_length(btrim(p_payload->>'description')) not between 1 and 2000
     or jsonb_typeof(p_payload->'benefit') is distinct from 'string' or char_length(btrim(p_payload->>'benefit')) not between 1 and 1200
     or (p_payload ? 'budget' and jsonb_typeof(p_payload->'budget') is distinct from 'string') or char_length(coalesce(p_payload->>'budget',''))>300 then
     return jsonb_build_object('error','Completa título, mejora y beneficio; presupuesto opcional de hasta 300 caracteres.','status',400); end if;
   data=jsonb_build_object('title',btrim(p_payload->>'title'),'description',btrim(p_payload->>'description'),'benefit',btrim(p_payload->>'benefit'),'budget',btrim(coalesce(p_payload->>'budget','')));
   insert into alpha_private.motions(proposer,kind,payload) values(actor,'improvement',data) returning id into new_id;
   perform alpha_private.event(actor,'Mejora del gimnasio propuesta',data->>'title');
   return jsonb_build_object('motion_id',new_id);
 elsif p_action='create' then
   data=alpha_private.payload(p_payload);
   insert into alpha_private.responsibilities(title,description,owner,category,frequency,deliverable,scope,penalty,metric) values(data->>'title',data->>'description',data->>'owner',data->>'category',data->>'frequency',data->>'deliverable',data->>'scope',data->>'penalty',nullif(data->'metric','null'::jsonb)) returning * into r;
   insert into alpha_private.motions(responsibility_id,proposer,kind,payload) values(r.id,actor,'create',data) returning id into new_id;
   perform alpha_private.event(actor,'Responsabilidad propuesta',r.title);
   return jsonb_build_object('id',r.id,'motion_id',new_id);
 elsif p_action='motion' then
   select * into r from alpha_private.responsibilities where id=(p_payload->>'responsibility_id')::uuid and deleted_at is null;
   if not found then return jsonb_build_object('error','La función no está disponible.','status',404); end if;
   if r.status<>'active' or exists(select 1 from alpha_private.motions where responsibility_id=r.id and status in ('pending','discussion')) then return jsonb_build_object('error','La función no está aprobada o ya tiene una votación abierta.','status',409); end if;
   kind=p_payload->>'kind';reason=btrim(coalesce(p_payload->>'reason',''));
   if kind is null or kind not in ('edit','retire') or reason='' or char_length(reason)>1000 then return jsonb_build_object('error','Selecciona cambio o retiro y explica el motivo (máximo 1000 caracteres).','status',400); end if;
   data=case when kind='edit' then alpha_private.payload(p_payload->'payload') else '{}'::jsonb end;
   if kind='edit' and data=alpha_private.responsibility_json(r)-array['id','status','updated_at'] then return jsonb_build_object('error','Incluye al menos un cambio.','status',400); end if;
   insert into alpha_private.motions(responsibility_id,proposer,kind,payload,reason) values(r.id,actor,kind,data,reason) returning id into new_id;
   perform alpha_private.event(actor,case when kind='edit' then 'Cambio propuesto' else 'Retiro propuesto' end,r.title);
   return jsonb_build_object('motion_id',new_id);
 elsif p_action in ('vote','cancel','comment','resolve_discussion') then
   select * into m from alpha_private.motions where id=(p_payload->>'motion_id')::uuid;
   if not found then return jsonb_build_object('error','La propuesta no está disponible.','status',404); end if;
   if m.status not in ('pending','discussion') then return jsonb_build_object('error','Esta votación ya terminó.','status',409); end if;
   if m.responsibility_id is not null then
     select * into r from alpha_private.responsibilities where id=m.responsibility_id and deleted_at is null;
     if not found then return jsonb_build_object('error','La función no está disponible.','status',404); end if;
   end if;
   secret=coalesce(m.payload->>'title',r.title);
   if p_action='cancel' then
     if m.status='discussion' then return jsonb_build_object('error','Resuelvan la discusión con una votación final.','status',409); end if;
     update alpha_private.motions set status='cancelled',decided_at=now() where id=m.id;
     if m.kind='create' then update alpha_private.responsibilities set status='cancelled',updated_at=now() where id=r.id; end if;
     perform alpha_private.event(actor,'Propuesta cancelada',secret);
     return jsonb_build_object('ok',true);
   end if;
   if p_action in ('comment','resolve_discussion') then
     if m.status<>'discussion' then return jsonb_build_object('error','Esta propuesta no está en discusión.','status',409); end if;
     reason=btrim(coalesce(p_payload->>'reason',''));
     if jsonb_typeof(p_payload->'reason') is distinct from 'string' or char_length(reason) not between 1 and 2000 then return jsonb_build_object('error','Escribe el comentario o motivo de tu decisión (hasta 2000 caracteres).','status',400); end if;
     if p_action='comment' then
       insert into alpha_private.discussion_comments(motion_id,partner,body) values(m.id,actor,reason);
       perform alpha_private.event(actor,'Comentario de discusión',secret);
       return jsonb_build_object('ok',true);
     end if;
   elsif m.status<>'pending' then return jsonb_build_object('error','Los votos iniciales se conservan. Vota el resultado de la discusión.','status',409);
   end if;
   v=p_payload->>'value';
   if v is null or v not in ('approve','reject') then return jsonb_build_object('error','El voto debe ser a favor o en contra.','status',400); end if;
   if p_action='resolve_discussion' then
     insert into alpha_private.resolution_votes(motion_id,partner,value,reason) values(m.id,actor,v,reason) on conflict(motion_id,partner) do update set value=excluded.value,reason=excluded.reason,updated_at=now();
     insert into alpha_private.discussion_comments(motion_id,partner,body) values(m.id,actor,(case when v='approve' then 'Voto final a favor: ' else 'Voto final en contra: ' end)||reason);
     perform alpha_private.event(actor,'Voto final de discusión',secret);
     select count(*) filter(where value='approve'),count(*) filter(where value='reject') into yes_count,no_count from alpha_private.resolution_votes where motion_id=m.id;
     if yes_count<2 and no_count<2 then return jsonb_build_object('ok',true,'status','discussion'); end if;
   else
     insert into alpha_private.votes(motion_id,partner,value) values(m.id,actor,v) on conflict(motion_id,partner) do update set value=excluded.value,updated_at=now();
     perform alpha_private.event(actor,case when v='approve' then 'Voto a favor' else 'Voto en contra' end,secret);
     select count(*) filter(where value='approve'),count(*) filter(where value='reject') into yes_count,no_count from alpha_private.votes where motion_id=m.id;
     if yes_count=2 and no_count=1 then
       update alpha_private.motions set status='discussion' where id=m.id;
       perform alpha_private.event(actor,'Propuesta en discusión',secret||' · 2 a favor / 1 en contra');
       return jsonb_build_object('ok',true,'status','discussion');
     end if;
     if yes_count<3 and no_count<2 then return jsonb_build_object('ok',true,'status','pending'); end if;
   end if;
   m.status=case when yes_count>=2 then 'approved' else 'rejected' end;
   update alpha_private.motions set status=m.status,decided_at=now() where id=m.id;
   if m.status='approved' and m.kind='retire' then update alpha_private.responsibilities set status='retired',updated_at=now() where id=r.id;
   elsif m.status='approved' and m.kind in ('create','edit') then update alpha_private.responsibilities set title=m.payload->>'title',description=m.payload->>'description',owner=m.payload->>'owner',category=m.payload->>'category',frequency=m.payload->>'frequency',deliverable=m.payload->>'deliverable',scope=m.payload->>'scope',penalty=coalesce(m.payload->>'penalty',''),metric=nullif(m.payload->'metric','null'::jsonb),status='active',updated_at=now() where id=r.id;
   elsif m.status='rejected' and m.kind='create' then update alpha_private.responsibilities set status='rejected',updated_at=now() where id=r.id; end if;
   perform alpha_private.event(actor,case when m.status='approved' then 'Propuesta aprobada' else 'Propuesta negada' end,secret||' · '||yes_count||' a favor / '||no_count||' en contra');
   return jsonb_build_object('ok',true,'status',m.status);
 elsif p_action in ('trash','restore') then
   kind=p_payload->>'type';new_id=(p_payload->>'id')::uuid;
   if coalesce(kind,'') not in ('responsibility','incident','agreement') or new_id is null then return jsonb_build_object('error','Selecciona un elemento válido.','status',400); end if;
   if kind='responsibility' then
     select * into r from alpha_private.responsibilities where id=new_id;
     if not found then return jsonb_build_object('error','La función no está disponible.','status',404); end if;
     if (p_action='trash' and r.deleted_at is not null) or (p_action='restore' and r.deleted_at is null) then return jsonb_build_object('error','El elemento ya cambió. Actualiza la página.','status',409); end if;
     if p_action='trash' and (r.status='active' or exists(select 1 from alpha_private.motions where responsibility_id=r.id and status='discussion')) then return jsonb_build_object('error','Resuelvan la discusión o aprueben el retiro de la función antes de enviarla a papelera.','status',409); end if;
     if p_action='trash' then
       update alpha_private.motions set status='cancelled',decided_at=now() where responsibility_id=r.id and status='pending';
       update alpha_private.responsibilities set status=case when status='proposed' then 'cancelled' else status end,deleted_at=now() where id=r.id;
     else update alpha_private.responsibilities set deleted_at=null where id=r.id; end if;
     secret=r.title;
   elsif kind='incident' then
     update alpha_private.incidents set deleted_at=case when p_action='trash' then now() else null end where id=new_id and ((p_action='trash' and deleted_at is null) or (p_action='restore' and deleted_at is not null)) returning title into secret;
     if not found then return jsonb_build_object('error','El registro no está disponible o ya cambió.','status',409); end if;
   else
     update alpha_private.agreements set deleted_at=case when p_action='trash' then now() else null end where id=new_id and ((p_action='trash' and deleted_at is null) or (p_action='restore' and deleted_at is not null)) returning 'Acuerdo v'||version into secret;
     if not found then return jsonb_build_object('error','El acuerdo no está disponible o ya cambió.','status',409); end if;
   end if;
   perform alpha_private.event(actor,case when p_action='trash' then 'Enviado a papelera' else 'Restaurado de papelera' end,secret);
   return jsonb_build_object('ok',true);
 elsif p_action in ('measure','incident') then
   select * into r from alpha_private.responsibilities where id=(p_payload->>'responsibility_id')::uuid;
   if not found then return jsonb_build_object('error','La función no está disponible.','status',404); end if;
   if r.status<>'active' or r.deleted_at is not null then return jsonb_build_object('error','Solo se registran resultados de funciones vigentes.','status',409); end if;
   if p_action='measure' then
     if r.metric is null then return jsonb_build_object('error','Primero acuerden una métrica para esta función.','status',409); end if;
     if jsonb_typeof(p_payload->'actual') is distinct from 'number' or (p_payload->>'actual')::numeric not between 0 and 1000000000000
       or jsonb_typeof(p_payload->'period') is distinct from 'string' or char_length(btrim(p_payload->>'period')) not between 1 and 80
       or (p_payload ? 'note' and jsonb_typeof(p_payload->'note') is distinct from 'string') or char_length(coalesce(p_payload->>'note',''))>1200 then
       return jsonb_build_object('error','Indica periodo y resultado numérico válido; notas de hasta 1200 caracteres.','status',400); end if;
     insert into alpha_private.measurements(responsibility_id,title,owner,metric,period,actual,note,actor)
       values(r.id,r.title,r.owner,r.metric,btrim(p_payload->>'period'),(p_payload->>'actual')::numeric,btrim(coalesce(p_payload->>'note','')),actor) returning id into new_id;
     perform alpha_private.event(actor,'Métrica registrada',r.title||' · '||(p_payload->>'period')||' · '||(p_payload->>'actual')||' '||(r.metric->>'unit'));
   else
     if r.penalty='' then return jsonb_build_object('error','Primero acuerden la penalización de esta función por votación.','status',409); end if;
     if jsonb_typeof(p_payload->'detail') is distinct from 'string' or char_length(btrim(p_payload->>'detail')) not between 1 and 1200
       or coalesce(p_payload->>'occurred_on','') !~ '^\d{4}-\d{2}-\d{2}$' or (p_payload->>'occurred_on')::date>current_date then
       return jsonb_build_object('error','Describe el incumplimiento e indica una fecha válida que no sea futura.','status',400); end if;
     insert into alpha_private.incidents(responsibility_id,title,owner,penalty,occurred_on,detail,actor)
       values(r.id,r.title,r.owner,r.penalty,(p_payload->>'occurred_on')::date,btrim(p_payload->>'detail'),actor) returning id into new_id;
     perform alpha_private.event(actor,'Incumplimiento registrado',r.title||' · '||(p_payload->>'detail'));
   end if;
   return jsonb_build_object('id',new_id);
 elsif p_action='resolve_incident' then
   v=p_payload->>'status';reason=btrim(coalesce(p_payload->>'resolution',''));
   if coalesce(v,'') not in ('resolved','dismissed') or reason='' or char_length(reason)>1200 then return jsonb_build_object('error','Indica el resultado y cómo se resolvió (hasta 1200 caracteres).','status',400); end if;
   update alpha_private.incidents set status=v,resolution=reason,resolved_by=api.actor,resolved_at=now() where id=(p_payload->>'incident_id')::uuid and status='open' and deleted_at is null returning title into secret;
   if not found then return jsonb_build_object('error','El registro no existe o ya se cerró.','status',409); end if;
   perform alpha_private.event(actor,case when v='resolved' then 'Incumplimiento resuelto' else 'Incumplimiento descartado' end,secret||' · '||reason);
   return jsonb_build_object('ok',true);
 elsif p_action='change_key' then
   secret=btrim(coalesce(p_payload->>'key',''));v=p_payload->>'partner';
   if char_length(secret) not between 6 and 150 or not exists(select 1 from alpha_private.partners where slug=v) then return jsonb_build_object('error','Selecciona un socio y una clave de al menos 6 caracteres.','status',400); end if;
   if exists(select 1 from alpha_private.partners where slug<>v and key_hash=encode(extensions.digest(secret,'sha256'),'hex')) then return jsonb_build_object('error','Cada socio necesita una clave diferente para identificar sus votos.','status',409); end if;
   update alpha_private.partners set key_hash=encode(extensions.digest(secret,'sha256'),'hex') where slug=v;
   delete from alpha_private.sessions where partner=v and token_hash<>encode(extensions.digest(p_token,'sha256'),'hex');
   perform alpha_private.event(actor,'Clave de acceso cambiada',(select name from alpha_private.partners where slug=v));
   return jsonb_build_object('ok',true);
 elsif p_action='agreement' then
   if exists(select 1 from alpha_private.motions where responsibility_id is not null and status in ('pending','discussion')) then return jsonb_build_object('error','Resuelvan las votaciones y discusiones de funciones antes de generar el acuerdo final.','status',409); end if;
   snap=alpha_private.snapshot();
   if jsonb_array_length(snap->'responsibilities')=0 then return jsonb_build_object('error','Primero aprueben al menos una responsabilidad.','status',409); end if;
   digest_value=encode(extensions.digest(snap::text,'sha256'),'hex');
   select * into a from alpha_private.agreements where digest=digest_value;
   if not found then
     insert into alpha_private.agreements(version,revision,digest,snapshot,created_by) values((select coalesce(max(version),0)+1 from alpha_private.agreements),rev,digest_value,snap,actor) returning * into a;
     perform alpha_private.event(actor,'Acuerdo generado','Versión '||a.version||' · pendiente de firma de los tres socios');
   elsif a.deleted_at is not null then
     update alpha_private.agreements set deleted_at=null where id=a.id;
     perform alpha_private.event(actor,'Restaurado de papelera','Acuerdo v'||a.version);
   end if;
   return jsonb_build_object('id',a.id,'version',a.version);
 elsif p_action='agreement_data' then
   select * into a from alpha_private.agreements where id=(p_payload->>'agreement_id')::uuid and deleted_at is null;
   if not found then return jsonb_build_object('error','El acuerdo no está disponible.','status',404); end if;
   return jsonb_build_object('id',a.id,'version',a.version,'revision',a.revision,'created_at',a.created_at,'digest',a.digest,'snapshot',a.snapshot);
 elsif p_action='backup' then
   return jsonb_build_object('exported_at',now(),'measurements',coalesce((select jsonb_agg(to_jsonb(x)) from alpha_private.measurements x),'[]'::jsonb),'incidents',coalesce((select jsonb_agg(to_jsonb(x)) from alpha_private.incidents x),'[]'::jsonb),'responsibilities',coalesce((select jsonb_agg(alpha_private.responsibility_json(r1)||jsonb_build_object('deleted_at',r1.deleted_at)) from alpha_private.responsibilities r1),'[]'::jsonb),'motions',coalesce((select jsonb_agg(alpha_private.motion_json(m1)) from alpha_private.motions m1),'[]'::jsonb),'agreements',coalesce((select jsonb_agg(to_jsonb(a1)) from alpha_private.agreements a1),'[]'::jsonb),'events',coalesce((select jsonb_agg(to_jsonb(e1)) from alpha_private.events e1),'[]'::jsonb));
 end if;
 return jsonb_build_object('error','Acción no disponible.','status',404);
exception
 when sqlstate 'P0001' then return jsonb_build_object('error',sqlerrm,'status',400);
 when unique_violation then return jsonb_build_object('error','Ya existe una operación equivalente. Actualiza antes de continuar.','status',409);
 when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range or not_null_violation or foreign_key_violation or check_violation then return jsonb_build_object('error','Revisa los datos de la solicitud.','status',400);
end;$$;
revoke all on all functions in schema alpha_private from public,anon,authenticated;
revoke all on function public.alpha_api(text,text,jsonb) from public;
grant execute on function public.alpha_api(text,text,jsonb) to anon,authenticated;
