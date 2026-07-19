begin;
-- Helper-level transactional checks: no production portal, license, or storage data is written.
do $$
begin
  if private.ecommerce_portal_normalize_template('classic') <> 'classic'
    or private.ecommerce_portal_normalize_template('showcase') <> 'showcase'
    or private.ecommerce_portal_normalize_template('compact') <> 'compact' then
    raise exception 'template normalization regression';
  end if;
  if private.ecommerce_portal_normalize_theme('{"primaryColor":"#0284c7","secondaryColor":"#0369a1","cornerStyle":"rounded","fontStyle":"system"}'::jsonb)
     <> '{"primaryColor":"#0284c7","secondaryColor":"#0369a1","cornerStyle":"rounded","fontStyle":"system"}'::jsonb then
    raise exception 'theme normalization regression';
  end if;
  begin perform private.ecommerce_portal_normalize_template('custom-css'); raise exception 'expected invalid template'; exception when others then if sqlerrm not like '%ECOMMERCE_TEMPLATE_INVALID%' then raise; end if; end;
  begin perform private.ecommerce_portal_normalize_theme('["bad"]'::jsonb); raise exception 'expected invalid theme'; exception when others then if sqlerrm not like '%ECOMMERCE_THEME_INVALID%' then raise; end if; end;
  begin perform private.ecommerce_portal_normalize_theme('{"primaryColor":"rgb(1,2,3)"}'::jsonb); raise exception 'expected invalid color'; exception when others then if sqlerrm not like '%ECOMMERCE_THEME_COLOR_INVALID%' then raise; end if; end;
  begin perform private.ecommerce_portal_normalize_image_url('"javascript:alert(1)"'::jsonb); raise exception 'expected invalid URL'; exception when others then if sqlerrm not like '%ECOMMERCE_IMAGE_URL_INVALID%' then raise; end if; end;
  begin perform private.ecommerce_portal_normalize_image_url('"data:image/png;base64,x"'::jsonb); raise exception 'expected invalid URL'; exception when others then if sqlerrm not like '%ECOMMERCE_IMAGE_URL_INVALID%' then raise; end if; end;
end $$;
rollback;
