# FASE ECOM.0 — Contrato de portal publico / ecommerce

## Objetivo

Dejar definida la estructura funcional y tecnica del portal publico antes de construir la UI del carrito, las rutas publicas y la bandeja de pedidos.

Esta fase establece:

- Limites por licencia FREE/PRO.
- Estructura de la pagina publica que compartira cada negocio.
- Que sera editable segun plan.
- Comportamiento por rubro.
- Manejo de horarios.
- Manejo de stock.
- Flujo de pedido.
- Notificacion al sistema.
- Flujo WhatsApp.
- Tablas base para portal, productos publicados, horarios y pedidos.

Fuera de alcance en esta fase:

- No se crea UI publica todavia.
- No se crea carrito todavia.
- No se crean RPCs publicas todavia.
- No se convierte pedido a venta POS todavia.
- No se afecta caja ni inventario todavia.
- No se envia WhatsApp automatico por API todavia.

---

## Decision principal

El portal no debe depender de IndexedDB ni del navegador del negocio.

Aunque FREE siga siendo local para POS, el portal publico necesita una capa cloud minima para:

- alojar la configuracion publica del portal;
- mostrar productos publicados;
- recibir pedidos entrantes;
- permitir que el sistema vea pedidos pendientes;
- generar mensaje de WhatsApp con resumen del pedido.

Esto no activa cloud POS completo en FREE. Solo activa una nube limitada de ecommerce.

---

## URL publica

Formato recomendado:

```txt
https://lanzo-pos.vercel.app/tienda/:slug
```

Ejemplo:

```txt
https://lanzo-pos.vercel.app/tienda/entre-alas
```

Reglas:

- Nunca exponer `license_key` en la URL.
- El `slug` debe ser publico, unico y sanitizado.
- FREE usara slug generado por el sistema.
- PRO podra editar slug personalizado.

---

## Limites por licencia

### FREE

- Portal publico: si.
- Productos publicados: maximo 10.
- WhatsApp checkout: si.
- Bandeja de pedidos en sistema: si.
- Slug personalizado: no.
- Plantilla: fija / basica.
- Branding: basico.
- Horarios: si.
- Delivery/pickup: basico.
- Stock visible: no.
- Reserva de stock: no.
- Pedidos realtime: no; usar polling o refresh controlado.
- Fuente de catalogo: snapshot cloud limitado, originado desde productos locales.
- Conversion automatica a venta: no en la primera fase.

### PRO

- Portal publico: si.
- Productos publicados: ilimitados (`-1`).
- WhatsApp checkout: si.
- Bandeja de pedidos en sistema: si.
- Slug personalizado: si.
- Plantilla: editable / avanzada.
- Branding: avanzado.
- Horarios: si.
- Delivery/pickup: avanzado.
- Stock visible: si.
- Reserva de stock: si, solo cuando se implemente confirmacion segura.
- Pedidos realtime: si.
- Fuente de catalogo: catalogo cloud (`pos_products`) mediante productos publicados.
- Conversion a venta/pedido POS: en fase posterior, con confirmacion del usuario.

---

## Estructura de la pagina publica

### 1. Encabezado

Debe mostrar:

- Logo del negocio si existe.
- Nombre del negocio.
- Rubro o descripcion corta.
- Estado de horario: abierto, cerrado, abre pronto.
- Boton de WhatsApp/contacto.

FREE:

- Nombre, logo y descripcion basica.
- Plantilla fija.

PRO:

- Nombre, logo, portada, slogan, colores, secciones destacadas.

---

### 2. Aviso operacional

Debe mostrar mensajes utiles como:

- Cerrado por horario.
- Solo pedidos para recoger.
- Delivery disponible.
- Tiempo estimado.
- Pedido sujeto a confirmacion.

Regla importante:

El portal no debe prometer que el pedido ya fue aceptado. Debe decir que fue enviado/registrado y que el negocio confirmara.

---

