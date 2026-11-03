# Reproducir la prueba nativa (QA exclusiva)

No ejecutar qa-setup.sql con IDs de una ejecución anterior. Generar run_id, role, topic e identidad nuevos; mantener inventario y limpieza en finally. El SQL guardado documenta la ejecución f748296e, no una migración desplegable.

1. En un proceso servidor aislado cargar una clave administrativa ya autorizada y la clave pública en memoria. createClient(...,{auth:{persistSession:false,autoRefreshToken:false}}). No imprimir las credenciales ni el objeto session.
2. admin.auth.admin.createUser({email:emailSintetico,password:aleatoria,email_confirm:true,role:rolQA,app_metadata:{qa_run:runId,scope:'qa_probe',topic:topicQA}}). No reutilizar usuarios reales.
3. Cliente Auth separado: auth.signInWithPassword(...). Registrar únicamente user_id, role, iss, aud, session_id y exp-iat; conservar access_token/refresh_token en memoria.
4. Con esos IDs preparar el equivalente revisado de qa-setup.sql. Sólo crea recursos propios de QA y añade una política exclusiva al nuevo rol. No cambiar las tres políticas previas o membresías de plataforma.
5. Receptor separado: realtime.setAuth(access_token); channel(topicQA,{config:{private:true,broadcast:{ack:true},presence:{enabled:true}}}).on('broadcast',{event:'*'},callback).subscribe(callback).
6. Un cliente servidor service_role separado publica únicamente {type:'broadcast',event:'qa_probe',payload:{probe:marcador}} en el topic QA. Registrar envío y recepción. No publicar eventos comerciales.
7. Repetir joins ajenos, scope distinto firmado mediante Admin updateUserById+Auth refresh, sesión Auth diferente, Broadcast/Presence del receptor y firma manipulada. Registrar CHANNEL_ERROR y motivo, sin serializar JWT.
8. Confirmar commit de revoked_at; mantener socket antiguo y publicar qa_probe; probar conexión nueva y realtime.setAuth(JWTnuevo). Repetir con expiración real de grant y Admin signOut(local). El archivo native-auth.json conserva tiempos y estados observados. Un ACK de envío no demuestra recepción; esperar captura y guardar también recepciones tardías.
9. En cleanup: Admin signOut(global), deleteUser(IDpropio), getUserById=404. Cerrar todos los clientes QA. Ejecutar retirada selectiva equivalente a qa-cleanup.sql, sin CASCADE; confirmar catálogo, usuario/sesiones/identidades, tres políticas previas y ACL originales.
10. Para ensayo ACL, ejecutar acl-transaction.sql entero con BEGIN/ROLLBACK y acl-execution-denial.sql entero. Nunca persistir el REVOKE de la simulación por quitar ROLLBACK. La evidencia incluye efectos de los 33 roles, no sólo anon/authenticated/service_role.

Las sentencias históricas *.remote.json (campo sql) se conservan para comparación del ledger. No son nuevas migraciones ni instrucciones para aplicarlas.
