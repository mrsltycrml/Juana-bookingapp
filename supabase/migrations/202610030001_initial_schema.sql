create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.app_role as enum ('CLIENT', 'ADMIN', 'FRONT_DESK', 'PRACTITIONER');
create type public.appointment_status as enum (
  'TEMPORARILY_RESERVED', 'BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'
);
create type public.payment_status as enum (
  'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'CLIENT',
  full_name text not null,
  email text not null unique,
  mobile_number text,
  avatar_path text,
  is_active boolean not null default true,
  terms_accepted_at timestamptz,
  privacy_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_name_not_blank check (length(trim(full_name)) > 0)
);

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and not (public.is_admin() or auth.role() = 'service_role') then
    raise exception using errcode = '42501', message = 'Only an administrator can change account roles.';
  end if;
  if (new.email is distinct from old.email or new.is_active is distinct from old.is_active
      or new.terms_accepted_at is distinct from old.terms_accepted_at
      or new.privacy_accepted_at is distinct from old.privacy_accepted_at)
      and not (public.is_admin() or auth.role() = 'service_role') then
    raise exception using errcode = '42501', message = 'Only an administrator can change account email or active status.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger profiles_role_guard before update on public.profiles
  for each row execute procedure public.prevent_role_escalation();

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  category text not null,
  image_path text,
  price_amount numeric(12,2) not null check (price_amount >= 0),
  currency text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  requires_consent boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.practitioners (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete restrict,
  display_name text not null,
  bio text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.practitioner_services (
  practitioner_id uuid not null references public.practitioners(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (practitioner_id, service_id)
);

create table public.availability_schedules (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioners(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  break_starts_at time,
  break_ends_at time,
  is_working boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (opens_at < closes_at),
  check ((break_starts_at is null and break_ends_at is null) or
         (break_starts_at is not null and break_ends_at is not null and
          opens_at <= break_starts_at and break_starts_at < break_ends_at and break_ends_at <= closes_at)),
  unique (practitioner_id, weekday)
);

create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references public.practitioners(id) on delete cascade,
  exception_date date not null,
  is_working boolean not null default false,
  opens_at time,
  closes_at time,
  break_starts_at time,
  break_ends_at time,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_working = false) or (opens_at is not null and closes_at is not null and opens_at < closes_at)),
  check ((break_starts_at is null and break_ends_at is null) or
         (is_working and break_starts_at is not null and break_ends_at is not null
          and opens_at <= break_starts_at and break_starts_at < break_ends_at and break_ends_at <= closes_at)),
  unique (practitioner_id, exception_date)
);

