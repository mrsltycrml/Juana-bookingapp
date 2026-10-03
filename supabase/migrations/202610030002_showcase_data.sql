create table public.showcase_runs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  practitioner_profile_ids uuid[] not null default '{}',
  customer_profile_ids uuid[] not null default '{}',
  seed_status text not null default 'PREPARING' check (seed_status in ('PREPARING', 'ACTIVE')),
  singleton boolean not null default true unique check (singleton),
  created_at timestamptz not null default now()
);

alter table public.services
  add column showcase_run_id uuid references public.showcase_runs(id) on delete cascade;
alter table public.practitioners
  add column showcase_run_id uuid references public.showcase_runs(id) on delete cascade;
alter table public.appointments
  add column showcase_run_id uuid references public.showcase_runs(id) on delete cascade;
alter table public.appointment_status_history
  add column showcase_run_id uuid references public.showcase_runs(id) on delete cascade;
alter table public.treatment_records
  add column showcase_run_id uuid references public.showcase_runs(id) on delete cascade;

create index appointments_showcase_run_idx on public.appointments(showcase_run_id)
  where showcase_run_id is not null;
create index services_showcase_run_idx on public.services(showcase_run_id)
  where showcase_run_id is not null;

alter table public.showcase_runs enable row level security;
grant select on public.showcase_runs to authenticated;
revoke insert, update, delete on public.showcase_runs from anon, authenticated;
create policy "administrators read showcase runs" on public.showcase_runs
  for select to authenticated using (public.is_staff() or public.is_admin());

create or replace function public.reject_historical_mutation()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and to_jsonb(old) ->> 'showcase_run_id' is not null
    and current_setting('app.allow_showcase_cleanup', true) = 'on' then
    return old;
  end if;
  raise exception using errcode = '55000', message = 'Historical records cannot be changed or deleted.';
end;
$$;

create or replace function public.record_appointment_status()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.appointment_status_history(appointment_id, previous_status, new_status, changed_by, showcase_run_id)
    values (new.id, null, new.status, auth.uid(), new.showcase_run_id);
  elsif new.status is distinct from old.status then
    insert into public.appointment_status_history(appointment_id, previous_status, new_status, changed_by, showcase_run_id)
    values (new.id, old.status, new.status, auth.uid(), new.showcase_run_id);
  end if;
  new.updated_at := now();
  return new;
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
  insert into public.appointments(
    customer_id, practitioner_id, service_id, starts_at, ends_at, status,
    reservation_expires_at, service_snapshot, created_by, showcase_run_id
  ) values (
    v_user_id, p_practitioner_id, p_service_id, p_starts_at, v_end,
    'TEMPORARILY_RESERVED', now() + interval '15 minutes',
    jsonb_build_object('name', v_service.name, 'description', v_service.description,
      'price_amount', v_service.price_amount, 'currency', v_service.currency,
      'duration_minutes', v_service.duration_minutes, 'requires_consent', v_service.requires_consent,
      'showcase', v_service.showcase_run_id is not null),
    v_user_id, v_service.showcase_run_id
  ) returning id into v_appointment_id;
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
    raise exception using errcode = '22023', message = 'The selected customer account is unavailable.'; end if;
  if not exists (
    select 1 from public.get_available_slots(
      p_service_id, (p_starts_at at time zone 'Asia/Manila')::date, p_practitioner_id
    ) slot
    where slot.starts_at = p_starts_at
      and slot.ends_at = p_starts_at + make_interval(mins => v_service.duration_minutes)
  ) then
    raise exception using errcode = '23P01', message = 'The selected walk-in time is not available.';
  end if;
  insert into public.appointments(
    customer_id, practitioner_id, service_id, starts_at, ends_at, status,
    reservation_expires_at, service_snapshot, source, created_by, showcase_run_id
  ) values (
    p_customer_id, p_practitioner_id, p_service_id, p_starts_at,
    p_starts_at + make_interval(mins => v_service.duration_minutes),
    case when v_service.requires_consent then 'TEMPORARILY_RESERVED'::public.appointment_status
      else 'BOOKED'::public.appointment_status end,
    case when v_service.requires_consent then now() + interval '15 minutes' end,
    jsonb_build_object('name', v_service.name, 'description', v_service.description,
      'price_amount', v_service.price_amount, 'currency', v_service.currency,
      'duration_minutes', v_service.duration_minutes, 'requires_consent', v_service.requires_consent,
      'showcase', v_service.showcase_run_id is not null),
    'WALK_IN', auth.uid(), v_service.showcase_run_id
  ) returning id into v_appointment_id;
  if not v_service.requires_consent and nullif(trim(p_manual_reference), '') is not null then
    insert into public.payments(
      appointment_id, customer_id, amount, currency, status, provider, manual_reference, paid_at
    ) values (
      v_appointment_id, p_customer_id, v_service.price_amount, v_service.currency,
      'PAID', 'MANUAL', trim(p_manual_reference), now()
    );
  end if;
  return v_appointment_id;
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
  insert into public.treatment_records(
    customer_id, appointment_id, service_id, practitioner_id, treatment_date,
    details, areas_treated, products_used, notes, follow_up_recommendations, showcase_run_id
  ) values (
    v_appointment.customer_id, v_appointment.id, v_appointment.service_id, v_appointment.practitioner_id,
    now(), p_details, coalesce(p_areas, '{}'), coalesce(p_products, '{}'), p_notes, p_follow_up,
    v_appointment.showcase_run_id
  ) returning id into v_record_id;
  update public.appointments set status = 'COMPLETED' where id = v_appointment.id;
  return v_record_id;
