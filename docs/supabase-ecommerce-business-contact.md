# Contacto y domicilio del portal ecommerce en Supabase

## Objetivo

La migración
`supabase/migrations/20260726133923_ecommerce_portal_business_contact_requirements.sql`
incorpora información estructurada del negocio al portal ecommerce y evita que
una tienda se publique sin datos suficientes para que el cliente pueda
contactarla o ubicar el punto de atención.

## Campos agregados

La tabla `public.ecommerce_portals` ahora contiene:

| Columna | Uso | Requisito |
| --- | --- | --- |
| `contact_email` | Correo público de contacto | Opcional; formato de correo y máximo 254 caracteres |
| `address_street` | Calle o avenida | Obligatorio para publicar; acepta `S/N` |
| `address_neighborhood` | Colonia, barrio o ejido | Obligatorio para publicar; acepta `S/N` |
| `address_municipality` | Municipio o alcaldía | Obligatorio para publicar; mínimo 2 caracteres y no acepta `S/N` |
| `address_state` | Estado | Obligatorio para publicar y no acepta `S/N` |
| `address_postal_code` | Código postal | Obligatorio para publicar; exactamente 5 dígitos |

La columna existente `address` se conserva por compatibilidad y se genera
automáticamente a partir de los componentes anteriores, con el formato:

```text
Calle, Colonia/Ejido, Municipio, Estado, C.P. 00000
```

El teléfono `whatsapp_phone`, que ya existía, también pasa a ser obligatorio
para publicar y debe contener al menos 8 dígitos después de normalizarlo.

## Persistencia y contratos

La función `public.ecommerce_admin_upsert_portal`:

- normaliza el WhatsApp dejando únicamente dígitos;
- normaliza el correo a minúsculas;
- limpia espacios en los componentes del domicilio;
- compone y persiste la dirección completa;
- conserva el nombre del negocio después de su primera creación;
- devuelve errores específicos cuando un dato es inválido o falta al publicar.

Los serializadores `private.ecommerce_admin_portal_jsonb` y
`private.ecommerce_portal_public_jsonb` incluyen los nuevos campos con nombres
camelCase:

```text
contactEmail
address
addressStreet
addressNeighborhood
addressMunicipality
addressState
addressPostalCode
```

Esto permite que el panel vuelva a cargar los valores guardados y que el
ecommerce público muestre los datos de contacto y recolección. El correo y el
domicilio son, por diseño, información pública del negocio; no deben usarse
estos campos para secretos ni datos internos.

## Reglas para publicar

Una tienda en estado `draft` o `paused` puede guardar información incompleta
para continuar configurándola después. Al cambiar a `published`, Supabase exige:

1. WhatsApp válido.
2. Calle o avenida.
3. Colonia, barrio o ejido.
4. Municipio.
5. Estado.
6. Código postal mexicano de 5 dígitos.

Las reglas están aplicadas tanto en la función de guardado como mediante
restricciones `CHECK` en la tabla. Así, la protección no depende únicamente de
la interfaz.

## Errores relevantes

- `ECOMMERCE_CONTACT_EMAIL_INVALID`
- `ECOMMERCE_WHATSAPP_INVALID`
- `ECOMMERCE_WHATSAPP_REQUIRED_TO_PUBLISH`
- `ECOMMERCE_ADDRESS_STREET_REQUIRED_TO_PUBLISH`
- `ECOMMERCE_ADDRESS_NEIGHBORHOOD_REQUIRED_TO_PUBLISH`
- `ECOMMERCE_ADDRESS_MUNICIPALITY_REQUIRED_TO_PUBLISH`
- `ECOMMERCE_ADDRESS_STATE_REQUIRED_TO_PUBLISH`
- `ECOMMERCE_ADDRESS_POSTAL_CODE_INVALID`
- `ECOMMERCE_ADDRESS_POSTAL_CODE_REQUIRED_TO_PUBLISH`
- `ECOMMERCE_ADDRESS_REQUIRED_TO_PUBLISH`

## Verificación

La cobertura SQL se encuentra en:

`supabase/tests/ecom_portal_business_contact_requirements_test.sql`

La prueba comprueba las columnas, restricciones, contratos JSON, permisos de
las funciones y el bloqueo del cambio de nombre. También se añadieron pruebas
de interfaz y servicios para confirmar que los valores guardados vuelven a
hidratar el formulario y llegan al catálogo público.

## Cambio relacionado

La migración
`supabase/migrations/20260726173547_ecommerce_public_store_business_type_label.sql`
actualiza el contrato público para tomar el rubro desde
`business_types_snapshot`, con compatibilidad hacia el campo heredado
`business_type`. Este dato se presenta junto a la etiqueta “Tienda online” en
el encabezado público.
