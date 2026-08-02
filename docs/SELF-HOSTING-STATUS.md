# Estado del autohospedaje

## Resumen

Lanzo-POS utiliza React y Vite en el frontend, Dexie sobre IndexedDB para persistencia local, Supabase para capacidades administradas y Vercel para superficies de despliegue. El repositorio contiene el frontend principal, la tienda pública, migraciones y varias Edge Functions.

Este documento describe el estado actual. No es una guía completa de instalación ni certifica que un despliegue autohospedado sea reproducible de extremo a extremo.

## Dependencias de la operación oficial

La operación oficial depende de configuración administrada que incluye, entre otros elementos, proyectos, variables, secretos, políticas, dominios, almacenamiento, funciones y procesos de despliegue. Parte de esa configuración no debe copiarse ni reutilizarse fuera de los entornos autorizados.

No utilices infraestructura, datos, credenciales, tokens, proyectos, buckets, dominios ni secretos de producción de Lanzo para preparar un entorno propio.

## Identidad del tenant y clave permanente

La clave permanente identifica al tenant y conecta el perfil del negocio con productos, dispositivos, ecommerce y pedidos. En la implementación aparecen campos como `license_id` para conservar esa relación operativa.

`license_id` no debe eliminarse como parte de una iniciativa de apertura o autohospedaje sin un rediseño arquitectónico completo y validado. La clave permanente del negocio no es la licencia jurídica del código y no determina si el software está o no bajo AGPL.

## Estado de certificación

El autohospedaje de extremo a extremo todavía no está certificado. Antes de publicar una guía final deben validarse, como mínimo:

- versiones soportadas de Node;
- variables de entorno requeridas y sus alcances;
- orden, prerrequisitos y compatibilidad de migraciones;
- políticas RLS;
- configuración de Storage;
- despliegue y secretos de Edge Functions;
- dominios y orígenes permitidos;
- despliegue independiente de la tienda pública;
- procedimientos de actualización;
- respaldo;
- restauración;
- separación entre configuración pública y secretos reales.

No existe todavía soporte oficial garantizado para Docker. La presencia futura de archivos de contenedor tampoco deberá interpretarse como soporte certificado hasta completar pruebas limpias y reproducibles.

## Limitaciones actuales

No se deben inventar comandos de despliegue ni copiar valores de entornos oficiales. Una instalación parcial del frontend no demuestra que funcionen correctamente autenticación, sincronización, RLS, Storage, Edge Functions, ecommerce, pedidos, recuperación ni actualizaciones.

Una guía final de autohospedaje será preparada después de completar una instalación limpia reproducible, documentar los requisitos y verificar actualización, respaldo y restauración en un entorno aislado.

## Estado de licenciamiento

`AGPL-3.0-only` es la licencia prevista, no vigente. Todavía no existe un archivo `LICENSE`; el repositorio permanece bajo los derechos aplicables por defecto y este documento no concede nuevos permisos jurídicos.
