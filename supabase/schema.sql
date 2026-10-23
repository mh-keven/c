-- Anonyms fresh Supabase foundation.
-- Uses Supabase Auth identities. This does NOT migrate Google Sheets/Drive data
-- or switch the deployed frontend away from Apps Script.
-- Create/link the two approved Auth users to chat_profiles through a trusted setup step.
begin;

create table if not exists public.chat_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username in ('Keven','Zubii')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
alter table public.chat_profiles enable row level security;
alter table public.chat_profiles force row level security;
drop policy if exists "members read profiles" on public.chat_profiles;
create policy "members read profiles" on public.chat_profiles for select to authenticated
using (true); -- Only the two approved profiles can be inserted by the trusted setup step.
drop policy if exists "update own presence" on public.chat_profiles;
create policy "update own presence" on public.chat_profiles for update to authenticated
using (user_id=auth.uid()) with check (user_id=auth.uid());
revoke all on public.chat_profiles from anon, authenticated;
grant select, update on public.chat_profiles to authenticated;

create table if not exists public.messages (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references public.chat_profiles(user_id) on delete cascade,
 message text not null default '',
 media_type text not null default 'text' check(media_type in ('text','audio')),
 audio_path text,
 audio_seconds integer,
 created_at timestamptz not null default now(),
 constraint messages_content_check check (
  (media_type='text' and char_length(btrim(message)) between 1 and 2000 and audio_path is null and audio_seconds is null)
  or (media_type='audio' and message='' and audio_path is not null and audio_seconds between 1 and 300)
 )
);
create index if not exists messages_created_at_idx on public.messages(created_at desc,id desc);
alter table public.messages enable row level security;
alter table public.messages force row level security;
drop policy if exists "members read messages" on public.messages;
create policy "members read messages" on public.messages for select to authenticated
using (exists(select 1 from public.chat_profiles p where p.user_id=auth.uid()));
drop policy if exists "send own messages" on public.messages;
create policy "send own messages" on public.messages for insert to authenticated
with check(user_id=auth.uid() and exists(select 1 from public.chat_profiles p where p.user_id=auth.uid())
and (audio_path is null or split_part(audio_path,'/',1)=auth.uid()::text));
drop policy if exists "delete own messages" on public.messages;
create policy "delete own messages" on public.messages for delete to authenticated using(user_id=auth.uid());
revoke all on public.messages from anon;
grant select,insert,delete on public.messages to authenticated;

-- Gallery metadata only; original private media stays in Google Drive.
create table if not exists public.gallery_items (
 id text primary key,
 uploader_id uuid not null default auth.uid() references public.chat_profiles(user_id) on delete cascade,
 title text not null default '' check(char_length(title)<=120),
 caption text not null default '' check(char_length(caption)<=500),
 media_type text not null check(media_type in ('image','video')),
 source text not null check(source in ('drive','youtube')),
 drive_file_id text,
 youtube_id text,
 mime_type text,
 created_at timestamptz not null default now(),
 check((source='drive' and drive_file_id is not null and youtube_id is null) or
       (source='youtube' and youtube_id is not null and drive_file_id is null))
);
create index if not exists gallery_items_created_at_idx on public.gallery_items(created_at desc);
alter table public.gallery_items enable row level security;
alter table public.gallery_items force row level security;
drop policy if exists "members read gallery" on public.gallery_items;
create policy "members read gallery" on public.gallery_items for select to authenticated
using(exists(select 1 from public.chat_profiles p where p.user_id=auth.uid()));
drop policy if exists "add gallery metadata" on public.gallery_items;
create policy "add gallery metadata" on public.gallery_items for insert to authenticated
with check(uploader_id=auth.uid() and exists(select 1 from public.chat_profiles p where p.user_id=auth.uid()));
drop policy if exists "delete own gallery metadata" on public.gallery_items;
create policy "delete own gallery metadata" on public.gallery_items for delete to authenticated using(uploader_id=auth.uid());
revoke all on public.gallery_items from anon;
grant select,insert,delete on public.gallery_items to authenticated;

