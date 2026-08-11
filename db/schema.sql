-- This file defines the database schema for SpotMe. It uses PostgreSQL syntax and is meant to be run with Supabase.
-- Supabase Query Name will be shown in the comment above each query


-- Gym and User Profile Schema


-- Reference list of gyms
create table gyms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  outlet      text not null,
  region      text,
  created_at  timestamptz not null default now(),
  unique (name, outlet)
);

-- One row per user. PK = the Clerk user ID.
create type experience_level as enum ('beginner', 'intermediate', 'advanced');

create table profiles (
  clerk_user_id  text primary key,
  display_name   text not null,
  age            int check (age between 13 and 120),
  experience     experience_level not null default 'beginner',
  bio            text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Many-to-many: which gyms each user trains at
create table user_gyms (
  clerk_user_id  text references profiles(clerk_user_id) on delete cascade,
  gym_id         uuid references gyms(id) on delete cascade,
  primary key (clerk_user_id, gym_id)
);

-- Seed a few Singapore gyms so the form has options
insert into gyms (name, outlet, region) values
  ('ActiveSG',        'Bishan',        'Central'),
  ('ActiveSG',        'Tampines',      'East'),
  ('Anytime Fitness', 'Tampines',      'East'),
  ('Anytime Fitness', 'Bukit Timah',   'Central'),
  ('Fitness First',   'Raffles Place', 'Central'),
  ('Virgin Active',   'Marina One',    'Central');




-- Add Gender Enum to Profiles


-- Create the gender type with the three allowed values
create type gender_type as enum ('male', 'female', 'non-binary');

-- Add the column to profiles
alter table profiles add column gender gender_type;




-- feat: Matchmaking database updates - avail+connect+workout_style


-- 1. Workout style: a fixed set of training styles
create type workout_style_type as enum (
  'powerlifting', 'bodybuilding', 'hiit', 'calisthenics', 'crossfit', 'general', 'no_preference'
);

alter table profiles add column workout_style workout_style_type;

-- 2. Availability: a day-of-week + time-of-day grid.
--    Each selected slot is one row, so a user can have many.
create type time_of_day_type as enum ('morning', 'afternoon', 'evening');

create table availability (
  id             uuid primary key default gen_random_uuid(),
  clerk_user_id  text references profiles(clerk_user_id) on delete cascade,
  day_of_week    int  check (day_of_week between 0 and 6),  -- 0 = Sunday
  time_of_day    time_of_day_type not null,
  unique (clerk_user_id, day_of_week, time_of_day)          -- no duplicate slots
);

-- 3. Matches: a connection request between two users, with status.
create type match_status as enum ('pending', 'accepted', 'declined');

create table matches (
  id            uuid primary key default gen_random_uuid(),
  initiator_id  text references profiles(clerk_user_id) on delete cascade,
  recipient_id  text references profiles(clerk_user_id) on delete cascade,
  status        match_status not null default 'pending',
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  check (initiator_id <> recipient_id),                     -- can't match yourself
  unique (initiator_id, recipient_id)                       -- one request per direction
);

-- feat: real Singapore gym data with coordinates (replaces placeholder seed)

drop table if exists gyms cascade;

create table gyms (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  chain        text not null,
  postal_code  text not null,                               -- text, NOT int: preserves leading zeros (e.g. 098803)
  latitude     double precision,                            -- filled by seed script via OneMap; null until geocoded
  longitude    double precision,
  created_at   timestamptz not null default now(),
  unique (name, postal_code)                                -- a gym is identified by name + where it is
);

-- feat: add match preferences to profiles
-- Empty array = no preference (accept all). Reuses existing enums as arrays.
alter table profiles
  add column preferred_experience experience_level[]   not null default '{}',
  add column preferred_gender     gender_type[]         not null default '{}',
  add column preferred_styles     workout_style_type[]  not null default '{}';

-- Clear any orphaned rows first (gym_id values no longer in gyms)
delete from user_gyms
where gym_id not in (select id from gyms);

-- Re-add the FK with cascade delete (remove a gym -> remove its links)
alter table user_gyms
  add constraint user_gyms_gym_id_fkey
  foreign key (gym_id) references gyms(id) on delete cascade;


-- Chatroom and Messaging
 
-- Conversation, NULL if 1:1 convo, else name provided
create table if not exists chatrooms (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  created_at  timestamptz not null default now(),
  pair_key    text
);

-- One 1:1 room per pair; groups (pair_key null) are exempt.
create unique index if not exists idx_chatrooms_pair_key
  on chatrooms (pair_key) where pair_key is not null;
 
-- Which users are in which chatroom
create table if not exists chatroom_members (
  chatroom_id   uuid not null references chatrooms(id) on delete cascade,
  clerk_user_id text not null references profiles(clerk_user_id) on delete cascade,
  joined_at     timestamptz not null default now(),
  added_by      text references profiles(clerk_user_id) on delete set null,
  is_admin      boolean not null default false,  -- unused, legacy of retired adminship model, dormant
  primary key (chatroom_id, clerk_user_id)
);

-- Individual messages, each belonging to one chatroom
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  chatroom_id uuid not null references chatrooms(id) on delete cascade,
  sender_id   text references profiles(clerk_user_id) on delete cascade,
  content     text not null check (char_length(content) between 1 and 2000),
  created_at  timestamptz not null default now()
  type        text not null default 'user' check (type in ('user','system')),
);
 
