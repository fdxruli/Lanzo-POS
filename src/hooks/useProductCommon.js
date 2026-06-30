import { useState, useEffect } from 'react';
import { compressImage, lookupBarcodeInAPI, showMessageModal } from '../services/utils';

const defaultPlaceholder = 'https://placehold.co/100x100/CCCCCC/000000?text=Elegir';

export function useProductCommon(initialData, config = {}) {
    // --- ESTADOS BÁSICOS ---
    const [name, setName] = useState(initialData?.name || '');
    const [barcode, setBarcode] = useState(initialData?.barcode || '');
    const [description, setDescription] = useState(initialData?.description || '');
    const [imagePreview, setImagePreview] = useState(initialData?.image || defaultPlaceholder);
    const [imageData, setImageData] = useState(initialData?.image || null);
    const [categoryId, setCategoryId] = useState(initialData?.categoryId || '');
    const [storageLocation, setStorageLocation] = useState(initialData?.location || '');
    
    // --- CADUCIDAD ---
    const [expirationMode, setExpirationMode] = useState(initialData?.expirationMode || config.defaultExpirationMode || 'NONE');
    const [shelfLifeValue, setShelfLifeValue] = useState(initialData?.shelfLifeValue || '');
    const [shelfLifeUnit, setShelfLifeUnit] = useState(initialData?.shelfLifeUnit || 'days');
    const [pendingBatchPurge, setPendingBatchPurge] = useState(false);
    
    // --- PRECIOS Y COSTOS ---
    const [cost, setCost] = useState(initialData?.cost || '');
    const [price, setPrice] = useState(initialData?.price || '');
    const [margin, setMargin] = useState('');

    const [doesTrackStock, setDoesTrackStock] = useState(
        initialData?.trackStock !== undefined ? initialData.trackStock : true
    );

    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [isLookingUp, setIsLookingUp] = useState(false);
    const [isImageProcessing, setIsImageProcessing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showSpecificData, setShowSpecificData] = useState(!!(initialData?.description || initialData?.image));

    // Calcular margen inicial si es edición
    useEffect(() => {
        if (initialData?.cost > 0 && initialData?.price > 0) {
            const initialMargin = ((initialData.price - initialData.cost) / initialData.price) * 100;
            setMargin(initialMargin.toFixed(1));
        }
    }, [initialData]);

    // --- MANEJO DE IMÁGENES ---
    const handleImageChange = async (e) => {
        const input = e.currentTarget;
        const file = input.files[0];
        if (file) {
            setIsImageProcessing(true);
            try {
                const compressedFile = await compressImage(file);
                if (imagePreview && imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
                const newUrl = URL.createObjectURL(compressedFile);
                setImagePreview(newUrl);
                setImageData(compressedFile);
            } catch {
                showMessageModal("Error al procesar imagen", null, { type: 'error' });
            } finally {
                setIsImageProcessing(false);
                input.value = '';
            }
        }
    };

    // --- MANEJO DE BARCODE API ---
    const handleBarcodeLookup = async () => {
        if (!barcode) return;
        setIsLookingUp(true);
        const apiResult = await lookupBarcodeInAPI(barcode);
        setIsLookingUp(false);

        if (apiResult.success) {
            setName(apiResult.product.name || name);
            if (apiResult.product.image) {
                setImagePreview(apiResult.product.image);
                setImageData(apiResult.product.image);
            }
            showMessageModal('¡Producto encontrado!');
        } else {
            showMessageModal(`Producto no encontrado.`, null, { type: 'error' });
        }
    };

    // --- CÁLCULOS DE PRECIO ---
    const handleCostChange = (val) => {
        setCost(val);
        const numCost = parseFloat(val);
        const numPrice = parseFloat(price);
        if (!isNaN(numCost) && numCost >= 0 && !isNaN(numPrice) && numPrice > 0) {
            const newMargin = ((numPrice - numCost) / numPrice) * 100;
            setMargin(newMargin.toFixed(1));
        } else {
            setMargin('');
        }
    };

    const handlePriceChange = (val) => {
        setPrice(val);
        const numPrice = parseFloat(val);
        const numCost = parseFloat(cost);
        if (!isNaN(numCost) && numCost >= 0 && !isNaN(numPrice) && numPrice > 0) {
            const newMargin = ((numPrice - numCost) / numPrice) * 100;
            setMargin(newMargin.toFixed(1));
        }
    };

    const handleMarginChange = (val) => {
        setMargin(val);
        const numMargin = parseFloat(val);
        const numCost = parseFloat(cost);
        if (!isNaN(numMargin) && !isNaN(numCost) && numCost >= 0) {
            const safeMargin = numMargin >= 100 ? 99.9 : numMargin;
            const newPrice = numCost / (1 - (safeMargin / 100));
            setPrice(newPrice.toFixed(2));
        }
    };

        // --- HELPER PARA OBTENER DATOS LIMPIOS ---
    const getCommonData = () => {
        const usesShelfLife = expirationMode === 'SHELF_LIFE';

        return {
            name: name.trim(),
            barcode: barcode.trim(),
            description: description.trim(),
            categoryId,
            image: imageData,
            location: storageLocation.trim(),
            trackStock: doesTrackStock,
            price: parseFloat(price) || 0,
            cost: parseFloat(cost) || 0,
            expirationMode,
            shelfLifeValue: usesShelfLife && shelfLifeValue !== '' ? Number(shelfLifeValue) : null,
            shelfLifeUnit: usesShelfLife ? shelfLifeUnit : null
        };
    };

    /**
     * Genera payload para actualización atómica con intención.
     * Usado para cambios de expirationMode que requieren purga de lotes.
     * 
     * @param {string} previousMode - Modo anterior ('STRICT', 'SHELF_LIFE', 'NONE')
     * @param {string} newMode - Nuevo modo ('STRICT', 'SHELF_LIFE', 'NONE')
     * @returns {Object|null} Payload con _intent o null si no aplica
     */
    const buildExpirationModePayload = (previousMode, newMode) => {
        // Solo requiere purga si cambia de STRICT/SHELF_LIFE a NONE
        if ((previousMode === 'STRICT' || previousMode === 'SHELF_LIFE') && newMode === 'NONE') {
            return {
                expirationMode: 'NONE',
                shelfLifeValue: null,
                shelfLifeUnit: null,
                _intent: 'PURGE_BATCHES'
            };
        }
        
        // Cambio normal sin purga
        return {
            expirationMode: newMode,
            shelfLifeValue: newMode === 'SHELF_LIFE' ? Number(shelfLifeValue) || null : null,
            shelfLifeUnit: newMode === 'SHELF_LIFE' ? shelfLifeUnit : null
        };
    };

    return {
        // States
        name, setName,
        barcode, setBarcode,
        description, setDescription,
        imagePreview, setImagePreview,
        imageData, setImageData,
        categoryId, setCategoryId,
        storageLocation, setStorageLocation,
        expirationMode, setExpirationMode,
        shelfLifeValue, setShelfLifeValue,
        shelfLifeUnit, setShelfLifeUnit,
        pendingBatchPurge, setPendingBatchPurge,
        cost, setCost,
        price, setPrice,
        margin, setMargin,
        doesTrackStock, setDoesTrackStock,
        isScannerOpen, setIsScannerOpen,
        isLookingUp,
        isImageProcessing,
        isSaving, setIsSaving,
        showSpecificData, setShowSpecificData,
        
                // Handlers
        handleImageChange,
        handleBarcodeLookup,
        handleCostChange,
        handlePriceChange,
        handleMarginChange,
        getCommonData,
        buildExpirationModePayload
    };
}