create table if not exists public.gallery_likes (
 gallery_item_id text not null references public.gallery_items(id) on delete cascade,
 user_id uuid not null default auth.uid() references public.chat_profiles(user_id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(gallery_item_id,user_id)
);
alter table public.gallery_likes enable row level security;
alter table public.gallery_likes force row level security;
drop policy if exists "read gallery likes" on public.gallery_likes;
create policy "read gallery likes" on public.gallery_likes for select to authenticated using(exists(select 1 from public.chat_profiles p where p.user_id=auth.uid()));
drop policy if exists "add own gallery likes" on public.gallery_likes;
create policy "add own gallery likes" on public.gallery_likes for insert to authenticated with check(user_id=auth.uid());
drop policy if exists "remove own gallery likes" on public.gallery_likes;
create policy "remove own gallery likes" on public.gallery_likes for delete to authenticated using(user_id=auth.uid());
revoke all on public.gallery_likes from anon;
grant select,insert,delete on public.gallery_likes to authenticated;

create table if not exists public.gallery_comments (
 id uuid primary key default gen_random_uuid(),
 gallery_item_id text not null references public.gallery_items(id) on delete cascade,
 user_id uuid not null default auth.uid() references public.chat_profiles(user_id) on delete cascade,
 comment text not null check(char_length(btrim(comment)) between 1 and 1000),
 created_at timestamptz not null default now()
);
create index if not exists gallery_comments_item_created_idx on public.gallery_comments(gallery_item_id,created_at);
alter table public.gallery_comments enable row level security;
alter table public.gallery_comments force row level security;
drop policy if exists "read gallery comments" on public.gallery_comments;
create policy "read gallery comments" on public.gallery_comments for select to authenticated using(exists(select 1 from public.chat_profiles p where p.user_id=auth.uid()));
drop policy if exists "add own gallery comments" on public.gallery_comments;
create policy "add own gallery comments" on public.gallery_comments for insert to authenticated with check(user_id=auth.uid());
drop policy if exists "delete own gallery comments" on public.gallery_comments;
create policy "delete own gallery comments" on public.gallery_comments for delete to authenticated using(user_id=auth.uid());
revoke all on public.gallery_comments from anon;
grant select,insert,delete on public.gallery_comments to authenticated;

-- Call invitation metadata only; this does not transport call audio/video.
create table if not exists public.call_sessions (
 id uuid primary key default gen_random_uuid(),
 caller_id uuid not null default auth.uid() references public.chat_profiles(user_id) on delete cascade,
 callee_id uuid not null references public.chat_profiles(user_id) on delete cascade,
 status text not null default 'ringing' check(status in ('ringing','accepted','declined','ended','missed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 ended_at timestamptz,
 check(caller_id<>callee_id)
);
create index if not exists call_sessions_created_idx on public.call_sessions(created_at desc);
alter table public.call_sessions enable row level security;
alter table public.call_sessions force row level security;
drop policy if exists "read participant calls" on public.call_sessions;
create policy "read participant calls" on public.call_sessions for select to authenticated using(auth.uid()=caller_id or auth.uid()=callee_id);
drop policy if exists "create calls as self" on public.call_sessions;
create policy "create calls as self" on public.call_sessions for insert to authenticated with check(caller_id=auth.uid() and exists(select 1 from public.chat_profiles p where p.user_id=callee_id));
drop policy if exists "update participant calls" on public.call_sessions;
create policy "update participant calls" on public.call_sessions for update to authenticated using(auth.uid()=caller_id or auth.uid()=callee_id) with check(auth.uid()=caller_id or auth.uid()=callee_id);
revoke all on public.call_sessions from anon;
grant select,insert,update on public.call_sessions to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('voice-notes','voice-notes',false,10485760,array['audio/mp4','audio/webm','audio/ogg','audio/mpeg','audio/aac','audio/x-m4a'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "members read voice notes" on storage.objects;
create policy "members read voice notes" on storage.objects for select to authenticated using(bucket_id='voice-notes' and exists(select 1 from public.chat_profiles p where p.user_id=auth.uid()));
drop policy if exists "upload own voice notes" on storage.objects;
create policy "upload own voice notes" on storage.objects for insert to authenticated with check(bucket_id='voice-notes' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.chat_profiles p where p.user_id=auth.uid()));
drop policy if exists "delete own voice notes" on storage.objects;
create policy "delete own voice notes" on storage.objects for delete to authenticated using(bucket_id='voice-notes' and (storage.foldername(name))[1]=auth.uid()::text);

do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then alter publication supabase_realtime add table public.messages; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='gallery_likes') then alter publication supabase_realtime add table public.gallery_likes; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='gallery_comments') then alter publication supabase_realtime add table public.gallery_comments; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='call_sessions') then alter publication supabase_realtime add table public.call_sessions; end if;
end $$;
commit;
