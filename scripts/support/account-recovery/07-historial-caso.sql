-- SOLO LECTURA. Busca por caso sin volver a introducir la licencia.
select private.support_recovery_status(license_id)
from private.admin_recovery_cases where id='UUID_CASO'::uuid;
