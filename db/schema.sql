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