### 3. Categorias

Debe mostrar categorias publicadas.

FREE:

- Categorias simples derivadas de los 10 productos publicados.

PRO:

- Categorias cloud, ordenables y con mas opciones visuales.

---

### 4. Productos

Cada producto debe mostrar:

- Nombre publico.
- Descripcion publica.
- Precio.
- Imagen si esta disponible.
- Categoria.
- Disponibilidad.
- Boton agregar al carrito.

No debe mostrar:

- Costo.
- Stock interno exacto en FREE.
- `license_id`.
- `license_key`.
- `server_version`.
- Metadata interna.
- Informacion de lotes.

---

### 5. Carrito

Debe incluir:

- Productos agregados.
- Cantidad.
- Subtotal.
- Total estimado.
- Notas del cliente.
- Metodo: recoger o entrega.
- Datos del cliente: nombre y telefono.
- Direccion si es entrega.

Regla de seguridad:

El total final se recalcula en Supabase. El frontend publico no es fuente confiable de precios.

---

### 6. Confirmacion de pedido

Despues de crear pedido:

- Mostrar numero de pedido.
- Mostrar resumen.
- Mostrar boton para WhatsApp.
- Abrir WhatsApp con mensaje prellenado si el navegador lo permite.

Mensaje sugerido:

```txt
Hola, quiero realizar este pedido:

Pedido: EC-00000001
Negocio: {nombre_negocio}

Productos:
- 2 x Alitas Mango Habanero = $160.00
- 1 x Papas = $35.00

Total estimado: $195.00
Nombre: {cliente}
Telefono: {telefono}
Entrega: {recoger|domicilio}
Notas: {notas}
```

---

## Rubros

### Restaurante / comida

Debe priorizar:

- Menu por categorias.
- Modificadores o notas.
- Pickup/delivery.
- Horario visible.
- Tiempo estimado.
- Estado de preparacion en fases posteriores.

Para comida, el pedido debe entrar como solicitud, no como venta definitiva.

---

### Tienda / retail

Debe priorizar:

- Catalogo por categorias.
- Fotos.
- Disponibilidad.
- SKU opcional.
- Variantes en fase posterior.

PRO puede mostrar stock como:

- Disponible.
- Pocas piezas.
- Agotado.
- Cantidad exacta solo si el negocio lo activa.

---

### Farmacia

Debe ser conservador:

- No publicar medicamentos controlados o que requieran receta sin validacion legal adicional.
- No mostrar campos clinicos internos.
- No permitir checkout automatico de productos restringidos.
- Usar el portal como solicitud de contacto/cotizacion cuando aplique.

---

### Servicios u otros rubros

Puede funcionar como catalogo/solicitud:

- Servicio.
- Precio desde.
- Notas.
- Solicitar por WhatsApp.

---

## Horarios

Se implementa estructura para:

- Horarios por dia de la semana.
- Excepciones por fecha.
- Portal abierto/cerrado.

Comportamiento inicial recomendado:

- Si esta cerrado, permitir ver catalogo.
- Permitir o bloquear pedidos segun configuracion del negocio.
- Mostrar mensaje claro: “Estamos cerrados. Puedes enviar tu pedido, pero sera confirmado en horario de atencion.”

---

## Stock

### FREE

- No muestra stock.
- No reserva stock.
- No descuenta inventario.
- Pedido queda como solicitud pendiente.

### PRO

- Puede mostrar disponibilidad.
- Puede mostrar stock exacto si el negocio lo activa.
- Puede reservar stock en fase posterior.
- No se descuenta inventario hasta que el negocio acepte o convierta el pedido.

Regla principal:

El carrito publico nunca debe descontar inventario por si solo.

---

## Flujo de pedido

