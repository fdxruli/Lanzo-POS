-- Publica las políticas vigentes en el catálogo legal consultado por la aplicación.
-- Conserva versiones previas: solo desactiva el documento activo anterior y agrega nuevas filas.
update public.legal_terms
set is_active = false
where is_active = true
  and type in (
    'terms_of_use'::public.legal_doc_type,
    'privacy_policy'::public.legal_doc_type,
    'ai_policy'::public.legal_doc_type,
    'payment_policy'::public.legal_doc_type,
    'refund_policy'::public.legal_doc_type,
    'legal_notice'::public.legal_doc_type
  );

insert into public.legal_terms (type, version, content_html, is_active, published_at)
values
  ('terms_of_use'::public.legal_doc_type, 'v2.0-20261008', $lanzo_terms_of_use$
<h2>Términos de uso de Lanzo POS</h2>
<p><strong>Versión:</strong> 2.0 · <strong>Última actualización:</strong> 8 de octubre de 2026</p>
<h3>1. Quién presta el servicio</h3>
<p>Lanzo POS es un servicio de software operado por <strong>Ruly Sebastián Montejo</strong>, persona física, con domicilio en <strong>Ejido 20 de Abril, municipio de La Trinitaria, Chiapas, C.P. 30165, México</strong>. El contacto para soporte y asuntos relacionados con el servicio es <strong>lanzocontacto@gmail.com</strong>.</p>
<p>Lanzo POS es una marca comercial independiente de Entre Alas. La marca identifica el software, pero no constituye una persona moral distinta de la persona física indicada arriba.</p>
<p>En estos términos, “Lanzo”, “nosotros” y “nuestro” se refieren a la persona proveedora y al servicio Lanzo POS. “Tú”, “titular” o “usuario” se refieren a la persona que crea o utiliza una cuenta, licencia o acceso.</p>
<h3>2. A quién se dirige y aceptación</h3>
<p>Lanzo POS se ofrece a personas de 18 años o más que tengan capacidad para aceptar estos términos. Al crear una cuenta, activar una licencia o utilizar una función, declaras que tienes esa edad y que la información que proporcionas es correcta.</p>
<p>Si creas accesos para personal, debes contar con autorización para hacerlo, asignar permisos adecuados y retirar los accesos cuando dejen de ser necesarios. La aceptación de estos términos no sustituye la entrega del Aviso de privacidad ni los consentimientos que la ley requiera para tratamientos concretos.</p>
<h3>3. Modalidades</h3>
<p><strong>Lanzo Free/Local.</strong> Las funciones locales guardan la información operativa en el dispositivo donde se utiliza el sistema. La activación de licencia, la seguridad, la autorización de dispositivos, el soporte y cualquier función que expresamente requiera internet pueden comunicarse con servidores.</p>
<p><strong>Lanzo Pro/Nube.</strong> Sincroniza y almacena en infraestructura remota la información operativa registrada para prestar los módulos en la nube. Según las funciones usadas, puede incluir ventas, productos, inventarios, clientes, caja, movimientos, cuentas por cobrar, pedidos, perfiles y configuraciones del negocio.</p>
<p>Algunas funciones —por ejemplo, sincronización, portal y pedidos en línea, soporte y ciertos análisis de Lía— requieren conexión a internet. Si una función necesita conexión, la pantalla o su documentación debe explicarlo antes de usarla.</p>
<h3>4. Licencia, cuenta y dispositivos</h3>
<p>La licencia autoriza el uso de las funciones y del número de dispositivos que indique el plan o la pantalla de activación. No debes compartir, revender, sublicenciar, eludir límites técnicos ni utilizar credenciales ajenas.</p>
<p>Debes mantener seguras tus credenciales, revisar los dispositivos y usuarios autorizados y avisar a soporte si detectas acceso no reconocido. El titular del negocio administra los permisos de su equipo y es responsable de las instrucciones que dé desde su cuenta, sin perjuicio de las obligaciones que correspondan a Lanzo.</p>
<h3>5. Uso permitido y responsabilidades del negocio</h3>
<p>Puedes utilizar Lanzo para administrar las operaciones lícitas de tu negocio. No debes usarlo para fraude, actividades ilícitas, vulnerar derechos de terceros, intentar acceder a información de otro negocio, interferir con el servicio o introducir software malicioso.</p>
<p>Eres responsable de la exactitud de la información que registras, de tus precios, impuestos, inventario, cobros y decisiones comerciales. También debes mantener tus respaldos razonables y revisar los reportes antes de tomar decisiones.</p>
<p>Si incorporas datos de tus clientes, empleados o proveedores, debes contar con la autorización o base legal correspondiente, informarles cuando la ley lo requiera y atender sus solicitudes. No registres información personal que no sea necesaria para la operación. No incluyas datos sensibles, contraseñas, números completos de tarjetas, NIP o códigos de seguridad en campos libres ni en Lía.</p>
<p>El negocio que utiliza una tienda o portal de pedidos de Lanzo es responsable de los productos que ofrece, sus precios, disponibilidad, entrega, garantías, cancelaciones, devoluciones y atención a compradores. Lanzo proporciona una herramienta tecnológica y no se convierte por ese solo hecho en vendedor de los productos del negocio.</p>
<h3>6. Información y propiedad</h3>
<p>Tú o el negocio conservan sus derechos sobre la información que incorporan. Nos autorizas a alojarla, sincronizarla, respaldarla, transmitirla a proveedores necesarios y mostrarla únicamente en la medida requerida para prestar, proteger y dar soporte al servicio, cumplir obligaciones legales o atender una reclamación.</p>
<p>Lanzo conserva los derechos sobre el software, diseño, marca y materiales propios. No adquieres derechos de propiedad sobre ellos por utilizar el servicio.</p>
<p>Lanzo no vende datos del negocio ni pretende utilizar registros de ventas, clientes o inventarios para publicidad propia o para entrenar un modelo propio. Esta declaración no describe ni reemplaza las condiciones del proveedor externo cuando el usuario solicita una función de Lía que requiere ese proveedor; la información específica aparece en el Aviso de privacidad y la Política de Lía.</p>
<h3>7. Lía e inteligencia artificial</h3>
<p>Lía ofrece respuestas y análisis de apoyo. Algunas funciones pueden responder mediante reglas o cálculos del propio sistema; otras pueden enviar una pregunta y el contexto comercial seleccionado a un proveedor de IA externo.</p>
<p>La transmisión al proveedor ocurre al solicitar una función que necesita ese procesamiento externo, no solo por tener la aplicación instalada. El contexto puede incluir métricas agregadas, productos o categorías, periodos, precios, costos o márgenes. La pregunta libre también puede contener información que tú escribas.</p>
<p>No uses Lía como fuente única para decisiones contables, fiscales, jurídicas, médicas o financieras. Las respuestas pueden ser incompletas o equivocadas: verifica los datos y utiliza criterio propio. La Política de Lía detalla el uso y los límites de esta función.</p>
<h3>8. Precio y pagos</h3>
<p>El precio de Lanzo Nube es <strong>MXN $129 por mes</strong>. Antes de cualquier pago se confirmará el importe total y, en su caso, los impuestos aplicables. Lanzo no agrega comisiones que no se hayan informado; tu banco podría aplicar sus propios cargos por la transferencia.</p>
<p>Actualmente el pago de Lanzo Nube se realiza mediante transferencia manual. La aplicación no procesa tarjetas ni genera cargos recurrentes automáticos. El periodo Pro comenzará cuando Lanzo verifique el pago y comunique su fecha de inicio y vencimiento. Cada renovación manual requiere una nueva transferencia.</p>
<p>Los datos de pago oficiales se comunicarán por un canal de Lanzo. Nunca solicitaremos tu contraseña bancaria, NIP, CVV ni acceso a tu banca electrónica. No envíes por correo números completos de tarjeta ni datos de autenticación.</p>
<p>Si en el futuro se habilita una suscripción con cobro recurrente, se mostrará el monto, la periodicidad y la fecha del cargo, se solicitará consentimiento expreso e informado y existirá un mecanismo accesible de cancelación antes de iniciar los cobros.</p>
<h3>9. Cancelación, exportación y reembolsos</h3>
<p>Puedes solicitar que no continúe un periodo futuro escribiendo a <strong>lanzocontacto@gmail.com</strong>. Mientras el pago sea manual por transferencia, no existe un cargo automático que debas cancelar. Si en el futuro se habilita cobro recurrente, la cancelación podrá hacerse de inmediato mediante el mecanismo informado en la aplicación.</p>
<p>Al terminar o cancelarse Lanzo Pro/Nube, podrás exportar la información durante <strong>siete días naturales</strong>. Al concluir esa ventana, Lanzo iniciará la eliminación de los datos operativos de sus sistemas activos, salvo los datos que deban conservarse por ley, seguridad o atención de reclamaciones. Las copias de respaldo se eliminarán conforme al ciclo de retención del proveedor y podrían permanecer durante ese ciclo después de que se eliminen los datos de los sistemas activos.</p>
<p>Los criterios concretos de reembolso aparecen en la Política de cancelaciones y reembolsos. Nada en estos términos elimina derechos que la legislación otorgue a la persona usuaria.</p>
<h3>10. Suspensión o terminación</h3>
<p>Podemos limitar temporalmente una cuenta, licencia o dispositivo cuando existan indicios razonables de fraude, acceso no autorizado, uso ilícito, riesgo de seguridad, afectación a otros usuarios, incumplimiento importante de estos términos o falta de renovación de un periodo pagado.</p>
<p>Cuando sea posible sin aumentar un riesgo, avisaremos la causa y daremos un medio para corregirla o solicitar una revisión. Si existe una amenaza urgente para la seguridad, podremos aplicar una suspensión inmediata y explicar la medida tan pronto como sea razonable. La terminación definitiva se reservará para infracciones graves, reiteradas o exigidas por autoridad.</p>
<p>Un bloqueo se limita al acceso a Lanzo; no implica cerrar el negocio del usuario. Cuando sea legal y seguro, habilitaremos la exportación durante la ventana indicada. No usaremos una suspensión para retener información sin causa.</p>
<h3>11. Disponibilidad, soporte y cambios</h3>
<p>Trabajamos para que Lanzo esté disponible y para corregir fallas, pero puede haber interrupciones por mantenimiento, conectividad, servicios de terceros o incidentes fuera de nuestro control. Informaremos cambios materiales por la aplicación, el sitio o el correo de contacto cuando corresponda.</p>
<p>El soporte técnico se solicita en <strong>lanzocontacto@gmail.com</strong> o mediante el formulario de soporte de Lanzo. Para agilizar la atención, describe el problema sin incluir contraseñas, códigos bancarios ni datos sensibles de clientes.</p>
<p>Una actualización material de estos términos se identificará con fecha y versión y se mostrará al usuario cuando corresponda. Si el cambio exige una nueva aceptación, se registrará la versión presentada. El Aviso de privacidad se mantiene como documento independiente.</p>
<h3>12. Ley aplicable y derechos</h3>
<p>Estos términos se interpretan conforme a las leyes aplicables en México. Cualquier disposición se aplicará sin limitar derechos que la legislación reconozca y que no puedan renunciarse por contrato.</p>
$lanzo_terms_of_use$, true, now()),
  ('privacy_policy'::public.legal_doc_type, 'v1.0-20261008', $lanzo_privacy_policy$
<h2>Aviso de privacidad de Lanzo POS</h2>
<p><strong>Versión:</strong> 1.0 · <strong>Última actualización:</strong> 8 de octubre de 2026</p>
<h3>Aviso simplificado</h3>
<p><strong>Responsable:</strong> Ruly Sebastián Montejo, persona física que opera Lanzo POS, domicilio en Ejido 20 de Abril, municipio de La Trinitaria, Chiapas, C.P. 30165, México. Contacto de privacidad: <strong>lanzocontacto@gmail.com</strong>.</p>
<p>Lanzo trata datos de cuenta, contacto, licencia, dispositivo, soporte, perfil del negocio y, en Pro/Nube, la información operativa que registras, como ventas, clientes, inventarios y caja. Los usa para prestar, sincronizar, respaldar, proteger y dar soporte al servicio. Si solicitas un análisis externo de Lía, se envían a DeepSeek tu pregunta y el contexto comercial necesario para responder; el proveedor puede tratar datos fuera de México conforme a sus propios términos. Lanzo no vende los datos del negocio ni los usa para publicidad o para entrenar modelos propios.</p>
<p>Puedes ejercer tus derechos de privacidad y solicitar información en <strong>lanzocontacto@gmail.com</strong>. Consulta el aviso integral y las demás políticas en Legal y privacidad dentro de Lanzo POS.</p>
<h3>Aviso integral</h3>
<h4>1. Responsable y contacto</h4>
<p>El responsable del tratamiento de los datos relacionados con la cuenta, licencia, soporte y operación de la plataforma es <strong>Ruly Sebastián Montejo</strong>, persona física que opera la marca Lanzo POS, con domicilio en <strong>Ejido 20 de Abril, municipio de La Trinitaria, Chiapas, C.P. 30165, México</strong>.</p>
<p>El canal de contacto, soporte técnico, privacidad, derechos ARCO y pagos es <strong>lanzocontacto@gmail.com</strong>. La marca Lanzo POS es comercialmente independiente de Entre Alas; el proveedor responsable es la persona física indicada aquí.</p>
<h4>2. Datos que podemos tratar</h4>
<p>Según la modalidad y las funciones que uses, Lanzo puede tratar:</p>
<ul>
<li><strong>Cuenta y contacto:</strong> nombre, correo, teléfono, rol, datos que aportes en el formulario o al solicitar soporte.</li>
<li><strong>Licencia, dispositivo y seguridad:</strong> licencia asociada, dispositivo autorizado, sesiones, permisos, actividad necesaria para seguridad y metadatos de conexión que generen los servicios.</li>
<li><strong>Perfil del negocio:</strong> nombre comercial, giro, teléfono, domicilio, logotipo y configuración.</li>
<li><strong>Operación del negocio en Pro/Nube:</strong> información que se registra en los módulos usados, incluidos ventas, productos, inventario, caja, movimientos, cuentas por cobrar, pedidos y configuración.</li>
<li><strong>Personas relacionadas con el negocio:</strong> datos de clientes, personal o proveedores que el negocio decida registrar, por ejemplo nombre, teléfono, dirección de entrega, saldo o historial de pedidos.</li>
<li><strong>Soporte:</strong> mensaje, correo o teléfono de contacto y los datos que incluyas en una consulta técnica.</li>
<li><strong>Aceptación legal y uso técnico:</strong> versión de los documentos mostrados, fecha y datos técnicos necesarios para conservar evidencia de aceptación y seguridad.</li>
<li><strong>Lía:</strong> cuando solicitas una función que lo requiere, la pregunta, la intención, el periodo y la evidencia comercial seleccionada. El registro técnico puede guardar proveedor/modelo reportado, longitud de texto, conteos de tokens, identificadores de solicitud, estado y latencia; el registro de consumo de IA de Lanzo no almacena el texto completo de la pregunta ni de la respuesta.</li>
</ul>
<p>No solicitamos datos personales sensibles para operar el punto de venta. No escribas datos de salud, contraseñas, NIP, códigos de tarjeta ni datos sensibles de clientes o personal en campos libres o en Lía.</p>
<h4>3. Finalidades</h4>
<p>Usamos los datos para finalidades necesarias para el servicio:</p>
<ol>
<li>crear y administrar cuenta, licencia, dispositivos, sesiones, permisos y plan;</li>
<li>prestar funciones locales o en la nube según la modalidad contratada;</li>
<li>sincronizar, alojar y respaldar la información de Pro/Nube;</li>
<li>habilitar reportes, inventario, caja, ventas, pedidos, portal y las demás funciones solicitadas;</li>
<li>atender soporte, diagnosticar fallas y proteger seguridad e integridad;</li>
<li>registrar aceptación de versiones legales;</li>
<li>ejecutar una función de Lía cuando el usuario la solicita;</li>
<li>cumplir obligaciones legales y atender reclamaciones.</li>
</ol>
<p>No usamos la información del negocio para vender bases de datos, publicidad dirigida ni entrenamiento de modelos propios. Si en el futuro se propone una finalidad distinta u opcional, se informará y se solicitará la decisión que legalmente corresponda.</p>
<h4>4. Diferencia entre Local y Nube</h4>
<p>En Lanzo Free/Local, la información operativa se trabaja localmente en el dispositivo. La activación de licencia, seguridad y las funciones que requieran internet pueden comunicar datos de licencia o dispositivo a servidores.</p>
<p>En Lanzo Pro/Nube, la información operativa registrada en módulos sincronizados se envía a infraestructura remota para prestar las funciones y mantener respaldos. La base de datos de Pro/Nube se aloja en Supabase, región us-east-2, en Estados Unidos. La aplicación web se aloja mediante Vercel. Estos proveedores pueden tratar datos técnicos en sus propias ubicaciones de infraestructura; Lanzo actualizará este aviso si cambia materialmente su configuración.</p>
<h4>5. Lía y transmisión a proveedores de IA</h4>
<p>Lía no envía por sí sola los datos del negocio a un modelo externo por estar instalada o visible. Cuando envías una pregunta para un análisis que necesita el proveedor externo, Lanzo transmite la pregunta y el contexto comercial que requiere esa función. El contexto puede incluir métricas agregadas, productos o categorías, periodos, precios, costos o márgenes. La evidencia estructurada no incluye por defecto listas de clientes o transacciones identificadas, pero el texto libre podría contener datos si el usuario los escribe.</p>
<p>Lanzo utiliza actualmente un modelo de <strong>DeepSeek</strong> mediante su integración de IA. La solicitud puede procesarse fuera de México; la política pública de privacidad de DeepSeek indica que los datos que trata directamente pueden procesarse y almacenarse en China, y contempla el uso de entradas para desarrollar o mejorar sus servicios y modelos. DeepSeek también establece que su aviso no regula por sí solo los datos de usuarios finales de aplicaciones de terceros; los desarrolladores deben informar sus propias prácticas y contar con consentimiento u otra base legal. Consulta los <a href="https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html" target="_blank" rel="noopener noreferrer">términos de DeepSeek Open Platform</a> y su <a href="https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html" target="_blank" rel="noopener noreferrer">aviso de privacidad</a>.</p>
<p>Lanzo no controla las políticas de retención, seguridad o mejora de DeepSeek y no promete que el proveedor elimine inmediatamente una solicitud o que excluya su uso para mejorar sus servicios. No incluyas información personal identificable, sensible, credenciales ni datos confidenciales que no quieras transmitir.</p>
<h4>6. Proveedores que pueden tratar datos</h4>
<p>Para prestar las funciones solicitadas, Lanzo utiliza proveedores tecnológicos que pueden tratar datos por cuenta de Lanzo:</p>
<ul>
<li><strong>Supabase:</strong> base de datos, sincronización y funciones de servidor de Pro/Nube; región configurada us-east-2, Estados Unidos.</li>
<li><strong>Vercel:</strong> alojamiento de la aplicación y registros técnicos de disponibilidad, seguridad y diagnóstico.</li>
<li><strong>DeepSeek:</strong> proveedor externo de IA que recibe la pregunta y el contexto comercial seleccionado cuando solicitas una función de Lía que lo requiere. Su política pública indica que puede procesar datos en China y contempla el desarrollo o mejora de sus servicios.</li>
<li><strong>Google Drive:</strong> almacenamiento de respaldos únicamente si activas una función que use esa integración.</li>
<li><strong>Google/Gmail:</strong> recepción de los correos que envíes al canal de soporte.</li>
</ul>
<p>Algunos proveedores pueden tratar datos fuera de México. Cada proveedor recibe la información necesaria para su función y la procesa conforme a sus propios términos y a las instrucciones o condiciones aplicables. En la medida en que una operación constituya una transferencia, se realiza para prestar la función que solicitaste y conforme a este aviso y la legislación aplicable.</p>
<h4>7. Datos de clientes que registra un negocio</h4>
<p>El negocio determina qué datos de sus clientes introduce, para qué los necesita y cuánto tiempo los conserva. Le corresponde informar a sus propios clientes y atender sus derechos cuando actúe como responsable de esa información.</p>
<p>Lanzo aloja y procesa esos datos para que el negocio use las funciones contratadas y para mantener la sincronización y respaldos. Si una persona cliente final escribe directamente a Lanzo sobre datos que incorporó un comercio, podremos canalizar la solicitud al negocio correspondiente, salvo que Lanzo sea responsable directo de ese tratamiento o una obligación legal indique otra cosa.</p>
<h4>8. Opciones, derechos ARCO y solicitudes</h4>
<p>Puedes solicitar acceso, rectificación, cancelación u oposición respecto de los datos personales que Lanzo trate como responsable. También puedes pedir que se limite su uso o divulgación y revocar un consentimiento cuando proceda, sin que ello afecte tratamientos realizados antes de la revocación.</p>
<p>Escribe a <strong>lanzocontacto@gmail.com</strong> con el asunto “Solicitud de privacidad”. Incluye tu nombre, un medio para recibir respuesta, el derecho que deseas ejercer, una descripción clara de los datos y los elementos necesarios para verificar tu identidad o representación. No envíes contraseñas, códigos bancarios ni números completos de tarjeta.</p>
<p>Lanzo comunicará la determinación dentro del plazo legal y, si la solicitud procede, hará efectivo el derecho en el plazo aplicable. La ley vigente establece veinte días para comunicar la determinación y quince días siguientes para hacerla efectiva; ambos pueden ampliarse una vez por un periodo igual si las circunstancias lo justifican. La solicitud debe permitir identificar al titular y los datos sobre los que versa.</p>
<p>Las solicitudes sobre datos que un comercio incorpora de sus clientes deben dirigirse normalmente al comercio responsable. Lanzo colaborará respecto de la información alojada en Nube.</p>
<h4>9. Conservación, exportación y eliminación</h4>
<p>El operador pretende ofrecer al negocio <strong>siete días</strong> para exportar los datos de Pro/Nube una vez que termina el periodo o se cancela el servicio. Al acabar esa ventana, Lanzo iniciará la eliminación de datos operativos en sistemas activos, excepto datos que deban conservarse por obligaciones legales, seguridad, prevención de fraude o defensa de reclamaciones.</p>
<p>Las copias de respaldo pueden permanecer hasta que termine el ciclo de rotación del proveedor; por eso el borrado de sistemas activos no implica que toda copia desaparezca en ese mismo momento. Los respaldos pueden permanecer hasta que concluya el ciclo de rotación aplicable del proveedor. Los registros de soporte, seguridad y aceptación se conservarán durante el tiempo necesario para atender esas finalidades y las obligaciones legales correspondientes.</p>
<h4>10. Seguridad e incidentes</h4>
<p>Lanzo utiliza medidas administrativas, técnicas y físicas razonables para proteger la información frente a pérdida, alteración, destrucción, acceso o uso no autorizado. Ningún servicio conectado a internet puede garantizar riesgo cero.</p>
<p>Si una vulneración afecta de manera significativa los derechos patrimoniales o morales de las personas titulares, Lanzo informará conforme a la legislación aplicable y comunicará medidas que ayuden a proteger sus derechos.</p>
<h4>11. Cookies, analítica y formulario</h4>
<p>Al 8 de octubre de 2026, Lanzo no utiliza cookies publicitarias ni herramientas de analítica. La aplicación puede guardar preferencias técnicas en el dispositivo y Vercel u otros proveedores de infraestructura pueden generar registros técnicos necesarios para seguridad, diagnóstico y disponibilidad. El formulario y el canal de contacto se usan para soporte técnico; si abres el correo de soporte, tu aplicación de correo y su proveedor también tratarán el mensaje. No envíes contraseñas, datos bancarios, datos sensibles ni archivos que no sean necesarios para explicar el problema.</p>
<h4>12. Cambios al aviso</h4>
<p>La versión y fecha vigentes se muestran en Legal y privacidad dentro de la aplicación. Si cambian las finalidades, categorías de datos, proveedores o transferencias de forma relevante, actualizaremos este aviso y comunicaremos el cambio por la aplicación o por los medios de contacto disponibles.</p>
$lanzo_privacy_policy$, true, now()),
  ('ai_policy'::public.legal_doc_type, 'v1.0-20261008', $lanzo_ai_policy$
<h2>Política de Lía e inteligencia artificial</h2>
<p><strong>Versión:</strong> 1.0 · <strong>Última actualización:</strong> 8 de octubre de 2026</p>
<h3>Qué hace Lía</h3>
<p>Lía ayuda a consultar y analizar información comercial disponible en Lanzo. Puede responder algunas preguntas mediante reglas o cálculos del sistema y puede generar narrativas con un modelo de IA externo para funciones compatibles.</p>
<p>Lía no reemplaza asesoría profesional ni garantiza resultados. Verifica cifras y contexto antes de tomar decisiones.</p>
<h3>Cuándo se envían datos</h3>
<p>Tener Lanzo abierto o ver el acceso a Lía no envía automáticamente los datos del negocio a DeepSeek. En las funciones que requieren IA externa, la transmisión ocurre cuando el usuario solicita ese análisis. Las funciones locales o determinísticas no deben presentarse como si necesariamente llamaran a un proveedor externo.</p>
<p>El módulo puede transmitir:</p>
<ul>
<li>la pregunta escrita por el usuario;</li>
<li>el periodo o intención del análisis;</li>
<li>evidencia comercial seleccionada por la función, como cifras agregadas de ventas, productos, categorías, precios, costos o márgenes;</li>
<li>instrucciones necesarias para que el modelo responda dentro del análisis solicitado.</li>
</ul>
<p>La evidencia estructurada no incluye por defecto un listado de clientes ni una relación de ventas individuales identificables. El texto libre sí puede contener nombres, teléfonos u otros datos si el usuario los escribe.</p>
<h3>Proveedor y uso externo</h3>
<p>El proveedor externo actual es <strong>DeepSeek</strong>. Cuando una función requiere un modelo externo, DeepSeek procesa la solicitud para generar una respuesta y se aplican sus términos vigentes. Sus documentos públicos contemplan la conservación de entradas para prestar y mejorar sus servicios y el procesamiento en China. La política de privacidad de DeepSeek explica que los desarrolladores que incorporan su Open Platform deben informar a sus usuarios; consulta los enlaces del Aviso de privacidad de Lanzo.</p>
<p>Lanzo registra metadatos de uso —por ejemplo, proveedor o modelo reportado, longitud de texto, tokens, estado, latencia e identificador de solicitud— para operar el servicio, aplicar límites y diagnosticar fallas. El registro de consumo de IA de Lanzo no conserva el texto completo de la pregunta ni de la respuesta. Esto describe los registros de Lanzo y no las prácticas del proveedor externo.</p>
<h3>Cómo usarla con cuidado</h3>
<p>No incluyas nombres, teléfonos, direcciones, datos sensibles, credenciales, números de tarjetas, NIP, saldos individualizados de clientes u otra información que identifique a una persona. Formula la pregunta con métricas agregadas cuando sea posible.</p>
<p>Cuando pulsas enviar en una función que requiere un modelo externo, solicitas que se transmita la pregunta y el contexto comercial indicado en este documento para obtener una respuesta. No existe actualmente un interruptor general para desactivar Lía; puedes optar por no utilizar sus funciones externas.</p>
<h3>Resultados</h3>
<p>Las respuestas pueden omitir datos, interpretar mal una pregunta o contener errores. Revisa los resultados en Lanzo y no los trates como asesoría contable, fiscal, legal, médica o de inversión. El usuario decide qué acciones tomar.</p>
<h3>Contacto</h3>
<p>Para preguntas sobre Lía o el uso de datos escribe a <strong>lanzocontacto@gmail.com</strong>. Consulta también el Aviso de privacidad de Lanzo POS.</p>
$lanzo_ai_policy$, true, now()),
  ('payment_policy'::public.legal_doc_type, 'v1.0-20261008', $lanzo_payment_policy$
<h2>Política de pagos y suscripciones</h2>
<p><strong>Versión:</strong> 1.0 · <strong>Última actualización:</strong> 8 de octubre de 2026</p>
<h3>Estado de cobro actual</h3>
<p>El precio de Lanzo Nube es <strong>MXN $129 por mes</strong>. Actualmente el pago se hace mediante transferencia manual: Lanzo no procesa tarjetas dentro de la aplicación ni genera cargos automáticos. La renovación requiere una nueva transferencia. El importe total e impuestos aplicables se informarán antes de que realices el pago; tu banco podría cobrar comisiones propias por la transferencia.</p>
<h3>Transferencia manual</h3>
<ol>
<li>Antes de pagar, el usuario recibirá el monto, moneda, periodo, instrucciones y cuenta oficial de transferencia por un canal de Lanzo.</li>
<li>No compartas contraseñas bancarias, NIP, CVV, códigos de autenticación ni acceso a tu banca electrónica.</li>
<li>Envía el comprobante únicamente al canal oficial informado por Lanzo. Si necesitas identificar la licencia, oculta los caracteres que no sean necesarios.</li>
<li>El periodo de Pro comienza cuando Lanzo confirma el pago y comunica la fecha de inicio y vencimiento.</li>
<li>Mientras el pago sea manual, cada renovación requiere una nueva transferencia y confirmación; Lanzo no guarda autorización para hacer cargos automáticos.</li>
<li>Si el pago no se refleja o se aplicó a una licencia incorrecta, escribe a <strong>lanzocontacto@gmail.com</strong> con el comprobante y los datos mínimos para localizarlo.</li>
</ol>
<p>No se añadirán comisiones sorpresa. Si una comisión, impuesto o cargo llegara a aplicar, se informará en el precio final antes de aceptar el pago.</p>
<h3>Suscripción recurrente futura</h3>
<p>Si Lanzo incorpora cobro automático mensual, antes de contratar mostrará de manera clara, destacada y accesible que existe un cargo recurrente, su monto, periodicidad y fecha de cobro. El cargo requerirá consentimiento expreso e informado.</p>
<p>Cuando proceda renovación automática, Lanzo notificará al menos cinco días naturales antes de la renovación y permitirá cancelarla sin penalización. La aplicación tendrá un mecanismo accesible para cancelar el servicio, suscripción o membresía de manera inmediata. La cancelación detendrá cargos futuros; el acceso al periodo ya pagado se regirá por las condiciones informadas y los derechos que reconozca la ley.</p>
<p>La legislación mexicana actualmente contiene estos requisitos expresos para suscripciones con cobro recurrente. Por tanto, el cobro automático no debe habilitarse antes de implementar y verificar el consentimiento, aviso de renovación y cancelación inmediata.</p>
$lanzo_payment_policy$, true, now()),
  ('refund_policy'::public.legal_doc_type, 'v1.0-20261008', $lanzo_refund_policy$
<h2>Política de cancelaciones y reembolsos</h2>
<p><strong>Versión:</strong> 1.0 · <strong>Última actualización:</strong> 8 de octubre de 2026</p>
<h3>Cancelación del servicio</h3>
<p>Puedes solicitar la cancelación o no renovación escribiendo a <strong>lanzocontacto@gmail.com</strong>. Actualmente el pago se realiza mediante transferencia manual, por lo que no existe un cargo automático que debas detener: no realizar una nueva transferencia evita la renovación.</p>
<p>Si Lanzo habilita cobro recurrente, podrás cancelarlo mediante un mecanismo accesible dentro de Lanzo. La cancelación de renovación detiene cargos futuros y no elimina los derechos de exportación de los datos ni los derechos que establezca la ley.</p>
<h3>Reembolsos</h3>
<p>Lanzo revisará cada solicitud con base en el comprobante, la licencia parcialmente identificada, la fecha del pago y el problema reportado. No envíes contraseñas bancarias, NIP, CVV ni el número completo de una tarjeta.</p>
<p>Lanzo revisará cada solicitud y podrá autorizar un reembolso cuando:</p>
<ul>
<li>se haya realizado un pago duplicado o por error y Lanzo lo verifique;</li>
<li>una licencia pagada no pueda activarse y soporte no logre resolverlo;</li>
<li>una falla sustancial atribuible a Lanzo impida usar una parte relevante del periodo contratado y no se corrija en un tiempo razonable; en ese caso se revisará una solución proporcional, que puede ser una corrección, extensión, crédito o reembolso.</li>
</ul>
<p>La cancelación detiene renovaciones futuras. El reembolso de un periodo ya iniciado se revisará según el servicio efectivamente prestado, la causa de la solicitud, lo ofrecido al contratar y los derechos obligatorios aplicables.</p>
<p>Esta política no excluye derechos de devolución, revocación, rescisión o reclamación reconocidos por la ley. Lanzo comunicará la decisión y, si procede un reembolso, lo hará al medio de pago original cuando sea posible. En una transferencia, podrá solicitar los datos mínimos necesarios para devolver el importe a una cuenta de la persona que pagó, únicamente por el canal oficial.</p>
<h3>Proceso de solicitud</h3>
<ol>
<li>Envía la solicitud a <strong>lanzocontacto@gmail.com</strong> con el asunto “Pago, cancelación o reembolso”.</li>
<li>Indica el correo de contacto, la licencia con caracteres parcialmente ocultos, fecha e importe del pago y explica la situación.</li>
<li>Adjunta el comprobante ocultando información bancaria que no sea necesaria.</li>
<li>Lanzo confirmará la recepción y revisará el caso. Si necesita información adicional, la solicitará por el mismo canal.</li>
<li>La respuesta indicará la resolución, el motivo y, si aplica, el medio y tiempo estimado del reembolso.</li>
</ol>
<p>La ventana de siete días para exportar datos al terminar Pro/Nube no es un plazo de prueba ni una promesa automática de reembolso; ambas cuestiones son independientes.</p>
$lanzo_refund_policy$, true, now()),
  ('legal_notice'::public.legal_doc_type, 'v1.0-20261008', $lanzo_legal_notice$
<h2>Aviso legal de Lanzo POS</h2>
<p><strong>Versión:</strong> 1.0 · <strong>Última actualización:</strong> 8 de octubre de 2026</p>
<p><strong>Lanzo POS</strong> es una marca comercial de software operada por <strong>Ruly Sebastián Montejo</strong>, persona física, con domicilio en <strong>Ejido 20 de Abril, municipio de La Trinitaria, Chiapas, C.P. 30165, México</strong>.</p>
<p><strong>Sitio:</strong> https://lanzo-pos.vercel.app <strong>Contacto, soporte técnico, privacidad, derechos ARCO y pagos:</strong> lanzocontacto@gmail.com <strong>Territorio y ley prevista:</strong> México, sin limitar derechos obligatorios reconocidos por la legislación aplicable.</p>
<p>Lanzo POS es una marca comercial independiente de Entre Alas y no es una persona moral distinta del titular indicado. El uso de Lanzo se rige por los Términos de uso, el Aviso de privacidad, la Política de Lía y las demás políticas mostradas en la sección legal de la aplicación.</p>
<p>El software proporciona herramientas de administración comercial. Cada negocio mantiene responsabilidad sobre sus productos, precios, impuestos, clientes, ventas, entregas, devoluciones y cumplimiento de sus obligaciones.</p>
<p>Los documentos legales vigentes deben mostrar su número de versión y fecha. Este aviso no sustituye los datos e identidad del comercio que vende productos mediante un portal de pedidos.</p>
$lanzo_legal_notice$, true, now());
