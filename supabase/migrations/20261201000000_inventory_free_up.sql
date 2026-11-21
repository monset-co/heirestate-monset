-- Inventory on its "available from" date: each night just after midnight in Manila, a property whose
-- date has come is marked available. Rented becomes For Rent, the "not available" tick is lifted and
-- the date is cleared (it has done its job). Sold ones are left alone. The activity log records each
-- change with no one's email: that's this job.
create extension if not exists pg_cron;

create function inventory_free_up() returns void
language sql security definer set search_path = '' as $$
  update public.inventory set
    status = case when 'For Rent' = any(status) then array_remove(status, 'Rented') else array_replace(status, 'Rented', 'For Rent') end,
    available = true,
    available_from = null
  where available_from <= (now() at time zone 'Asia/Manila')::date
    and not ('Sold' = any(status));
$$;
revoke all on function inventory_free_up() from public, anon, authenticated;

-- 00:05 Manila is 16:05 UTC
select cron.schedule('inventory-free-up', '5 16 * * *', 'select public.inventory_free_up()');
