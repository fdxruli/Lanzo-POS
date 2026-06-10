import { useState, useCallback, useEffect } from 'react';

const STEPS = [
    { id: 1, name: 'Básicos', icon: '📝' },
    { id: 2, name: 'Inventario', icon: '📦' },
    { id: 3, name: 'Precio', icon: '💰' }
];

export function useProductWizard(productToEdit, activeRubroContext) {
    const [currentStep, setCurrentStep] = useState(1);
    const [stepErrors, setStepErrors] = useState({});
    const [isSaving, setIsSaving] = useState(false);

    // Estados del Paso 1 - Básicos
    const [name, setName] = useState(productToEdit?.name || '');
    const [barcode, setBarcode] = useState(productToEdit?.barcode || '');
    const [categoryId, setCategoryId] = useState(productToEdit?.categoryId || '');
    const [isScannerOpen, setIsScannerOpen] = useState(false);

    // Estados del Paso 2 - Inventario
    const [doesTrackStock, setDoesTrackStock] = useState(
        productToEdit?.trackStock !== undefined ? productToEdit.trackStock : true
    );
    const [stock, setStock] = useState(productToEdit?.stock || 0);
    const [minStock, setMinStock] = useState(productToEdit?.minStock || '');
    const [saleType, setSaleType] = useState(productToEdit?.saleType || 'unit');
    const [unit, setUnit] = useState(productToEdit?.unit || 'pza');
    const [supplier, setSupplier] = useState(productToEdit?.supplier || '');
    const [storageLocation, setStorageLocation] = useState(productToEdit?.location || '');
    const [conversionFactor, setConversionFactor] = useState(productToEdit?.conversionFactor || { enabled: false, purchaseUnit: '', factor: '' });

    // Estados del Paso 3 - Precio y Detalles
    const [cost, setCost] = useState(productToEdit?.cost || '');
    const [price, setPrice] = useState(productToEdit?.price || '');
    const [margin, setMargin] = useState('');
    const [description, setDescription] = useState(productToEdit?.description || '');
    const [imageData, setImageData] = useState(productToEdit?.image || null);
    const [imagePreview, setImagePreview] = useState(productToEdit?.image || 'https://placehold.co/100x100/CCCCCC/000000?text=Elegir');

    // Calcular margen cuando cambia costo o precio
    useEffect(() => {
        const numCost = parseFloat(cost);
        const numPrice = parseFloat(price);
        if (!isNaN(numCost) && numCost >= 0 && !isNaN(numPrice) && numPrice > 0) {
            const newMargin = ((numPrice - numCost) / numPrice) * 100;
            setMargin(newMargin.toFixed(1));
        } else {
            setMargin('');
        }
    }, [cost, price]);

    // Validar Paso 1
    const validateStep1 = useCallback(() => {
        const errors = {};
        if (!name.trim()) errors.name = 'El nombre es requerido';
        if (!categoryId) errors.categoryId = 'Selecciona una categoría';
        
        setStepErrors(prev => ({ ...prev, 1: errors }));
        return Object.keys(errors).length === 0;
    }, [name, categoryId]);

    // Validar Paso 2
    const validateStep2 = useCallback(() => {
        const errors = {};
        if (doesTrackStock && stock < 0) errors.stock = 'El stock no puede ser negativo';
        
        setStepErrors(prev => ({ ...prev, 2: errors }));
        return Object.keys(errors).length === 0;
    }, [doesTrackStock, stock]);

    // Validar Paso 3
    const validateStep3 = useCallback(() => {
        const errors = {};
        if (!price || parseFloat(price) <= 0) errors.price = 'El precio debe ser mayor a 0';
        
        setStepErrors(prev => ({ ...prev, 3: errors }));
        return Object.keys(errors).length === 0;
    }, [price]);

    // Navegación
    const nextStep = useCallback(() => {
        let isValid = true;
        if (currentStep === 1) isValid = validateStep1();
        if (currentStep === 2) isValid = validateStep2();
        
        if (isValid && currentStep < STEPS.length) {
            setCurrentStep(prev => prev + 1);
        }
        return isValid;
    }, [currentStep, validateStep1, validateStep2]);

    const prevStep = useCallback(() => {
        if (currentStep > 1) {
            setCurrentStep(prev => prev - 1);
        }
    }, [currentStep]);

    const goToStep = useCallback((step) => {
        if (step >= 1 && step <= STEPS.length) {
            setCurrentStep(step);
        }
    }, []);

    const isFirstStep = currentStep === 1;
    const isLastStep = currentStep === STEPS.length;
    const progress = (currentStep / STEPS.length) * 100;

    // Handlers de precio
    const handleCostChange = useCallback((val) => {
        setCost(val);
        const numCost = parseFloat(val);
        const numPrice = parseFloat(price);
        if (!isNaN(numCost) && numCost >= 0 && !isNaN(numPrice) && numPrice > 0) {
            const newMargin = ((numPrice - numCost) / numPrice) * 100;
            setMargin(newMargin.toFixed(1));
        } else {
            setMargin('');
        }
    }, [price]);

    const handlePriceChange = useCallback((val) => {
        setPrice(val);
        const numPrice = parseFloat(val);
        const numCost = parseFloat(cost);
        if (!isNaN(numCost) && numCost >= 0 && !isNaN(numPrice) && numPrice > 0) {
            const newMargin = ((numPrice - numCost) / numPrice) * 100;
            setMargin(newMargin.toFixed(1));
        }
    }, [cost]);

    const handleMarginChange = useCallback((val) => {
        setMargin(val);
        const numMargin = parseFloat(val);
        const numCost = parseFloat(cost);
        if (!isNaN(numMargin) && !isNaN(numCost) && numCost >= 0) {
            const safeMargin = numMargin >= 100 ? 99.9 : numMargin;
            const newPrice = numCost / (1 - (safeMargin / 100));
            setPrice(newPrice.toFixed(2));
        }
    }, [cost]);

    // Obtener todos los datos del producto
    const getProductData = useCallback(() => ({
        name: name.trim(),
        barcode: barcode.trim(),
        categoryId,
        trackStock: doesTrackStock,
        stock: doesTrackStock ? (parseFloat(stock) || 0) : undefined,
        minStock: doesTrackStock ? minStock : undefined,
        saleType,
        unit,
        supplier: supplier.trim(),
        location: storageLocation.trim(),
        cost: parseFloat(cost) || 0,
        price: parseFloat(price) || 0,
        description: description.trim(),
        image: imageData
    }), [
        name, barcode, categoryId, doesTrackStock, stock, minStock,
        saleType, unit, supplier, storageLocation, cost, price,
        description, imageData
    ]);

    return {
        // Navegación
        currentStep,
        steps: STEPS,
        nextStep,
        prevStep,
        goToStep,
        isFirstStep,
        isLastStep,
        progress,

        // Estado de guardado
        isSaving,
        setIsSaving,

        // Paso 1 - Básicos
        name, setName,
        barcode, setBarcode,
        categoryId, setCategoryId,
        isScannerOpen, setIsScannerOpen,
        step1Errors: stepErrors[1],

        // Paso 2 - Inventario
        doesTrackStock, setDoesTrackStock,
        stock, setStock,
        minStock, setMinStock,
        saleType, setSaleType,
        unit, setUnit,
        supplier, setSupplier,
        storageLocation, setStorageLocation,
        conversionFactor, setConversionFactor,
        step2Errors: stepErrors[2],

        // Paso 3 - Precio y Detalles
        cost, setCost,
        price, setPrice,
        margin, setMargin,
        description, setDescription,
        imageData, setImageData,
        imagePreview, setImagePreview,
        step3Errors: stepErrors[3],

        // Handlers
        handleCostChange,
        handlePriceChange,
        handleMarginChange,
        getProductData,

        // Utilidades
        validateStep1,
        validateStep2,
        validateStep3
    };
}
