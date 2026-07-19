-- Run inside BEGIN/ROLLBACK against a disposable authorized fixture.
begin;
do $$
declare v_default jsonb := private.ecommerce_site_default_document('classic');
begin
  if private.ecommerce_site_document_error(v_default) is not null then raise exception 'default document must validate'; end if;
  if private.ecommerce_site_document_error(jsonb_set(v_default,'{sections}','[]'::jsonb)) <> 'ECOMMERCE_SITE_REQUIRED_SECTION_MISSING' then raise exception 'missing required section must be rejected'; end if;
  if private.ecommerce_site_document_error(jsonb_set(v_default,'{sections,0,id}','"catalog-main"'::jsonb)) <> 'ECOMMERCE_SITE_DUPLICATE_SECTION' then raise exception 'duplicate section must be rejected'; end if;
  if private.ecommerce_site_checksum(v_default) <> private.ecommerce_site_checksum(v_default) then raise exception 'checksum must be stable'; end if;
end;
$$;
rollback;
