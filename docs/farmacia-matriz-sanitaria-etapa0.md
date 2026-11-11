# Farmacia — matriz sanitaria preliminar (Etapa 0, 11-nov-2026)

**Alcance:** referencia de diseño, NO autorización ni certificación sanitaria. Cada clasificación, obligación y flujo operativo debe confirmarse con el responsable sanitario y disposiciones mexicanas vigentes.

| LGS art. 226 | Obligación legal resumida | Situación en LANZO POS |
| --- | --- | --- |
| I | Receta o permiso especial de Secretaría de Salud; controles específicos del capítulo V. | Sin captura/validación de permiso; no hay libro autorizado. |
| II | Receta médica retenida y asiento en libros de control; reglas particulares de vigencia. | Sin constancia de retención ni libro autorizado. |
| III | Hasta tres surtidos de una receta, sellado y registro en libro en cada uno; retención en el tercero. | Sin control de surtidos/sellos/retención o libro autorizado. |
| IV | Requiere receta y se resurte según lo indicado por el prescriptor. | No se verifica indicación, vigencia ni resurtidos. |
| V | Sin receta, venta exclusivamente en farmacias. | No hay fracción legal persistida. |
| VI | Sin receta, venta posible en otros establecimientos. | No hay fracción legal persistida. |

**Antibióticos (condición independiente de fracción):** el Acuerdo DOF del 27/05/2010 requiere receta y registro de adquisiciones, ventas, dispensaciones y desechos, con fechas, denominación, presentación, cantidad y datos del prescriptor o referencia correlativa de receta retenida. Exige sellado y conservación de recetas retenidas y su registro por 365 días. La bandera \`prescriptionType='antibiotic'\` no demuestra una clasificación legal particular.

**Implementado en Etapa 0:** formulario con \`prescriptionType\` (otc/antibiotic/controlled), \`requiresPrescription\`, \`activeSubstance\`; la venta guarda \`prescriptionDetails\` (médico/cédula/notas) a nivel de venta. Reporte auxiliar CSV desde ventas locales con incidencias; no sustituye recetas originales, libros de control ni el registro específico de antibióticos.

**Pendiente antes de operación regulada:** clasificación I–VI validada por medicamento; bandera independiente de antibiótico; referencia, evidencia, sellado y retención de recetas; control de surtidos; entradas, desechos, lote y saldos cuando sean exigibles; correlación con libros autorizados, validación de responsable sanitario, políticas de privacidad y consolidación fiable por negocio/dispositivo. El campo genérico \`controlled\` no asigna fracción.

**Límite histórico estructural:** las líneas guardan snapshots del carrito; pueden carecer de tipo, bandera o sustancia. Algunos mapeadores Cloud conservan sólo la bandera de receta. No se usan datos del catálogo actual para aparentar estado histórico. Con receta y ninguna línea atribuible se emite una fila sin medicamento para revisión. Si faltan clasificación Y receta, no hay indicios para incluir la operación: la cobertura es incompleta. No incluye compras, desechos, balances, recetas ni ventas de otros dispositivos.

**Fuentes oficiales:**
- [Ley General de Salud, arts. 226-227](https://www.ordenjuridico.gob.mx/Documentos/Federal/html/wo11037.html).
- [Acuerdo DOF de antibióticos, 27/05/2010](https://www.dof.gob.mx/nota_detalle.php?codigo=5144336&fecha=27/05/2010).
- [COFEPRIS, autorización de libros de control (03-005)](https://www.gob.mx/public/tramites/detalleTramite.xhtml?homoclave=COFEPRIS-03-005).
- FEUM/Suplemento de establecimientos aplicable: versión y alcance por confirmar con responsable sanitario.
