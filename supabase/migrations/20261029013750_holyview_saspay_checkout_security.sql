create unique index if not exists holyview_one_pending_saspay_payment_per_user
on public.payments (user_id)
where provider = 'saspay' and status = 'pending';

create or replace function public.holyview_activate_saspay_payment(
  p_payment_id uuid,
  p_session_id text,
  p_tier text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_offer public.subscription_offers%rowtype;
  v_active public.subscriptions%rowtype;
  v_subscription_id uuid;
  v_now timestamptz := pg_catalog.now();
begin
  if p_tier not in ('pro', 'elite') then
    raise exception 'INVALID_TIER';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.provider is distinct from 'saspay'
     or v_payment.provider_reference is distinct from p_session_id then
    raise exception 'PAYMENT_REFERENCE_MISMATCH';
  end if;

  if v_payment.currency is distinct from 'XOF'
     or coalesce(v_payment.metadata ->> 'tier', '') <> p_tier then
    raise exception 'PAYMENT_METADATA_MISMATCH';
  end if;

  select * into v_offer
  from public.subscription_offers
  where tier = p_tier::public.membership_tier
    and is_listed = true;

  if not found
     or v_offer.monthly_price_xof is null
     or v_payment.amount is distinct from v_offer.monthly_price_xof::numeric then
    raise exception 'PAYMENT_AMOUNT_MISMATCH';
  end if;

  if v_payment.status = 'succeeded' then
    if v_payment.subscription_id is null then
      raise exception 'PAYMENT_ALREADY_SUCCEEDED_WITHOUT_SUBSCRIPTION';
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'alreadyProcessed', true,
      'paymentId', v_payment.id,
      'subscriptionId', v_payment.subscription_id
    );
  end if;

  if v_payment.status <> 'pending' then
    raise exception 'PAYMENT_NOT_PENDING';
  end if;

  select * into v_active
  from public.subscriptions s
  where s.user_id = v_payment.user_id
    and s.status = 'active'
    and s.tier in ('pro'::public.membership_tier, 'elite'::public.membership_tier)
    and s.starts_at <= v_now
    and s.ends_at > v_now
  order by s.ends_at desc
  limit 1
  for update;

  if found then
    if v_active.tier = 'elite'::public.membership_tier and p_tier = 'pro' then
      raise exception 'DOWNGRADE_BLOCKED';
    end if;

    update public.subscriptions
    set tier = p_tier::public.membership_tier,
        ends_at = pg_catalog.greatest(v_active.ends_at, v_now) + interval '1 month',
        updated_at = v_now
    where id = v_active.id
    returning id into v_subscription_id;
  else
    insert into public.subscriptions (
      user_id, tier, status, starts_at, ends_at, created_at, updated_at
    )
    values (
      v_payment.user_id,
      p_tier::public.membership_tier,
      'active',
      v_now,
      v_now + interval '1 month',
      v_now,
      v_now
    )
    returning id into v_subscription_id;
  end if;

  update public.payments
  set status = 'succeeded',
      subscription_id = v_subscription_id,
      metadata = metadata || pg_catalog.jsonb_build_object(
        'verified_at', v_now,
        'verification_source', 'saspay_checkout_status',
        'tier', p_tier
      )
  where id = v_payment.id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'alreadyProcessed', false,
    'paymentId', v_payment.id,
    'subscriptionId', v_subscription_id
  );
end;
$$;

revoke all on function public.holyview_activate_saspay_payment(uuid, text, text) from public;
revoke all on function public.holyview_activate_saspay_payment(uuid, text, text) from anon;
revoke all on function public.holyview_activate_saspay_payment(uuid, text, text) from authenticated;
grant execute on function public.holyview_activate_saspay_payment(uuid, text, text) to service_role;
