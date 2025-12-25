import { useState, useEffect } from 'react';
import { compressImage, lookupBarcodeInAPI, showMessageModal } from '../services/utils';

const defaultPlaceholder = 'https://placehold.co/100x100/CCCCCC/000000?text=Elegir';

export function useProductCommon(initialData, onSave) {
    // --- ESTADOS BÁSICOS ---
    const [name, setName] = useState(initialData?.name || '');
    const [barcode, setBarcode] = useState(initialData?.barcode || '');
    const [description, setDescription] = useState(initialData?.description || '');
    const [imagePreview, setImagePreview] = useState(initialData?.image || defaultPlaceholder);
    const [imageData, setImageData] = useState(initialData?.image || null);
    const [categoryId, setCategoryId] = useState(initialData?.categoryId || '');
    const [storageLocation, setStorageLocation] = useState(initialData?.location || '');
    
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
            const initialMargin = ((initialData.price - initialData.cost) / initialData.cost) * 100;
            setMargin(initialMargin.toFixed(1));
        }
    }, [initialData]);

    // --- MANEJO DE IMÁGENES ---
    const handleImageChange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            setIsImageProcessing(true);
            try {
                const compressedFile = await compressImage(file);
                if (imagePreview && imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
                const newUrl = URL.createObjectURL(compressedFile);
                setImagePreview(newUrl);
                setImageData(compressedFile);
            } catch (error) {
                showMessageModal("Error al procesar imagen", null, { type: 'error' });
            } finally {
                setIsImageProcessing(false);
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
        if (!isNaN(numCost) && numCost > 0 && !isNaN(numPrice)) {
            const newMargin = ((numPrice - numCost) / numCost) * 100;
            setMargin(newMargin.toFixed(1));
        } else {
            setMargin('');
        }
    };

    const handlePriceChange = (val) => {
        setPrice(val);
        const numPrice = parseFloat(val);
        const numCost = parseFloat(cost);
        if (!isNaN(numCost) && numCost > 0 && !isNaN(numPrice)) {
            const newMargin = ((numPrice - numCost) / numCost) * 100;
            setMargin(newMargin.toFixed(1));
        }
    };

    const handleMarginChange = (val) => {
        setMargin(val);
        const numMargin = parseFloat(val);
        const numCost = parseFloat(cost);
        if (!isNaN(numMargin) && !isNaN(numCost) && numCost > 0) {
            const newPrice = numCost * (1 + (numMargin / 100));
            setPrice(newPrice.toFixed(2));
        }
    };

    // --- HELPER PARA OBTENER DATOS LIMPIOS ---
    const getCommonData = () => ({
        name: name.trim(),
        barcode: barcode.trim(),
        description: description.trim(),
        categoryId,
        image: imageData,
        location: storageLocation.trim(),
        trackStock: doesTrackStock,
        price: parseFloat(price) || 0,
        cost: parseFloat(cost) || 0,
    });

    return {
        // States
        name, setName,
        barcode, setBarcode,
        description, setDescription,
        imagePreview, setImagePreview,
        imageData, setImageData,
        categoryId, setCategoryId,
        storageLocation, setStorageLocation,
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
        getCommonData
    };
}