create table public.blocked_periods (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid references public.practitioners(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete restrict,
  practitioner_id uuid not null references public.practitioners(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'TEMPORARILY_RESERVED',
  reservation_expires_at timestamptz,
  service_snapshot jsonb not null,
  cancellation_reason text,
  source text not null default 'ONLINE' check (source in ('ONLINE', 'WALK_IN', 'STAFF')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at),
  check ((status = 'TEMPORARILY_RESERVED' and reservation_expires_at is not null) or status <> 'TEMPORARILY_RESERVED')
);
create index appointments_customer_time_idx on public.appointments(customer_id, starts_at desc);
create index appointments_practitioner_time_idx on public.appointments(practitioner_id, starts_at);
create index appointments_status_idx on public.appointments(status, starts_at);

create table public.appointment_status_history (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  previous_status public.appointment_status,
  new_status public.appointment_status not null,
  changed_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create table public.consent_forms (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references public.services(id) on delete restrict,
  title text not null,
  description text not null default '',
  is_active boolean not null default false,
  current_version_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.consent_form_versions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.consent_forms(id) on delete restrict,
  version integer not null check (version > 0),
  questions jsonb not null default '[]'::jsonb,
  agreements jsonb not null default '[]'::jsonb,
  requires_signature boolean not null default false,
  published_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (form_id, version)
);
alter table public.consent_forms add constraint consent_form_current_version_fk
  foreign key (current_version_id) references public.consent_form_versions(id) on delete restrict;

create table public.consent_submissions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete restrict,
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  form_id uuid not null references public.consent_forms(id) on delete restrict,
  form_version_id uuid not null references public.consent_form_versions(id) on delete restrict,
  answers jsonb not null,
  signature text,
  agreed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (appointment_id, form_version_id)
);

create table public.treatment_records (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete restrict,
  appointment_id uuid not null unique references public.appointments(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  practitioner_id uuid not null references public.practitioners(id) on delete restrict,
  treatment_date timestamptz not null,
  details text not null,
  areas_treated text[] not null default '{}',
  products_used text[] not null default '{}',
  notes text,
  follow_up_recommendations text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status public.payment_status not null default 'PENDING',
  provider text not null check (provider in ('PAYMONGO', 'XENDIT', 'MANUAL')),
  provider_reference text unique,
  checkout_url text,
  expires_at timestamptz,
  manual_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index payments_one_paid_per_appointment
  on public.payments(appointment_id) where status = 'PAID';
create index payments_appointment_idx on public.payments(appointment_id);
create unique index payments_one_pending_per_appointment_idx on public.payments(appointment_id) where status = 'PENDING';
create unique index payments_manual_reference_idx on public.payments(manual_reference)
  where provider = 'MANUAL' and manual_reference is not null;

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  provider_event_id text unique,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  title text not null,
  body text not null,
  type text not null,
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_profile_created_idx on public.notifications(profile_id, created_at desc);
create unique index notifications_profile_appointment_type_idx on public.notifications(profile_id, appointment_id, type);

create table public.notification_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  push_enabled boolean not null default true,
  email_enabled boolean not null default true,
  appointment_reminders boolean not null default true,
  marketing_enabled boolean not null default false,
  expo_push_token text,
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.reject_historical_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'Historical records cannot be changed or deleted.';
end;
$$;

create trigger consent_versions_immutable before update or delete on public.consent_form_versions
  for each row execute procedure public.reject_historical_mutation();
create trigger consent_submissions_immutable before update or delete on public.consent_submissions
  for each row execute procedure public.reject_historical_mutation();
create trigger appointment_status_history_immutable before update or delete on public.appointment_status_history
  for each row execute procedure public.reject_historical_mutation();
create trigger treatment_records_immutable before update or delete on public.treatment_records
  for each row execute procedure public.reject_historical_mutation();

do $$
declare
  t text;
begin
  foreach t in array array[
    'services','practitioners','availability_schedules','availability_exceptions',
    'consent_forms','customer_notes','payments','notification_preferences','app_settings'
  ] loop
    execute format('create trigger touch_updated_at_trigger before update on public.%I for each row execute procedure public.touch_updated_at()', t);
  end loop;
end $$;

create unique index consent_one_active_versioned_form_per_service
  on public.consent_forms (coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_active = true;

create or replace function public.current_role()
returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid()) and is_active = true
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(public.current_role() in ('ADMIN', 'FRONT_DESK'), false)
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(public.current_role() = 'ADMIN', false)
$$;

create or replace function public.is_assigned_practitioner(p_practitioner_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.practitioners pr
    where pr.id = p_practitioner_id and pr.profile_id = (select auth.uid())
  )
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, mobile_number, terms_accepted_at, privacy_accepted_at)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    lower(new.email),
    nullif(trim(new.raw_user_meta_data ->> 'mobile_number'), ''),
    case when new.raw_user_meta_data ->> 'accepted_terms' = 'true' then now() end,
    case when new.raw_user_meta_data ->> 'accepted_privacy' = 'true' then now() end
  );
  insert into public.notification_preferences (profile_id) values (new.id);
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.record_appointment_status()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.appointment_status_history(appointment_id, previous_status, new_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.appointment_status_history(appointment_id, previous_status, new_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger appointment_status_history_trigger before insert or update of status on public.appointments
  for each row execute procedure public.record_appointment_status();

create or replace function public.guard_appointment_overlap()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status not in ('TEMPORARILY_RESERVED', 'BOOKED', 'CHECKED_IN') then return new; end if;
  perform pg_advisory_xact_lock(hashtext(new.practitioner_id::text));
  if exists (
    select 1 from public.appointments a
    where a.practitioner_id = new.practitioner_id
      and a.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and a.starts_at < new.ends_at and new.starts_at < a.ends_at
      and (
        a.status in ('BOOKED', 'CHECKED_IN')
        or (a.status = 'TEMPORARILY_RESERVED' and a.reservation_expires_at > now())
      )
  ) then
    raise exception using errcode = '23P01', message = 'The selected appointment time is no longer available.';
  end if;
  return new;
end;
$$;
create trigger appointment_overlap_guard before insert or update of practitioner_id, starts_at, ends_at, status, reservation_expires_at
  on public.appointments for each row execute procedure public.guard_appointment_overlap();

create or replace function public.protect_appointment_mutations()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if (new.customer_id, new.practitioner_id, new.service_id, new.starts_at, new.ends_at, new.service_snapshot)
        is distinct from
       (old.customer_id, old.practitioner_id, old.service_id, old.starts_at, old.ends_at, old.service_snapshot)
       and current_setting('app.allow_appointment_reschedule', true) is distinct from 'on' then
      raise exception using errcode = '42501', message = 'Appointment details can only be changed through secure rescheduling.';
    end if;
    if new.status = 'COMPLETED' and old.status is distinct from 'COMPLETED'
       and not exists (select 1 from public.treatment_records tr where tr.appointment_id = old.id) then
      raise exception using errcode = '23514', message = 'Save a treatment record before completing this appointment.';
    end if;
  end if;
  return new;
end;
$$;
create trigger appointment_mutation_guard before update on public.appointments
  for each row execute procedure public.protect_appointment_mutations();

create or replace function public.notify_appointment_status()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_title text;
  v_body text;
  v_type text;
begin
  if tg_op = 'INSERT' and new.source = 'WALK_IN' and new.status = 'BOOKED' then
    insert into public.notifications(profile_id, appointment_id, title, body, type)
      values (new.customer_id, new.id, 'Appointment booked', 'Your walk-in appointment has been added to the studio calendar.', 'BOOKING_CONFIRMED')
      on conflict (profile_id, appointment_id, type) do nothing;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'BOOKED' and new.source = 'WALK_IN' then
      v_title := 'Appointment booked';
      v_body := 'Your walk-in appointment has been confirmed by the studio.';
      v_type := 'BOOKING_CONFIRMED';
    elsif new.status = 'CANCELLED' then
      v_title := 'Appointment cancelled';
      v_body := 'Your appointment has been cancelled. Contact the studio about any payment already made.';
      v_type := 'APPOINTMENT_CANCELLED';
    elsif new.status = 'RESCHEDULED' then
      v_title := 'Appointment rescheduled';
      v_body := 'Your original appointment time was replaced. Check your appointments for the new time.';
      v_type := 'APPOINTMENT_RESCHEDULED';
    elsif new.status = 'COMPLETED' then
      v_title := 'Treatment completed';
      v_body := 'Your treatment record is available in your private treatment history.';
      v_type := 'TREATMENT_COMPLETED';
    end if;
    if v_type is not null then
      insert into public.notifications(profile_id, appointment_id, title, body, type)
        values (new.customer_id, new.id, v_title, v_body, v_type)
        on conflict (profile_id, appointment_id, type) do nothing;
    end if;
  end if;
  return new;
end;
$$;
create trigger appointment_notification_trigger
  after insert or update of status on public.appointments
  for each row execute procedure public.notify_appointment_status();

create or replace function public.get_available_slots(
  p_service_id uuid, p_date date, p_practitioner_id uuid default null, p_slot_interval_minutes integer default 30
)
returns table (practitioner_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_duration integer;
  v_practitioner record;
  v_open time;
  v_close time;
  v_break_start time;
  v_break_end time;
  v_working boolean;
  v_business_hours jsonb;
  v_day_hours jsonb;
  v_booking_settings jsonb;
  v_max_days_ahead integer;
  v_slot_interval integer;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_date < (now() at time zone 'Asia/Manila')::date or p_slot_interval_minutes < 5 or p_slot_interval_minutes > 120 then
    raise exception using errcode = '22023', message = 'Invalid date or slot interval.';
  end if;
  select s.duration_minutes into v_duration from public.services s where s.id = p_service_id and s.is_active = true;
  if v_duration is null then return; end if;
  select value into v_business_hours from public.app_settings where key = 'business_hours';
  select value into v_booking_settings from public.app_settings where key = 'booking_settings';
  v_max_days_ahead := (v_booking_settings ->> 'maximum_days_ahead')::integer;
  v_slot_interval := coalesce((v_booking_settings ->> 'slot_interval_minutes')::integer, 30);
  if v_max_days_ahead is not null
    and p_date > (now() at time zone 'Asia/Manila')::date + v_max_days_ahead then
    return;
  end if;
  if v_slot_interval < 5 or v_slot_interval > 120 then
    raise exception using errcode = '22023', message = 'The configured booking interval is invalid.';
  end if;
  for v_practitioner in
    select pr.id from public.practitioners pr
    join public.practitioner_services ps on ps.practitioner_id = pr.id and ps.service_id = p_service_id
    where pr.is_active = true and (p_practitioner_id is null or pr.id = p_practitioner_id)
  loop
    select e.is_working, e.opens_at, e.closes_at, e.break_starts_at, e.break_ends_at
      into v_working, v_open, v_close, v_break_start, v_break_end
      from public.availability_exceptions e
      where e.practitioner_id = v_practitioner.id and e.exception_date = p_date;
    if found then
      if not v_working or v_open is null then continue; end if;
    else
      select s.opens_at, s.closes_at, s.break_starts_at, s.break_ends_at
        into v_open, v_close, v_break_start, v_break_end
        from public.availability_schedules s
        where s.practitioner_id = v_practitioner.id
          and s.weekday = extract(dow from p_date)::smallint and s.is_working = true;
      if not found then continue; end if;
    end if;
    if v_business_hours is not null then
      v_day_hours := v_business_hours -> extract(dow from p_date)::text;
      if v_day_hours is null or coalesce((v_day_hours ->> 'is_open')::boolean, false) = false then continue; end if;
      v_open := greatest(v_open, (v_day_hours ->> 'opens_at')::time);
      v_close := least(v_close, (v_day_hours ->> 'closes_at')::time);
      if v_open >= v_close then continue; end if;
    end if;
    v_start := (p_date + v_open) at time zone 'Asia/Manila';
    while v_start + make_interval(mins => v_duration) <= (p_date + v_close) at time zone 'Asia/Manila' loop
      v_end := v_start + make_interval(mins => v_duration);
      if v_start > now()
        and (v_break_start is null or not (v_start < (p_date + v_break_end) at time zone 'Asia/Manila'
              and (p_date + v_break_start) at time zone 'Asia/Manila' < v_end))
        and not exists (
          select 1 from public.appointments a
          where a.practitioner_id = v_practitioner.id and a.starts_at < v_end and v_start < a.ends_at
            and (a.status in ('BOOKED', 'CHECKED_IN')
              or (a.status = 'TEMPORARILY_RESERVED' and a.reservation_expires_at > now()))
        )
        and not exists (
          select 1 from public.blocked_periods b
          where (b.practitioner_id is null or b.practitioner_id = v_practitioner.id)
            and b.starts_at < v_end and v_start < b.ends_at
        ) then
        practitioner_id := v_practitioner.id;
        starts_at := v_start;
        ends_at := v_end;
        return next;
      end if;
      v_start := v_start + make_interval(mins => v_slot_interval);
    end loop;
  end loop;
end;
$$;

create or replace function public.create_reservation(
  p_service_id uuid, p_practitioner_id uuid, p_starts_at timestamptz
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_service public.services%rowtype;
  v_end timestamptz;
  v_appointment_id uuid;
begin
  if v_user_id is null or public.current_role() <> 'CLIENT' then
    raise exception using errcode = '42501', message = 'Only signed-in clients can reserve appointments.';
  end if;
  select * into v_service from public.services where id = p_service_id and is_active = true;
  if not found or not exists (
    select 1 from public.practitioner_services ps
    join public.practitioners pr on pr.id = ps.practitioner_id and pr.is_active = true
    where ps.service_id = p_service_id and ps.practitioner_id = p_practitioner_id
  ) then
    raise exception using errcode = '22023', message = 'This service and practitioner are not available.';
  end if;
  v_end := p_starts_at + make_interval(mins => v_service.duration_minutes);
  if not exists (
    select 1 from public.get_available_slots(p_service_id, (p_starts_at at time zone 'Asia/Manila')::date, p_practitioner_id)
    where get_available_slots.starts_at = p_starts_at and get_available_slots.ends_at = v_end
  ) then
    raise exception using errcode = '23P01', message = 'The selected appointment time is no longer available.';
  end if;
  insert into public.appointments(customer_id, practitioner_id, service_id, starts_at, ends_at,
      status, reservation_expires_at, service_snapshot, created_by)
    values (v_user_id, p_practitioner_id, p_service_id, p_starts_at, v_end,
      'TEMPORARILY_RESERVED', now() + interval '15 minutes',
      jsonb_build_object('name', v_service.name, 'description', v_service.description,
        'price_amount', v_service.price_amount, 'currency', v_service.currency,
        'duration_minutes', v_service.duration_minutes, 'requires_consent', v_service.requires_consent), v_user_id)
    returning id into v_appointment_id;
  return v_appointment_id;
end;
$$;

create or replace function public.create_walk_in_appointment(
  p_customer_id uuid,
  p_service_id uuid,
  p_practitioner_id uuid,
  p_starts_at timestamptz,
  p_manual_reference text default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_service public.services%rowtype;
  v_appointment_id uuid;
begin
  if not (public.is_staff() or auth.role() = 'service_role') then
    raise exception using errcode = '42501', message = 'Front Desk or Administrator access is required.';
  end if;
  select * into v_service from public.services where id = p_service_id and is_active = true;
  if not found then raise exception using errcode = '22023', message = 'The selected service is not active.'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_customer_id and p.role = 'CLIENT' and p.is_active) then
    raise exception using errcode = '22023', message = 'The selected customer account is unavailable.';
  end if;
  if not exists (
    select 1 from public.get_available_slots(
      p_service_id, (p_starts_at at time zone 'Asia/Manila')::date, p_practitioner_id
    ) slot
    where slot.starts_at = p_starts_at
      and slot.ends_at = p_starts_at + make_interval(mins => v_service.duration_minutes)
  ) then
    raise exception using errcode = '23P01', message = 'The selected walk-in time is not available.';
  end if;
  insert into public.appointments(customer_id, practitioner_id, service_id, starts_at, ends_at,
      status, reservation_expires_at, service_snapshot, source, created_by)
    values (p_customer_id, p_practitioner_id, p_service_id, p_starts_at,
      p_starts_at + make_interval(mins => v_service.duration_minutes),
      case when v_service.requires_consent then 'TEMPORARILY_RESERVED'::public.appointment_status
        else 'BOOKED'::public.appointment_status end,
      case when v_service.requires_consent then now() + interval '15 minutes' end,
      jsonb_build_object('name', v_service.name, 'description', v_service.description,
        'price_amount', v_service.price_amount, 'currency', v_service.currency,
        'duration_minutes', v_service.duration_minutes, 'requires_consent', v_service.requires_consent),
      'WALK_IN', auth.uid())
    returning id into v_appointment_id;
  if not v_service.requires_consent and nullif(trim(p_manual_reference), '') is not null then
    insert into public.payments(appointment_id, customer_id, amount, currency, status, provider,
        manual_reference, paid_at)
      values (v_appointment_id, p_customer_id, v_service.price_amount, v_service.currency,
        'PAID', 'MANUAL', trim(p_manual_reference), now());
  end if;
  return v_appointment_id;
end;
$$;

create or replace function public.submit_walk_in_consent(
  p_appointment_id uuid,
  p_form_id uuid,
  p_answers jsonb,
  p_agreements text[],
  p_signature text
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments%rowtype;
  v_form public.consent_forms%rowtype;
  v_version public.consent_form_versions%rowtype;
  v_question jsonb;
  v_agreement jsonb;
  v_submission_id uuid;
begin
  if not public.is_staff() or jsonb_typeof(p_answers) <> 'object' then
    raise exception using errcode = '42501', message = 'Front Desk or Administrator access is required.';
  end if;
  select * into v_appointment from public.appointments
    where id = p_appointment_id for update;
  if not found or v_appointment.status <> 'TEMPORARILY_RESERVED'
    or v_appointment.source <> 'WALK_IN'
    or v_appointment.reservation_expires_at <= now()
    or not coalesce((v_appointment.service_snapshot ->> 'requires_consent')::boolean, false) then
    raise exception using errcode = '22023', message = 'The walk-in reservation is not ready for consent.';
  end if;
  select * into v_form from public.consent_forms
    where id = p_form_id and is_active
      and (service_id = v_appointment.service_id or service_id is null);
  if not found or v_form.current_version_id is null then
    raise exception using errcode = '22023', message = 'This is not the active consent form for the service.';
  end if;
  select * into v_version from public.consent_form_versions
    where id = v_form.current_version_id and form_id = v_form.id and published_at is not null;
  if not found then raise exception using errcode = '22023', message = 'The active consent version is not published.'; end if;
  for v_question in select value from jsonb_array_elements(v_version.questions)
  loop
    if coalesce((v_question ->> 'required')::boolean, false)
      and (p_answers ->> (v_question ->> 'id') is null or length(trim(p_answers ->> (v_question ->> 'id'))) = 0) then
      raise exception using errcode = '22023', message = 'Answer every required consent question.';
    end if;
  end loop;
  for v_agreement in select value from jsonb_array_elements(v_version.agreements)
  loop
    if not coalesce((p_agreements @> array[v_agreement ->> 'id']), false) then
      raise exception using errcode = '22023', message = 'Accept every required consent agreement.';
    end if;
  end loop;
  if v_version.requires_signature and length(trim(coalesce(p_signature, ''))) < 2 then
    raise exception using errcode = '22023', message = 'A digital signature is required.';
  end if;
  insert into public.consent_submissions(customer_id, appointment_id, service_id, form_id,
      form_version_id, answers, signature, agreed_at)
    values (v_appointment.customer_id, v_appointment.id, v_appointment.service_id, v_form.id,
      v_version.id, jsonb_build_object('answers', p_answers, 'agreements', to_jsonb(p_agreements)),
      nullif(trim(p_signature), ''), now())
    on conflict (appointment_id, form_version_id) do nothing
    returning id into v_submission_id;
  if v_submission_id is null then
    select id into v_submission_id from public.consent_submissions
      where appointment_id = v_appointment.id and form_version_id = v_version.id;
  end if;
  return v_submission_id;
end;
$$;

create or replace function public.finalize_walk_in_appointment(
  p_appointment_id uuid,
  p_manual_reference text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments%rowtype;
  v_service public.services%rowtype;
begin
  if not public.is_staff() then raise exception using errcode = '42501', message = 'Front Desk or Administrator access is required.'; end if;
  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if not found or v_appointment.source <> 'WALK_IN' or v_appointment.status <> 'TEMPORARILY_RESERVED'
    or v_appointment.reservation_expires_at <= now() then
    raise exception using errcode = '22023', message = 'The walk-in reservation has expired or is unavailable.';
  end if;
  if coalesce((v_appointment.service_snapshot ->> 'requires_consent')::boolean, false)
    and not exists (
      select 1 from public.consent_forms f
      join public.consent_submissions cs on cs.form_id = f.id and cs.form_version_id = f.current_version_id
      where (f.service_id = v_appointment.service_id or f.service_id is null)
        and f.is_active and cs.appointment_id = v_appointment.id
    ) then
    raise exception using errcode = '22023', message = 'Complete the active consent form before confirming this walk-in.';
  end if;
  select * into v_service from public.services where id = v_appointment.service_id;
  if nullif(trim(p_manual_reference), '') is not null then
    insert into public.payments(appointment_id, customer_id, amount, currency, status, provider,
        manual_reference, paid_at)
      values (v_appointment.id, v_appointment.customer_id, v_service.price_amount, v_service.currency,
        'PAID', 'MANUAL', trim(p_manual_reference), now());
  end if;
  update public.appointments set status = 'BOOKED', reservation_expires_at = null
    where id = v_appointment.id;
end;
$$;

create or replace function public.finalize_verified_payment(p_payment_id uuid, p_provider_reference text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_appointment_id uuid;
  v_appointment public.appointments%rowtype;
  v_requires_consent boolean;
begin
  select appointment_id into v_appointment_id from public.payments
    where id = p_payment_id and status in ('PENDING', 'EXPIRED', 'FAILED') and provider_reference = p_provider_reference
    for update;
  if v_appointment_id is null then
    raise exception using errcode = 'P0002', message = 'Pending payment was not found.';
  end if;
  select * into v_appointment from public.appointments where id = v_appointment_id for update;
  v_requires_consent := coalesce((v_appointment.service_snapshot ->> 'requires_consent')::boolean, false);
  if v_appointment.status <> 'TEMPORARILY_RESERVED'
      or v_appointment.reservation_expires_at <= now()
      or (v_requires_consent
    and not exists (
      select 1 from public.consent_forms f
      join public.consent_submissions cs on cs.form_id = f.id
        and cs.form_version_id = f.current_version_id
      where (f.service_id = v_appointment.service_id or f.service_id is null)
        and f.is_active and cs.appointment_id = v_appointment_id
    )) then
    update public.payments set status = 'PAID', paid_at = now(), updated_at = now() where id = p_payment_id;
    update public.appointments set status = 'CANCELLED', reservation_expires_at = null,
      cancellation_reason = 'Verified payment requires staff review before booking.' where id = v_appointment_id
      and status = 'TEMPORARILY_RESERVED';
    return null;
  end if;
  update public.payments set status = 'PAID', paid_at = now(), updated_at = now() where id = p_payment_id;
  update public.appointments set status = 'BOOKED', reservation_expires_at = null
    where id = v_appointment_id and status = 'TEMPORARILY_RESERVED' and reservation_expires_at > now();
  return v_appointment_id;
end;
$$;

create or replace function public.finish_reservation(p_appointment_id uuid, p_payment_status public.payment_status)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.payments set status = p_payment_status, updated_at = now()
    where appointment_id = p_appointment_id and status = 'PENDING';
  update public.appointments set status = 'CANCELLED', reservation_expires_at = null
    where id = p_appointment_id and status = 'TEMPORARILY_RESERVED'
      and (customer_id = auth.uid() or public.is_admin() or auth.role() = 'service_role');
  if not found then raise exception using errcode = 'P0002', message = 'Active reservation not found.'; end if;
end;
$$;

create or replace function public.create_treatment_record(
  p_appointment_id uuid, p_details text, p_areas text[], p_products text[], p_notes text, p_follow_up text
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments%rowtype;
  v_record_id uuid;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if not found or v_appointment.status <> 'CHECKED_IN'
    or not (public.is_admin() or public.is_staff() or public.is_assigned_practitioner(v_appointment.practitioner_id)) then
    raise exception using errcode = '42501', message = 'You cannot complete this appointment.';
  end if;
  insert into public.treatment_records(customer_id, appointment_id, service_id, practitioner_id,
      treatment_date, details, areas_treated, products_used, notes, follow_up_recommendations)
    values (v_appointment.customer_id, v_appointment.id, v_appointment.service_id, v_appointment.practitioner_id,
      now(), p_details, coalesce(p_areas, '{}'), coalesce(p_products, '{}'), p_notes, p_follow_up)
    returning id into v_record_id;
  update public.appointments set status = 'COMPLETED' where id = v_appointment.id;
  return v_record_id;
end;
$$;

create or replace function public.save_consent_form(
  p_form_id uuid,
  p_service_id uuid,
  p_title text,
  p_description text,
  p_questions jsonb,
  p_agreements jsonb,
  p_requires_signature boolean,
  p_activate boolean
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_form_id uuid;
  v_version integer;
  v_version_id uuid;
begin
  if not public.is_admin() or length(trim(p_title)) < 2
    or jsonb_typeof(p_questions) <> 'array' or jsonb_typeof(p_agreements) <> 'array' then
    raise exception using errcode = '42501', message = 'Administrator access and valid consent form content are required.';
  end if;
  if p_form_id is null then
    insert into public.consent_forms(service_id, title, description, is_active, created_by)
      values (p_service_id, trim(p_title), trim(p_description), false, auth.uid())
      returning id into v_form_id;
    v_version := 1;
  else
    select id into v_form_id from public.consent_forms where id = p_form_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'Consent form not found.'; end if;
    select coalesce(max(version), 0) + 1 into v_version
      from public.consent_form_versions where form_id = v_form_id;
  end if;
  insert into public.consent_form_versions(form_id, version, questions, agreements, requires_signature, published_at, created_by)
    values (v_form_id, v_version, p_questions, p_agreements, p_requires_signature,
      case when p_activate then now() else null end, auth.uid())
    returning id into v_version_id;
  update public.consent_forms set service_id = p_service_id, title = trim(p_title),
    description = trim(p_description), is_active = p_activate, current_version_id = v_version_id,
    updated_at = now()
    where id = v_form_id;
  return v_form_id;
end;
$$;

create or replace function public.submit_consent(
  p_appointment_id uuid,
  p_form_id uuid,
  p_answers jsonb,
  p_agreements text[],
  p_signature text
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments%rowtype;
  v_form public.consent_forms%rowtype;
  v_version public.consent_form_versions%rowtype;
  v_question jsonb;
  v_agreement jsonb;
  v_submission_id uuid;
begin
  if auth.uid() is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception using errcode = '42501', message = 'Sign in and provide consent answers.';
  end if;
  select * into v_appointment from public.appointments
    where id = p_appointment_id and customer_id = auth.uid() for update;
  if not found or v_appointment.status <> 'TEMPORARILY_RESERVED'
    or v_appointment.reservation_expires_at <= now() then
    raise exception using errcode = '22023', message = 'The reservation expired before consent was submitted.';
  end if;
  select * into v_form from public.consent_forms
    where id = p_form_id and is_active
      and (service_id = v_appointment.service_id or service_id is null);
  if not found or v_form.current_version_id is null then
    raise exception using errcode = '22023', message = 'This is not the current consent form for the service.';
  end if;
  select * into v_version from public.consent_form_versions
    where id = v_form.current_version_id and form_id = v_form.id and published_at is not null;
  if not found then raise exception using errcode = '22023', message = 'The active consent version is not published.'; end if;

  for v_question in select value from jsonb_array_elements(v_version.questions)
  loop
    if coalesce((v_question ->> 'required')::boolean, false)
      and (p_answers ->> (v_question ->> 'id') is null or length(trim(p_answers ->> (v_question ->> 'id'))) = 0) then
      raise exception using errcode = '22023', message = 'Answer every required consent question.';
    end if;
  end loop;
  for v_agreement in select value from jsonb_array_elements(v_version.agreements)
  loop
    if not coalesce((p_agreements @> array[v_agreement ->> 'id']), false) then
      raise exception using errcode = '22023', message = 'Accept every required consent agreement.';
    end if;
  end loop;
  if v_version.requires_signature and length(trim(coalesce(p_signature, ''))) < 2 then
    raise exception using errcode = '22023', message = 'A digital signature is required.';
  end if;

  insert into public.consent_submissions(customer_id, appointment_id, service_id, form_id,
      form_version_id, answers, signature, agreed_at)
    values (auth.uid(), v_appointment.id, v_appointment.service_id, v_form.id,
      v_version.id, jsonb_build_object('answers', p_answers, 'agreements', to_jsonb(p_agreements)),
      nullif(trim(p_signature), ''), now())
    returning id into v_submission_id;
  return v_submission_id;
end;
$$;

create or replace function public.deactivate_consent_form(p_form_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception using errcode = '42501', message = 'Administrator access is required.'; end if;
  update public.consent_forms set is_active = false, updated_at = now() where id = p_form_id;
  if not found then raise exception using errcode = 'P0002', message = 'Consent form not found.'; end if;
end;
$$;

create or replace function public.cancel_appointment(p_appointment_id uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments%rowtype;
  v_policy jsonb;
  v_cutoff integer;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if not found or not (v_appointment.customer_id = auth.uid() or public.is_staff() or public.is_admin()) then
    raise exception using errcode = '42501', message = 'Appointment not found or access denied.';
  end if;
  if v_appointment.status not in ('BOOKED', 'TEMPORARILY_RESERVED') then
    raise exception using errcode = '22023', message = 'This appointment can no longer be cancelled.';
  end if;
  select value into v_policy from public.app_settings where key = 'cancellation_policy';
  v_cutoff := (v_policy ->> 'minimum_hours_before')::integer;
  if v_appointment.status = 'BOOKED' and not (public.is_staff() or public.is_admin())
    and (v_policy is null or v_policy ->> 'minimum_hours_before' is null) then
    raise exception using errcode = '22023', message = 'Studio cancellation policy is not configured. Please contact the studio.';
  end if;
  if v_appointment.status = 'BOOKED' and v_appointment.starts_at < now() + make_interval(hours => v_cutoff)
      and not (public.is_staff() or public.is_admin()) then
    raise exception using errcode = '22023', message = 'The cancellation window has passed. Please contact the studio.';
  end if;
  update public.appointments set status = 'CANCELLED', reservation_expires_at = null,
      cancellation_reason = nullif(trim(p_reason), '') where id = p_appointment_id;
  update public.payments set status = 'EXPIRED', updated_at = now()
    where appointment_id = p_appointment_id and status = 'PENDING';
end;
$$;

create or replace function public.reschedule_appointment(
  p_appointment_id uuid, p_practitioner_id uuid, p_starts_at timestamptz
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_original public.appointments%rowtype;
  v_policy jsonb;
  v_cutoff integer;
  v_new_id uuid;
begin
  select * into v_original from public.appointments where id = p_appointment_id for update;
  if not found or not (v_original.customer_id = auth.uid() or public.is_staff() or public.is_admin())
      or v_original.status <> 'BOOKED' then
    raise exception using errcode = '42501', message = 'Appointment not found or cannot be rescheduled.';
  end if;
  select value into v_policy from public.app_settings where key = 'rescheduling_policy';
  if not (public.is_staff() or public.is_admin()) and (v_policy is null or v_policy ->> 'minimum_hours_before' is null) then
    raise exception using errcode = '22023', message = 'Studio rescheduling policy is not configured. Please contact the studio.';
  end if;
  v_cutoff := (v_policy ->> 'minimum_hours_before')::integer;
  if v_original.starts_at < now() + make_interval(hours => v_cutoff)
      and not (public.is_staff() or public.is_admin()) then
    raise exception using errcode = '22023', message = 'The rescheduling window has passed. Please contact the studio.';
  end if;
  if not exists (
    select 1 from public.get_available_slots(
      v_original.service_id,
      (p_starts_at at time zone 'Asia/Manila')::date,
      p_practitioner_id
    ) slot
    where slot.starts_at = p_starts_at
      and slot.ends_at = p_starts_at + make_interval(mins => (v_original.service_snapshot ->> 'duration_minutes')::integer)
  ) then
    raise exception using errcode = '23P01', message = 'The selected appointment time is no longer available.';
  end if;
  perform set_config('app.allow_appointment_reschedule', 'on', true);
  insert into public.appointments(customer_id, practitioner_id, service_id, starts_at, ends_at,
      status, reservation_expires_at, service_snapshot, source, created_by)
    select v_original.customer_id, p_practitioner_id, v_original.service_id, p_starts_at,
      p_starts_at + make_interval(mins => (v_original.service_snapshot ->> 'duration_minutes')::integer),
      'BOOKED', null, v_original.service_snapshot, v_original.source, auth.uid()
    returning id into v_new_id;
  update public.payments set appointment_id = v_new_id, updated_at = now()
    where appointment_id = v_original.id and status = 'PAID';
  insert into public.consent_submissions(
    customer_id, appointment_id, service_id, form_id, form_version_id, answers, signature, agreed_at
  )
  select customer_id, v_new_id, service_id, form_id, form_version_id, answers, signature, agreed_at
    from public.consent_submissions where appointment_id = v_original.id
  on conflict (appointment_id, form_version_id) do nothing;
  update public.appointments set status = 'RESCHEDULED' where id = p_appointment_id;
  return v_new_id;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles','services','practitioners','practitioner_services','availability_schedules','availability_exceptions',
    'blocked_periods','appointments','appointment_status_history','consent_forms','consent_form_versions',
    'consent_submissions','treatment_records','customer_notes','payments','payment_transactions',
    'notifications','notification_preferences','app_settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy "profiles self or operational read" on public.profiles for select
  using (id = (select auth.uid()) or public.is_staff() or public.is_admin()
    or exists (select 1 from public.appointments a where a.customer_id = profiles.id
      and public.is_assigned_practitioner(a.practitioner_id)));
create policy "profiles self update" on public.profiles for update
  using (id = (select auth.uid())) with check (id = (select auth.uid()) and role = public.current_role());
create policy "admin manages profiles" on public.profiles for all using (public.is_admin()) with check (public.is_admin());

create policy "active services readable" on public.services for select using (is_active or public.is_staff() or public.is_admin());
create policy "admin manages services" on public.services for all using (public.is_admin()) with check (public.is_admin());
create policy "practitioners visible" on public.practitioners for select using (is_active or public.is_staff() or public.is_admin() or profile_id = (select auth.uid()));
create policy "admin manages practitioners" on public.practitioners for all using (public.is_admin()) with check (public.is_admin());
create policy "practitioner services visible" on public.practitioner_services for select using (true);
create policy "admin manages practitioner services" on public.practitioner_services for all using (public.is_admin()) with check (public.is_admin());
create policy "schedules visible" on public.availability_schedules for select
  using (public.is_staff() or public.is_admin() or public.is_assigned_practitioner(practitioner_id));
create policy "admin manages schedules" on public.availability_schedules for all using (public.is_admin()) with check (public.is_admin());
create policy "exceptions visible" on public.availability_exceptions for select
  using (public.is_staff() or public.is_admin() or public.is_assigned_practitioner(practitioner_id));
create policy "admin manages exceptions" on public.availability_exceptions for all using (public.is_admin()) with check (public.is_admin());
create policy "blocked periods visible" on public.blocked_periods for select using (public.is_staff() or public.is_admin());
create policy "admin manages blocked periods" on public.blocked_periods for all using (public.is_admin()) with check (public.is_admin());

create policy "appointments participant read" on public.appointments for select
  using (customer_id = (select auth.uid()) or public.is_staff() or public.is_admin()
    or public.is_assigned_practitioner(practitioner_id));
create policy "staff creates appointments" on public.appointments for insert
  with check (false);
create policy "staff updates appointments" on public.appointments for update
  using (public.is_staff() or public.is_admin())
  with check (public.is_staff() or public.is_admin());
create policy "appointment history participant read" on public.appointment_status_history for select
  using (exists (select 1 from public.appointments a where a.id = appointment_id
    and (a.customer_id = (select auth.uid()) or public.is_staff() or public.is_admin()
      or public.is_assigned_practitioner(a.practitioner_id))));

create policy "active consent forms readable" on public.consent_forms for select using (is_active or public.is_staff() or public.is_admin());
create policy "admin manages consent forms" on public.consent_forms for all using (public.is_admin()) with check (public.is_admin());
create policy "consent versions readable" on public.consent_form_versions for select using (published_at is not null or public.is_admin());
create policy "admin creates consent versions" on public.consent_form_versions for insert with check (public.is_admin());
create policy "consent submissions participant read" on public.consent_submissions for select
  using (customer_id = (select auth.uid()) or public.is_staff() or public.is_admin()
    or exists (select 1 from public.appointments a where a.id = appointment_id
      and public.is_assigned_practitioner(a.practitioner_id)));

create policy "treatment history participant read" on public.treatment_records for select
  using (customer_id = (select auth.uid()) or public.is_staff() or public.is_admin()
    or public.is_assigned_practitioner(practitioner_id));
create policy "assigned practitioner reads customer notes" on public.customer_notes for select
  using (public.is_staff() or public.is_admin() or public.is_assigned_practitioner(
    (select a.practitioner_id from public.appointments a where a.customer_id = customer_notes.customer_id
      and public.is_assigned_practitioner(a.practitioner_id) limit 1)));
create policy "staff manages customer notes" on public.customer_notes for all
  using (public.is_staff() or public.is_admin()) with check (public.is_staff() or public.is_admin());

create policy "payments owner or staff read" on public.payments for select
  using (customer_id = (select auth.uid()) or public.is_staff() or public.is_admin()
    or exists (select 1 from public.appointments a where a.id = appointment_id
      and public.is_assigned_practitioner(a.practitioner_id)));
create policy "staff records manual payments" on public.payments for insert
  with check (public.is_staff() and provider = 'MANUAL' and status = 'PAID'
    and nullif(trim(manual_reference), '') is not null and paid_at is not null
    and amount = (select (a.service_snapshot ->> 'price_amount')::numeric from public.appointments a where a.id = appointment_id)
    and currency = (select a.service_snapshot ->> 'currency' from public.appointments a where a.id = appointment_id));
create policy "payment transactions staff read" on public.payment_transactions for select
  using (public.is_staff() or public.is_admin());
create policy "notifications owner read" on public.notifications for select using (profile_id = (select auth.uid()));
create policy "notifications owner update" on public.notifications for update
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
create policy "admin notification read" on public.notifications for select using (public.is_admin());
create policy "notification preferences own" on public.notification_preferences for all
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
create policy "admin reads settings" on public.app_settings for select using (public.is_admin());
create policy "admin writes settings" on public.app_settings for all using (public.is_admin()) with check (public.is_admin());

revoke all on public.payments, public.payment_transactions from anon, authenticated;
revoke update on public.notifications from anon, authenticated;
grant select on public.payments to authenticated;
grant insert on public.payments to authenticated;
grant select on public.payment_transactions to authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke execute on function public.finalize_verified_payment(uuid, text) from public, anon, authenticated;
revoke execute on function public.finish_reservation(uuid, public.payment_status) from public, anon, authenticated;
grant execute on function public.finalize_verified_payment(uuid, text) to service_role;
grant execute on function public.finish_reservation(uuid, public.payment_status) to service_role;
grant execute on function public.create_reservation(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.create_walk_in_appointment(uuid, uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public.submit_walk_in_consent(uuid, uuid, jsonb, text[], text) to authenticated;
grant execute on function public.finalize_walk_in_appointment(uuid, text) to authenticated;
grant execute on function public.get_available_slots(uuid, date, uuid, integer) to anon, authenticated;
grant execute on function public.create_treatment_record(uuid, text, text[], text[], text, text) to authenticated;
grant execute on function public.save_consent_form(uuid, uuid, text, text, jsonb, jsonb, boolean, boolean) to authenticated;
grant execute on function public.submit_consent(uuid, uuid, jsonb, text[], text) to authenticated;
grant execute on function public.deactivate_consent_form(uuid) to authenticated;
revoke insert on public.consent_submissions from anon, authenticated;
revoke execute on function public.create_reservation(uuid, uuid, timestamptz) from public, anon;
revoke execute on function public.create_walk_in_appointment(uuid, uuid, uuid, timestamptz, text) from public, anon;
revoke execute on function public.submit_walk_in_consent(uuid, uuid, jsonb, text[], text) from public, anon;
revoke execute on function public.finalize_walk_in_appointment(uuid, text) from public, anon;
revoke execute on function public.create_treatment_record(uuid, text, text[], text[], text, text) from public, anon;
revoke execute on function public.save_consent_form(uuid, uuid, text, text, jsonb, jsonb, boolean, boolean) from public, anon;
revoke execute on function public.submit_consent(uuid, uuid, jsonb, text[], text) from public, anon;
revoke execute on function public.deactivate_consent_form(uuid) from public, anon;
revoke execute on function public.cancel_appointment(uuid, text) from public, anon;
revoke execute on function public.reschedule_appointment(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.cancel_appointment(uuid, text) to authenticated;
grant execute on function public.reschedule_appointment(uuid, uuid, timestamptz) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('service-images', 'service-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('private-customer-files', 'private-customer-files', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "service images publicly readable" on storage.objects for select using (bucket_id = 'service-images');
create policy "admin uploads service images" on storage.objects for insert to authenticated
  with check (bucket_id = 'service-images' and public.is_admin());
create policy "admin manages service images" on storage.objects for update to authenticated
  using (bucket_id = 'service-images' and public.is_admin()) with check (bucket_id = 'service-images' and public.is_admin());
create policy "private files owner or staff read" on storage.objects for select to authenticated
  using (bucket_id = 'private-customer-files' and (
    (storage.foldername(name))[1] = (select auth.uid())::text or public.is_staff() or public.is_admin()
  ));
create policy "private files owner or staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'private-customer-files' and (
    (storage.foldername(name))[1] = (select auth.uid())::text or public.is_staff() or public.is_admin()
  ));
