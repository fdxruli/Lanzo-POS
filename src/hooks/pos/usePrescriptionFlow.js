// src/hooks/usePrescriptionFlow.js
import { useCallback, useState } from 'react';

/**
 * Hook para manejar el flujo de prescripciones en el POS.
 * Encapsula el estado y lógica relacionada con productos que requieren receta.
 * 
 * @param {Object} deps - Dependencias externas
 * @param {function} deps.openModal - Función para abrir modales
 * @param {function} deps.closeModal - Función para cerrar modales
 * @returns {{
 *   prescriptionItems: Array,
 *   tempPrescriptionData: Object|null,
 *   handlePrescriptionConfirm: (data: Object) => void,
 *   setPrescriptionItems: function,
 *   setTempPrescriptionData: function
 * }}
 */
export function usePrescriptionFlow({
    openModal,
    closeModal
}) {
    const [prescriptionItems, setPrescriptionItems] = useState([]);
    const [tempPrescriptionData, setTempPrescriptionData] = useState(null);

    const handlePrescriptionConfirm = useCallback((data) => {
        setTempPrescriptionData(data);
        closeModal('prescription');
        openModal('payment');
    }, [closeModal, openModal]);

    return {
        prescriptionItems,
        tempPrescriptionData,
        handlePrescriptionConfirm,
        setPrescriptionItems,
        setTempPrescriptionData
    };
}