1. Cliente abre link publico.
2. Cliente revisa catalogo.
3. Cliente agrega productos al carrito.
4. Cliente captura nombre, telefono, metodo y notas.
5. Frontend envia `product_id`/`published_product_id` y cantidades.
6. Supabase recalcula precios y valida disponibilidad.
7. Se crea `ecommerce_orders` y `ecommerce_order_items`.
8. Se guarda evento en `ecommerce_order_events`.
9. El sistema del negocio muestra pedido en bandeja.
10. El frontend genera mensaje WhatsApp prellenado.
11. Cliente envia WhatsApp manualmente.
12. El negocio acepta/rechaza/convierte pedido en fase posterior.

---

## Notificacion en el sistema

### FREE

- El POS consultara pedidos pendientes con polling controlado.
- Mostrar badge en `Pedidos` o nueva entrada `Pedidos online`.
- El pedido no afecta caja ni inventario.
- El usuario lo atiende manualmente.

### PRO

- El POS recibira pedidos por realtime.
- Mostrar toast/badge/modal no intrusivo.
- Bandeja con estados:
  - Nuevo
  - Visto
  - Aceptado
  - Preparando
  - Listo
  - Completado
  - Cancelado
- Conversion a venta/pedido interno con confirmacion.

---

## WhatsApp

### Fase inicial

Se usara WhatsApp Click-to-Chat:

- El sistema crea el pedido primero.
- Luego genera mensaje prellenado.
- El cliente debe presionar enviar en WhatsApp.

Esto es intencional porque sin WhatsApp Cloud API no se puede garantizar envio automatico real.

Feature actual:

```txt
ecommerce_whatsapp_autosend = false
```

### Fase futura

Se podra agregar WhatsApp Cloud API para envio automatico real al negocio, pero eso requiere:

- Cuenta Meta Business.
- Numero autorizado.
- Plantillas si aplica.
- Webhooks.
- Costos y cumplimiento de politicas de WhatsApp.

---

## Tablas creadas por la migracion

- `public.ecommerce_portals`
- `public.ecommerce_portal_hours`
- `public.ecommerce_portal_hour_exceptions`
- `public.ecommerce_published_products`
- `public.ecommerce_orders`
- `public.ecommerce_order_items`
- `public.ecommerce_order_events`

Todas quedan con RLS activo y acceso directo cerrado para `anon`/`authenticated`.

Las siguientes fases deberan exponer RPCs `SECURITY DEFINER` con validacion estricta.

---

## RPCs de fases siguientes

### Publicas

- `ecommerce_get_portal_by_slug(p_slug text)`
- `ecommerce_get_catalog(p_slug text)`
- `ecommerce_create_order(p_slug text, p_customer jsonb, p_items jsonb, p_idempotency_key text)`

### Internas POS

- `ecommerce_get_my_portal(...)`
- `ecommerce_upsert_my_portal(...)`
- `ecommerce_publish_product(...)`
- `ecommerce_unpublish_product(...)`
- `ecommerce_list_orders(...)`
- `ecommerce_update_order_status(...)`

---

## Reglas de seguridad obligatorias para la siguiente fase

- No exponer `license_key` ni `license_id` al publico.
- No leer tablas POS directas desde anon.
- No confiar en precios del frontend.
- Recalcular total en Supabase.
- Rate limit para crear pedidos.
- Idempotency key obligatoria.
- Maximo de items por pedido.
- Maxima cantidad por item.
- Sanitizar nombre, telefono, notas y direccion.
- Registrar eventos de pedido.
- Mantener FREE limitado a 10 productos publicados.
- Mantener PRO sin limite de productos publicados.

---

## Estado de esta fase

Implementado en migracion:

```txt
supabase/migrations/20260708033000_ecom_0_portal_contract.sql
```

Pendiente en fases posteriores:

- RPCs publicas.
- UI de configuracion del portal.
- Ruta publica `/tienda/:slug` fuera del gate de licencia.
- Carrito publico.
- Bandeja de pedidos online.
- Notificaciones FREE polling / PRO realtime.
- Integracion con ventas/caja/inventario con confirmacion.
