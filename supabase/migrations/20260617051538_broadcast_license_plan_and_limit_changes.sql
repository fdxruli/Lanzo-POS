create or replace function public.notify_license_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_changed_fields text[] := array[]::text[];
    v_event_type text;
    v_metadata jsonb;
    v_old_plan_code text;
    v_new_plan_code text;
    v_old_plan_name text;
    v_new_plan_name text;
begin
    if old.plan_id is distinct from new.plan_id then
        v_changed_fields := array_append(v_changed_fields, 'plan_id');
    end if;

    if old.max_devices is distinct from new.max_devices then
        v_changed_fields := array_append(v_changed_fields, 'max_devices');
    end if;

    if old.product_name is distinct from new.product_name then
        v_changed_fields := array_append(v_changed_fields, 'product_name');
    end if;

    if old.status is distinct from new.status then
        v_changed_fields := array_append(v_changed_fields, 'status');
    end if;

    if old.expires_at is distinct from new.expires_at then
        v_changed_fields := array_append(v_changed_fields, 'expires_at');
    end if;

    if old.features is distinct from new.features then
        v_changed_fields := array_append(v_changed_fields, 'features');
    end if;

    if array_length(v_changed_fields, 1) is null then
        return new;
    end if;

    select p.code, p.name
    into v_old_plan_code, v_old_plan_name
    from public.plans p
    where p.id = old.plan_id;

    select p.code, p.name
    into v_new_plan_code, v_new_plan_name
    from public.plans p
    where p.id = new.plan_id;

    v_event_type := case
        when old.plan_id is distinct from new.plan_id then 'PLAN_CHANGED'
        else 'LICENSE_UPDATE'
    end;

    v_metadata := jsonb_build_object(
        'source', 'licenses_update_trigger',
        'changed_fields', to_jsonb(v_changed_fields),
        'status', new.status,
        'plan', v_new_plan_code,
        'plan_name', v_new_plan_name,
        'max_devices', new.max_devices,
        'product_name', new.product_name
    );

    if old.plan_id is distinct from new.plan_id then
        v_metadata := v_metadata || jsonb_build_object(
            'from_plan', v_old_plan_code,
            'to_plan', v_new_plan_code,
            'from_plan_name', v_old_plan_name,
            'to_plan_name', v_new_plan_name
        );
    end if;

    if old.max_devices is distinct from new.max_devices then
        v_metadata := v_metadata || jsonb_build_object(
            'old_max_devices', old.max_devices,
            'new_max_devices', new.max_devices
        );
    end if;

    insert into public.license_events (license_key, event_type, metadata)
    values (new.license_key, v_event_type, v_metadata);

    return new;
end;
$function$;;
