-- One Confirm card at a time (admin/worker/mons.js confirm): changes the card at `idx` in place,
-- and only if it's still in one of `from_states`. Writing the whole proposals array back (as before)
-- let two Confirms on the same message, a second apart, undo each other: a booking could then be
-- confirmed twice. Only the Worker calls it (secret key).
create function mons_proposal_set(msg bigint, idx int, from_states text[], patch jsonb) returns boolean
language sql security definer set search_path = '' as $$
  with changed as (
    update public.mons_messages
    set proposals = jsonb_set(proposals, array[idx::text], (proposals -> idx) || patch)
    where id = msg and from_mons and idx >= 0 and idx < jsonb_array_length(proposals)
      and (proposals -> idx ->> 'state') = any (from_states)
    returning 1
  )
  select exists (select 1 from changed)
$$;
revoke execute on function mons_proposal_set(bigint, int, text[], jsonb) from public, anon, authenticated;
grant execute on function mons_proposal_set(bigint, int, text[], jsonb) to service_role;