create index if not exists idx_messages_chatroom_created
  on messages (chatroom_id, created_at);
create index if not exists idx_chatroom_members_user
  on chatroom_members (clerk_user_id);

alter publication supabase_realtime add table messages;

-- feat: profile photos (stored in private Supabase Storage bucket)
-- Stores the storage PATH, not a URL -since signed view URLs are generated on demand
-- (they expire). Nullable: users without a photo get a placeholder avatar.
alter table profiles add column photo_path text;

-- feat: match radius (in km) for distance-based filtering
alter table profiles add column match_radius_km int not null default 5;

-- workout_sessions: one row per training session (a "day's workout")
create table workout_sessions (
  id            uuid primary key default gen_random_uuid(),
  clerk_user_id text not null references profiles(clerk_user_id) on delete cascade,
  performed_on  date not null,
  notes         text,
  created_at    timestamptz not null default now()
);

-- workout_sets: one row per set, belonging to a session
create table workout_sets (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references workout_sessions(id) on delete cascade,
  exercise_name text not null check (char_length(exercise_name) between 1 and 100),
  set_index     int not null check (set_index >= 1),
  reps          int not null check (reps between 1 and 1000),
  weight_kg     numeric not null check (weight_kg >= 0),
  created_at    timestamptz not null default now()
);

-- fast history loads, newest session first
create index idx_workout_sessions_user_date
  on workout_sessions (clerk_user_id, performed_on desc);

-- fast set lookups when assembling a session's sets
create index idx_workout_sets_session
  on workout_sets (session_id);

-- fix: distinguish same-name exercises within a session
-- exercise_index = which exercise block within the session (1-based)
-- Sibling of set_index (which set within that block). Backfilled to 1 for
-- existing rows, then default dropped so inserts must be explicit.
alter table workout_sets
  add column exercise_index int not null default 1 check (exercise_index >= 1);

alter table workout_sets alter column exercise_index drop default;

-- normalise existing exercise names
update workout_sets
set exercise_name = initcap(exercise_name);

-- added schedule_sessions table and status column
create type session_status as enum ('proposed', 'confirmed', 'cancelled', 'completed');

