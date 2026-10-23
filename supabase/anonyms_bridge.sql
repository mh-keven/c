-- Anonyms bridge tables for the existing Keven/Zubii Apps Script session system.
-- Apply in Supabase SQL Editor. Browser clients cannot access these tables directly.
begin;
create table if not exists public.anonyms_messages (
 id uuid primary key default gen_random_uuid(),
 username text not null check(username in ('Keven','Zubii')),
 message text not null default '',
 media_type text not null default 'text' check(media_type in ('text','audio')),
 media_path text,
 duration_seconds integer,
 created_at timestamptz not null default now(),
 constraint anonyms_messages_content_check check (
   (media_type='text' and char_length(btrim(message)) between 1 and 2000 and media_path is null)
   or (media_type='audio' and media_path is not null and message='Voice note')
 )
);
create index if not exists anonyms_messages_created_idx on public.anonyms_messages(created_at asc);
alter table public.anonyms_messages enable row level security;
revoke all on public.anonyms_messages from anon, authenticated;
grant all on public.anonyms_messages to service_role;

create table if not exists public.anonyms_gallery_likes (
 id uuid primary key default gen_random_uuid(),
 gallery_id text not null,
 username text not null check(username in ('Keven','Zubii')),
 created_at timestamptz not null default now(),
 unique(gallery_id,username)
);
create index if not exists anonyms_gallery_likes_item_idx on public.anonyms_gallery_likes(gallery_id);
alter table public.anonyms_gallery_likes enable row level security;
revoke all on public.anonyms_gallery_likes from anon, authenticated;
grant all on public.anonyms_gallery_likes to service_role;

create table if not exists public.anonyms_gallery_comments (
 id uuid primary key default gen_random_uuid(),
 gallery_id text not null,
 username text not null check(username in ('Keven','Zubii')),
 comment text not null check(char_length(btrim(comment)) between 1 and 1000),
 created_at timestamptz not null default now()
);
create index if not exists anonyms_gallery_comments_item_created_idx on public.anonyms_gallery_comments(gallery_id,created_at);
alter table public.anonyms_gallery_comments enable row level security;
revoke all on public.anonyms_gallery_comments from anon, authenticated;
grant all on public.anonyms_gallery_comments to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('anonyms-voice-notes','anonyms-voice-notes',false,52428800,array['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/aac','audio/wav','audio/x-m4a'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Anonyms backend only voice objects" on storage.objects;
create policy "Anonyms backend only voice objects" on storage.objects for all to service_role
using(bucket_id='anonyms-voice-notes') with check(bucket_id='anonyms-voice-notes');
commit;
