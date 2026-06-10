import { useCallback } from 'react';
import { showMessageModal } from '../services/utils';
import { useMessageStore } from '../store/useMessageStore';

export const useConfirmDiscard = ({
  hasChanges,
  onClose,
  isDisabled = false,
  message = 'Hay datos capturados que todavía no se han guardado. ¿Quieres cancelar la operación?'
}) => {
  return useCallback(() => {
    if (isDisabled) return;
    if (useMessageStore.getState().isOpen) return;

    if (!hasChanges) {
      onClose();
      return;
    }

    showMessageModal(
      message,
      onClose,
      {
        type: 'warning',
        title: 'Cancelar operación',
        confirmButtonText: 'Sí, cancelar',
        cancelButtonText: 'Continuar editando',
        showCancel: true,
        isDismissible: false
      }
    );
  }, [hasChanges, isDisabled, message, onClose]);
};
