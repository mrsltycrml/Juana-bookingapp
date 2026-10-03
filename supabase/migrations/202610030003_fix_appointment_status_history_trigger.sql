create or replace function public.record_appointment_status()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.appointment_status_history(
      appointment_id, previous_status, new_status, changed_by, showcase_run_id
    ) values (new.id, null, new.status, auth.uid(), new.showcase_run_id);
  elsif new.status is distinct from old.status then
    insert into public.appointment_status_history(
      appointment_id, previous_status, new_status, changed_by, showcase_run_id
    ) values (new.id, old.status, new.status, auth.uid(), new.showcase_run_id);
  end if;
  return new;
end;
$$;

drop trigger if exists appointment_status_history_trigger on public.appointments;
create trigger appointment_status_history_trigger
  after insert or update of status on public.appointments
  for each row execute procedure public.record_appointment_status();
