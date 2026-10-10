import { useEffect, useRef, useState } from 'react';
import { actorRuntimeController } from '../../services/auth/actorRuntimeController';
import { verifyRestaurantTableAuthority } from '../../services/restaurant/restaurantTableAuthority';
import { cancelAdministrativeRestaurantTable } from '../../services/restaurant/restaurantAdministrativeCancellation';
import { showConfirmModal } from '../../services/utils';

export default function RestaurantAdminInterventionModal({ order, licenseKey, onClose, onCheckout, onSplit, onCancelled }) {
  const dialog = useRef(null);
  const [capabilities, setCapabilities] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    let disposed = false;
    let actor;
    try { actor = actorRuntimeController.capture('pos'); }
    catch (failure) { setError(failure.message); return; }
    verifyRestaurantTableAuthority({ licenseKey, order, operation: 'administer', actorHandle: actor })
      .then((binding) => { if (!disposed) setCapabilities(binding.capabilities); })
      .catch((failure) => { if (!disposed) setError(failure.message); });
    const unsubscribe = actorRuntimeController.subscribe(() => {
      try { actor.assertCurrent(); } catch { onClose(); }
    });
    return () => { disposed = true; unsubscribe(); };
  }, [order, licenseKey, onClose]);
  const act = async (operation) => {
    setBusy(true);
    setError('');
    try {
      if (operation === 'cancel') {
        if (!reason.trim()) throw new Error('Escribe el motivo de cancelación.');
        const confirmed = await showConfirmModal('Vas a intervenir una mesa iniciada por otro usuario. Se verificará su estado actual antes de aplicar cambios.',
          { title: 'Cancelar mesa', type: 'warning', confirmButtonText: 'Cancelar mesa', cancelButtonText: 'Volver' });
        if (!confirmed) return;
        await cancelAdministrativeRestaurantTable({ licenseKey, order, reason });
        await onCancelled();
      } else {
        await verifyRestaurantTableAuthority({ licenseKey, order, operation });
        const result = await (operation === 'split' ? onSplit : onCheckout)(order);
        if (result?.success === false) throw new Error(result.message || 'No se pudo continuar con esta mesa.');
      }
      onClose();
    } catch (failure) { setError(failure.message || 'No se pudo verificar esta operación. Actualiza la mesa.'); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="modal-content restaurant-admin-dialog" aria-labelledby="restaurant-admin-title"
    onClick={(event) => event.stopPropagation()} onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}>
    <h2 id="restaurant-admin-title">Administrar mesa</h2>
    <p>Esta mesa fue iniciada en otra sesión. Como administrador puedes continuar su atención. Comprobaremos que la cuenta no haya cambiado antes de guardar cualquier operación.</p>
    <p>Los cambios de productos y reservas requieren atención desde el dispositivo de origen.</p>
    {error && <p role="alert">{error}</p>}
    {!capabilities && !error && <p role="status">Comprobando permisos…</p>}
    {capabilities?.canCheckoutTable && <button type="button" disabled={busy} onClick={() => act('checkout')}>Cobrar</button>}
    {capabilities?.canSplitTable && <button type="button" disabled={busy} onClick={() => act('split')}>Dividir cuenta</button>}
    {capabilities?.canCancelTable && <>
      <label htmlFor="restaurant-admin-reason">Motivo de cancelación</label>
      <textarea id="restaurant-admin-reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} maxLength={1000} />
      <button type="button" disabled={busy || !reason.trim()} onClick={() => act('cancel')}>Cancelar mesa</button>
    </>}
    <button type="button" disabled={busy} onClick={onClose}>Cerrar</button>
  </dialog>;
}
