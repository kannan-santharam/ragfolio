-- =============================================================================
-- Ragfolio — Supabase schema
-- Run once: `npx ragfolio init` applies it for you, or paste it into the
-- Supabase SQL Editor (Dashboard -> SQL Editor -> New query). Idempotent.
-- =============================================================================

create extension if not exists vector;

-- -----------------------------------------------------------------------------
-- documents: one row per uploaded file or pasted text blob
-- -----------------------------------------------------------------------------
create table if not exists documents (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null,
  filename     text not null,
  mime         text not null,
  source_kind  text not null check (source_kind in ('pdf', 'docx', 'text', 'markdown', 'paste')),
  page_count   int,
  char_count   int not null default 0,
  chunk_count  int not null default 0,
  outline      jsonb not null default '[]'::jsonb,
  -- SHA-256 of the ingested text, so a seed run can skip documents that have
  -- not changed instead of re-spending embedding quota on them.
  content_hash text,
  created_at   timestamptz not null default now()
);

create index if not exists documents_session_idx on documents (session_id, created_at desc);

-- Older installs predate content_hash; add it without failing on a fresh one.
alter table documents add column if not exists content_hash text;

-- -----------------------------------------------------------------------------
-- chunks: embedded slices of a document
--
-- 768 dims for both providers: gemini-embedding-001 is a Matryoshka model
-- (truncate + renormalise is supported), text-embedding-3-small shortens
-- natively via `dimensions`, and pgvector's HNSW index refuses anything above
-- 2000 dims. One table cannot serve two dimensions, so the width is pinned.
-- -----------------------------------------------------------------------------
create table if not exists chunks (
  id           bigserial primary key,
  document_id  uuid not null references documents(id) on delete cascade,
  session_id   uuid not null,
  ordinal      int not null,
  heading      text,
  page_from    int,
  page_to      int,
  content      text not null,
  token_est    int not null default 0,
  embedding    vector(768) not null
);

create index if not exists chunks_session_idx  on chunks (session_id);
create index if not exists chunks_document_idx on chunks (document_id, ordinal);

-- Cosine HNSW. m/ef_construction are the pgvector defaults; fine at this scale.
create index if not exists chunks_embedding_idx
  on chunks using hnsw (embedding vector_cosine_ops);

-- -----------------------------------------------------------------------------
-- match_chunks: cosine similarity search, always scoped to one session.
--
-- The session filter is inside the function rather than left to the caller so a
-- forgotten `.eq('session_id', ...)` cannot leak one visitor's upload into
-- another visitor's answers.
-- -----------------------------------------------------------------------------
create or replace function match_chunks (
  query_embedding vector(768),
  p_session_id    uuid,
  match_count     int   default 6,
  min_similarity  float default 0.0,
  p_document_id   uuid  default null
)
returns table (
  id          bigint,
  document_id uuid,
  filename    text,
  ordinal     int,
  heading     text,
  page_from   int,
  page_to     int,
  content     text,
  similarity  float
)
language sql stable
as $$
  select
    c.id,
    c.document_id,
    d.filename,
    c.ordinal,
    c.heading,
    c.page_from,
    c.page_to,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  join documents d on d.id = c.document_id
  where c.session_id = p_session_id
    and (p_document_id is null or c.document_id = p_document_id)
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit least(match_count, 20);
$$;

-- -----------------------------------------------------------------------------
-- rate_limits: fixed-window counter. Keyed by a hashed caller identity (an IP
-- hash shaped like a uuid), because the browser-generated session id can be
-- rotated at will.
-- -----------------------------------------------------------------------------
create table if not exists rate_limits (
  session_id   uuid not null,
  bucket       text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (session_id, bucket, window_start)
);

create or replace function bump_rate_limit (
  p_session_id  uuid,
  p_bucket      text,
  p_window_secs int,
  p_limit       int
)
returns table (allowed boolean, remaining int, resets_at timestamptz)
language plpgsql
as $$
declare
  w_start timestamptz;
  new_count int;
begin
  w_start := to_timestamp(floor(extract(epoch from now()) / p_window_secs) * p_window_secs);

  insert into rate_limits (session_id, bucket, window_start, count)
  values (p_session_id, p_bucket, w_start, 1)
  on conflict (session_id, bucket, window_start)
    do update set count = rate_limits.count + 1
  returning rate_limits.count into new_count;

  return query select
    new_count <= p_limit,
    greatest(p_limit - new_count, 0),
    w_start + make_interval(secs => p_window_secs);
end;
$$;

-- -----------------------------------------------------------------------------
-- model_health: which chat models are currently rate-limited or unresponsive,
-- and until when. In Postgres rather than process memory because serverless
-- instances do not share memory: a cooldown learned by one instance would
-- otherwise be rediscovered — at the cost of a wasted round trip — by every
-- other instance, on every request, all day.
--
-- Keyed by key fingerprint as well as model: quotas are per project, so one
-- visitor exhausting their own key says nothing about the owner's.
-- -----------------------------------------------------------------------------
create table if not exists model_health (
  fingerprint    text not null,
  model          text not null,
  cooldown_until timestamptz not null,
  reason         text not null,
  primary key (fingerprint, model)
);

-- -----------------------------------------------------------------------------
-- purge_expired: anonymous visitor data is disposable. Schedule from Supabase
-- Cron (Database -> Cron), e.g. hourly: select purge_expired();
-- The shared (seeded) namespace is never purged.
-- -----------------------------------------------------------------------------
create or replace function purge_expired (older_than interval default interval '24 hours')
returns int
language plpgsql
as $$
declare
  removed int;
begin
  with gone as (
    delete from documents
    where created_at < now() - older_than
      and session_id <> '00000000-0000-4000-8000-000000000001'
    returning 1
  )
  select count(*) into removed from gone;

  delete from rate_limits where window_start < now() - interval '1 day';
  delete from model_health where cooldown_until < now() - interval '1 day';
  return removed;
end;
$$;

-- -----------------------------------------------------------------------------
-- telemetry_counts: only used when this deployment is a telemetry RECEIVER
-- (RAGFOLIO_TELEMETRY_RECEIVER=1). Adopters never need rows here.
-- -----------------------------------------------------------------------------
create table if not exists telemetry_counts (
  day          date not null,
  origin_hash  text not null,
  version      text not null,
  event        text not null,
  count        int  not null default 0,
  primary key (day, origin_hash, version, event)
);

create or replace function bump_telemetry (
  p_origin_hash text,
  p_version     text,
  p_event       text
)
returns void
language sql
as $$
  insert into telemetry_counts (day, origin_hash, version, event, count)
  values (current_date, p_origin_hash, p_version, p_event, 1)
  on conflict (day, origin_hash, version, event)
    do update set count = telemetry_counts.count + 1;
$$;

-- -----------------------------------------------------------------------------
-- RLS: the app talks to Postgres exclusively through the service-role key from
-- server-side route handlers, and the browser never holds a Supabase key. RLS is
-- enabled with no permissive policy so that an accidentally-leaked anon key
-- still reads nothing.
-- -----------------------------------------------------------------------------
alter table documents        enable row level security;
alter table chunks           enable row level security;
alter table rate_limits      enable row level security;
alter table model_health     enable row level security;
alter table telemetry_counts enable row level security;