end;
$$;

create or replace function public.begin_showcase_data(p_run_id uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'Administrator access is required to add showcase data.';
  end if;
  insert into public.showcase_runs(id, created_by)
    values (p_run_id, auth.uid());
  return p_run_id;
end;
$$;

create or replace function public.abort_showcase_data(p_run_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'Administrator access is required to cancel showcase setup.';
  end if;
  delete from public.showcase_runs
    where id = p_run_id and created_by = auth.uid() and seed_status = 'PREPARING';
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
  insert into public.appointments(
    customer_id, practitioner_id, service_id, starts_at, ends_at, status,
    reservation_expires_at, service_snapshot, source, created_by, showcase_run_id
  )
    select v_original.customer_id, p_practitioner_id, v_original.service_id, p_starts_at,
      p_starts_at + make_interval(mins => (v_original.service_snapshot ->> 'duration_minutes')::integer),
      'BOOKED', null, v_original.service_snapshot, v_original.source, auth.uid(), v_original.showcase_run_id
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

create or replace function public.seed_showcase_data(
  p_run_id uuid,
  p_practitioner_profile_ids uuid[],
  p_customer_profile_ids uuid[]
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_run_id uuid := p_run_id;
  v_service_ids uuid[];
  v_practitioner_ids uuid[];
  v_appointment_id uuid;
  v_service public.services%rowtype;
  v_start timestamptz;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_customer_id uuid;
  v_index integer;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'Administrator access is required to add showcase data.';
  end if;
  if coalesce(cardinality(p_practitioner_profile_ids), 0) <> 2
    or coalesce(cardinality(p_customer_profile_ids), 0) <> 4
    or exists (
      select 1 from unnest(p_practitioner_profile_ids) id
      where not exists (select 1 from public.profiles p where p.id = id and p.role = 'PRACTITIONER' and p.is_active)
    )
    or exists (
      select 1 from unnest(p_customer_profile_ids) id
      where not exists (select 1 from public.profiles p where p.id = id and p.role = 'CLIENT' and p.is_active)
    ) then
    raise exception using errcode = '22023', message = 'Showcase accounts were not created with the expected roles.';
  end if;
  update public.showcase_runs
    set practitioner_profile_ids = p_practitioner_profile_ids,
        customer_profile_ids = p_customer_profile_ids,
        seed_status = 'ACTIVE'
    where id = p_run_id and created_by = auth.uid() and seed_status = 'PREPARING';
  if not found then
    raise exception using errcode = '23505', message = 'Showcase setup is no longer active. Remove it before starting again.';
  end if;

  insert into public.services(
    name, description, category, price_amount, currency, duration_minutes,
    requires_consent, is_active, showcase_run_id
  ) values
    ('DEMO · Radiance Facial', 'Showcase-only sample service. Replace this description, duration, and price with studio-approved details before launch.', 'SHOWCASE · FACIALS', 1200, 'PHP', 60, false, true, v_run_id),
    ('DEMO · Brow Styling', 'Showcase-only sample service. No real treatment claims or studio pricing are represented.', 'SHOWCASE · BROWS', 800, 'PHP', 45, false, true, v_run_id),
    ('DEMO · Wellness Consultation', 'Showcase-only sample service. Replace with a studio-approved service and description before launch.', 'SHOWCASE · CONSULTATIONS', 500, 'PHP', 30, false, true, v_run_id),
    ('DEMO · Relaxation Ritual', 'Showcase-only sample service. Replace this description, duration, and price with studio-approved details before launch.', 'SHOWCASE · WELLNESS', 1500, 'PHP', 90, false, true, v_run_id);
  select array_agg(s.id order by s.name) into v_service_ids
    from public.services s where s.showcase_run_id = v_run_id;

  insert into public.practitioners(profile_id, display_name, bio, is_active, showcase_run_id)
    select p.id, p.full_name, 'DEMO ONLY · Sample practitioner account. Replace with an invited studio practitioner.', true, v_run_id
    from public.profiles p
    where p.id = any(p_practitioner_profile_ids);
  select array_agg(pr.id order by pr.profile_id) into v_practitioner_ids
    from public.practitioners pr where pr.showcase_run_id = v_run_id;

  insert into public.practitioner_services(practitioner_id, service_id)
    select pr.id, s.id
    from public.practitioners pr
    cross join public.services s
    where pr.showcase_run_id = v_run_id and s.showcase_run_id = v_run_id;

  insert into public.availability_schedules(
    practitioner_id, weekday, opens_at, closes_at, break_starts_at, break_ends_at, is_working
  )
    select pr.id, weekday, '09:00', '19:00', '13:00', '14:00', true
    from public.practitioners pr
    cross join generate_series(0, 6) weekday
    where pr.showcase_run_id = v_run_id;

  for v_index in 1..4 loop
    select * into v_service from public.services
      where id = v_service_ids[v_index] and showcase_run_id = v_run_id;
    v_customer_id := p_customer_profile_ids[v_index];
    v_start := case when v_index = 1
      then (v_today + time '10:00') at time zone 'Asia/Manila'
      when v_index in (2, 3)
      then ((v_today + 1) + case when v_index = 2 then time '11:00' else time '15:00' end) at time zone 'Asia/Manila'
      else ((v_today + 2) + time '11:00') at time zone 'Asia/Manila'
    end;

    insert into public.appointments(
      customer_id, practitioner_id, service_id, starts_at, ends_at, status,
      service_snapshot, source, created_by, showcase_run_id
    ) values (
      v_customer_id,
      v_practitioner_ids[case when v_index in (1, 3) then 1 else 2 end],
      v_service.id,
      v_start,
      v_start + make_interval(mins => v_service.duration_minutes),
      'BOOKED',
      jsonb_build_object(
        'name', v_service.name,
        'description', v_service.description,
        'price_amount', v_service.price_amount,
        'currency', v_service.currency,
        'duration_minutes', v_service.duration_minutes,
        'requires_consent', false,
        'showcase', true
      ),
      'WALK_IN',
      auth.uid(),
      v_run_id
    ) returning id into v_appointment_id;

    insert into public.payments(
      appointment_id, customer_id, amount, currency, status, provider, manual_reference, paid_at
    ) values (
      v_appointment_id, v_customer_id, v_service.price_amount, v_service.currency,
      'PENDING', 'MANUAL', 'DEMO ONLY · UNPAID · ' || left(v_run_id::text, 8) || '-' || v_index, null
    );

    if v_index = 1 then
      insert into public.treatment_records(
        customer_id, appointment_id, service_id, practitioner_id,
        treatment_date, details, areas_treated, products_used, notes, follow_up_recommendations,
        showcase_run_id
      ) values (
        v_customer_id, v_appointment_id, v_service.id,
        v_practitioner_ids[case when v_index in (1, 3) then 1 else 2 end],
        v_start, 'DEMO ONLY · Example treatment record for stakeholder presentation.',
        array['DEMO SAMPLE AREA'], array['DEMO SAMPLE PRODUCT'],
        'Sample record only. Not a real client record or treatment recommendation.',
        'Replace with practitioner-authored guidance after a real appointment.',
        v_run_id
      );
      update public.appointments set status = 'COMPLETED' where id = v_appointment_id;
    end if;
  end loop;
  return v_run_id;
end;
$$;

create or replace function public.clear_showcase_data(p_run_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'Administrator access is required to remove showcase data.';
  end if;
  if not exists (select 1 from public.showcase_runs where id = p_run_id) then
    raise exception using errcode = 'P0002', message = 'Showcase data was not found.';
  end if;

  perform set_config('app.allow_showcase_cleanup', 'on', true);
  delete from public.treatment_records where appointment_id in (
    select id from public.appointments where showcase_run_id = p_run_id
  );
  delete from public.consent_submissions where appointment_id in (
    select id from public.appointments where showcase_run_id = p_run_id
  );
  delete from public.payment_transactions where payment_id in (
    select id from public.payments where appointment_id in (
      select id from public.appointments where showcase_run_id = p_run_id
    )
  );
  delete from public.payments where appointment_id in (
    select id from public.appointments where showcase_run_id = p_run_id
  );
  delete from public.notifications where appointment_id in (
    select id from public.appointments where showcase_run_id = p_run_id
  );
  delete from public.appointments where showcase_run_id = p_run_id;
  delete from public.practitioner_services where practitioner_id in (
    select id from public.practitioners where showcase_run_id = p_run_id
  );
  delete from public.availability_schedules where practitioner_id in (
    select id from public.practitioners where showcase_run_id = p_run_id
  );

  delete from public.showcase_runs where id = p_run_id;
end;
$$;

grant execute on function public.begin_showcase_data(uuid) to authenticated;
grant execute on function public.abort_showcase_data(uuid) to authenticated;
grant execute on function public.seed_showcase_data(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.clear_showcase_data(uuid) to authenticated;
revoke execute on function public.begin_showcase_data(uuid) from public, anon;
revoke execute on function public.abort_showcase_data(uuid) from public, anon;
revoke execute on function public.seed_showcase_data(uuid, uuid[], uuid[]) from public, anon;
revoke execute on function public.clear_showcase_data(uuid) from public, anon;
