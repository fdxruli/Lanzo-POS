-- ECOM.PORTAL.BUILDER.3 pure-contract checks. Run inside a transaction and roll back.
begin;

with default_document as (
  select private.ecommerce_site_default_document_v2('classic', '{"primaryColor":"#112233","secondaryColor":"#445566","cornerStyle":"soft","fontStyle":"editorial"}'::jsonb, null, null) as document
)
select
  private.ecommerce_site_document_error(document) is null as default_is_valid,
  private.ecommerce_site_document_error(jsonb_set(document, '{global,appearance,theme}', '{}'::jsonb)) = 'ECOMMERCE_SITE_DOCUMENT_INVALID' as empty_theme_rejected,
  private.ecommerce_site_document_error(document #- '{global,appearance,theme,primaryColor}') = 'ECOMMERCE_SITE_DOCUMENT_INVALID' as missing_primary_color_rejected,
  private.ecommerce_site_document_error(document #- '{global,appearance,branding}') = 'ECOMMERCE_SITE_DOCUMENT_INVALID' as missing_branding_rejected,
  private.ecommerce_site_document_error(document #- '{global,appearance,branding,logoUrl}') = 'ECOMMERCE_SITE_DOCUMENT_INVALID' as missing_logo_rejected,
  private.ecommerce_site_document_error(jsonb_set(document, '{global,appearance,branding,logoUrl}', '"blob:preview"'::jsonb)) = 'ECOMMERCE_SITE_DOCUMENT_INVALID' as blob_rejected,
  private.ecommerce_site_document_error(jsonb_set(document, '{global,appearance,branding,logoUrl}', '"data:text/plain,x"'::jsonb)) = 'ECOMMERCE_SITE_DOCUMENT_INVALID' as data_rejected,
  private.ecommerce_site_document_error(jsonb_set(document, '{global,appearance,branding,logoUrl}', '"http://example.com/logo.png"'::jsonb)) = 'ECOMMERCE_SITE_DOCUMENT_INVALID' as http_rejected,
  private.ecommerce_site_document_error(jsonb_set(document, '{global,appearance,branding,logoUrl}', to_jsonb('https://example.com/' || repeat('a', 2030)))) = 'ECOMMERCE_SITE_DOCUMENT_INVALID' as long_url_rejected,
  private.ecommerce_site_document_error(jsonb_set(document, '{global,appearance,theme,primaryColor}', 'null'::jsonb)) = 'ECOMMERCE_SITE_DOCUMENT_INVALID' as null_color_rejected,
  private.ecommerce_site_document_error(jsonb_set(document, '{global,appearance,branding,logoUrl}', 'null'::jsonb)) is null as null_logo_accepted,
  private.ecommerce_site_document_error(jsonb_set(document, '{global,appearance,branding,coverImageUrl}', 'null'::jsonb)) is null as null_cover_accepted,
  private.ecommerce_site_document_error(jsonb_set(document, '{global,appearance,theme,unknown}', '"x"'::jsonb)) = 'ECOMMERCE_SITE_DOCUMENT_INVALID' as unknown_key_rejected,
  private.ecommerce_site_document_error_v1(private.ecommerce_site_project_document_v2_to_v1(document)) is null as v1_projection_is_valid
from default_document;

rollback;
