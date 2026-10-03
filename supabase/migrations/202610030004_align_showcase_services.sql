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
    ('Hydra Facial', 'Listed in Juana''s public service reference. Ask the clinic about treatment details and suitability.', 'FACIAL', 0, 'PHP', 60, false, true, v_run_id),
    ('Nail Services', 'Listed in Juana''s public service reference. Ask the clinic about available options and details.', 'NAIL SERVICES', 0, 'PHP', 60, false, true, v_run_id),
    ('Beauty Drips', 'Listed in Juana''s public service reference. Confirm details and suitability with the clinic''s qualified care team.', 'BEAUTY DRIPS', 0, 'PHP', 60, false, true, v_run_id),
    ('SPMU Brows & Lashes', 'Listed in Juana''s public service reference. Ask the clinic about available options and suitability.', 'SPMU BROWS & LASHES', 0, 'PHP', 60, false, true, v_run_id),
    ('Laser Treatments', 'Listed in Juana''s public service reference. Confirm treatment details and suitability with the clinic.', 'LASER TREATMENTS', 0, 'PHP', 60, false, true, v_run_id),
    ('Aesthetic Procedures', 'Listed in Juana''s public service reference. Confirm procedure details and suitability with the clinic.', 'AESTHETIC PROCEDURES', 0, 'PHP', 60, false, true, v_run_id);
  select array_agg(s.id order by s.name) into v_service_ids
    from public.services s where s.showcase_run_id = v_run_id;

  insert into public.practitioners(profile_id, display_name, bio, is_active, showcase_run_id)
    select p.id, p.full_name, 'DEMO ONLY · Sample account; not a named practitioner or confirmed service assignment.', true, v_run_id
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
      then ((v_today - 2) + time '10:00') at time zone 'Asia/Manila'
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