create table scheduled_sessions (
  id uuid primary key default gen_random_uuid(),
  chatroom_id uuid not null references chatrooms(id) on delete cascade,
  proposer_id text not null references profiles(clerk_user_id) on delete cascade,
  gym_id uuid references gyms(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status session_status not null default 'proposed',
  calendar_synced boolean not null default false,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint session_ends_after_start check (ends_at > starts_at)
);

create index idx_scheduled_sessions_chatroom on scheduled_sessions (chatroom_id, starts_at);
create index idx_scheduled_sessions_status on scheduled_sessions (status, ends_at);

create table ratings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references scheduled_sessions(id) on delete cascade,
  rater_id text not null references profiles(clerk_user_id) on delete cascade,
  ratee_id text not null references profiles(clerk_user_id) on delete cascade,
  score int not null check (score between 1 and 5),
  review text check (review is null or char_length(review) <= 1000),
  created_at timestamptz not null default now(),
  constraint no_self_rating check (rater_id <> ratee_id),
  constraint one_rating_per_pair_per_session unique (session_id, rater_id, ratee_id)
);

create index idx_ratings_ratee on ratings (ratee_id);
create index idx_ratings_session_rater on ratings (session_id, rater_id);

-- feat: moderation and consent-based data collection

-- 1. Reports: one user reporting another.
create type report_status as enum ('open', 'actioned', 'dismissed');

create table reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     text not null references profiles(clerk_user_id) on delete cascade,
  reported_id     text not null references profiles(clerk_user_id) on delete cascade,
  reason          text not null check (char_length(reason) between 1 and 1000),
  status          report_status not null default 'open',
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     text references profiles(clerk_user_id) on delete set null,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  constraint no_self_report check (reporter_id <> reported_id)
);

-- One open report per pair.
create unique index idx_reports_open_pair
  on reports (reporter_id, reported_id) where status = 'open';

create index idx_reports_status_created on reports (status, created_at desc);
create index idx_reports_reported       on reports (reported_id);

-- 2. Moderation actions: append-only audit log.
create type moderation_action_type as enum ('warning', 'suspension', 'lift');

create table moderation_actions (
  id             uuid primary key default gen_random_uuid(),
  target_user_id text not null references profiles(clerk_user_id) on delete cascade,
  admin_id       text references profiles(clerk_user_id) on delete set null,
  action         moderation_action_type not null,
  reason         text not null check (char_length(reason) between 1 and 1000),
  expires_at     timestamptz,                                  -- null for warning and lift
  report_id      uuid references reports(id) on delete set null, -- null if raised by a rating flag
  created_at     timestamptz not null default now(),
  constraint suspension_has_expiry check (
    (action =  'suspension' and expires_at is not null) or
    (action <> 'suspension' and expires_at is null)
  )
);

create index idx_moderation_actions_target
  on moderation_actions (target_user_id, created_at desc);

-- 3. Consent to anonymised data collection.
alter table profiles
  add column data_consent    boolean not null default false,
  add column data_consent_at timestamptz;

select table_name from information_schema.tables
where table_name in ('reports', 'moderation_actions');

select column_name from information_schema.columns
where table_name = 'profiles' and column_name like 'data_consent%';

create table session_confirmations (
  session_id   uuid not null references scheduled_sessions(id) on delete cascade,
  user_id      text not null references profiles(clerk_user_id) on delete cascade,
  status       text not null default 'going' check (status in ('going', 'out')),
  responded_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create index idx_session_confirmations_user
  on session_confirmations (user_id);

-- Every session's proposer was going at propose time.
insert into session_confirmations (session_id, user_id, status, responded_at)
select s.id, s.proposer_id, 'going', coalesce(s.created_at, now())
from scheduled_sessions s
on conflict do nothing;

-- Approximation: for sessions that reached confirmed or completed,
-- credit every room member as going. Who actually confirmed was never
-- recorded - responded_at exists, but not the responder.
insert into session_confirmations (session_id, user_id, status, responded_at)
select s.id, cm.clerk_user_id, 'going', coalesce(s.responded_at, s.created_at, now())
from scheduled_sessions s
join chatroom_members cm on cm.chatroom_id = s.chatroom_id
where s.status in ('confirmed', 'completed')
on conflict do nothing;