import { Check, ChevronLeft, ChevronRight, Lightbulb, Loader2 } from 'lucide-react';
import Step1Basicos from './Step1Basicos';
import Step2Inventario from './Step2Inventario';
import Step3PrecioDetalles from './Step3PrecioDetalles';
import { showMessageModal } from '../../../services/utils';

export default function ProductFormWizard({
    wizard,
    categories,
    onOpenCategoryManager,
    activeRubroContext,
    onSave,
    onCancel,
    productToEdit
}) {
    const {
        currentStep,
        steps,
        nextStep,
        prevStep,
        isFirstStep,
        isLastStep,
        progress,
        getProductData,
        isSaving,
        setIsSaving
    } = wizard;

    const handleSubmit = async () => {
        const isValid = wizard.validateStep3 ? wizard.validateStep3() : true;
        if (!isValid) return;

        setIsSaving?.(true);
        try {
            const productData = getProductData();
            const productId = productToEdit?.id || Date.now().toString();

            const payload = {
                id: productId,
                ...productData,
                rubroContext: activeRubroContext,
                productType: 'sellable',
                ...(productToEdit ? {} : { createdAt: new Date().toISOString() })
            };

            await onSave(payload, productToEdit || { id: productId, isNew: true });
        } catch (error) {
            console.error('Error al guardar producto:', error);
            showMessageModal('Error al guardar el producto. Por favor intenta de nuevo.', null, { type: 'error' });
        } finally {
            setIsSaving?.(false);
        }
    };

    const handleNext = () => {
        if (isLastStep) {
            handleSubmit();
        } else {
            nextStep();
        }
    };

    return (
        <div className="product-form-wizard">
            <div className="product-form-wizard__progress">
                <div className="product-form-wizard__steps">
                    {steps.map((step, index) => {
                        const isCompleted = currentStep > step.id;
                        const isCurrent = currentStep === step.id;

                        return (
                            <div key={step.id} className="product-form-wizard__step">
                                <div
                                    className={`product-form-wizard__step-dot ${isCompleted ? 'is-completed' : ''} ${isCurrent ? 'is-current' : ''}`}
                                >
                                    {isCompleted ? <Check size={18} aria-hidden="true" /> : step.icon}
                                </div>

                                <span className={`product-form-wizard__step-label ${isCompleted || isCurrent ? 'is-active' : ''}`}>
                                    {step.name}
                                </span>

                                {index < steps.length - 1 && (
                                    <div className="product-form-wizard__connector">
                                        <div
                                            className="product-form-wizard__connector-fill"
                                            style={{ width: `${isCompleted ? '100%' : '0%'}` }}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="product-form-wizard__progress-track">
                    <div
                        className="product-form-wizard__progress-fill"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>

            <div className="product-form-wizard__content">
                <ProductWizardStep
                    currentStep={currentStep}
                    wizard={wizard}
                    categories={categories}
                    onOpenCategoryManager={onOpenCategoryManager}
                    activeRubroContext={activeRubroContext}
                />
            </div>

            <div className="product-form-wizard__actions">
                {!isFirstStep && (
                    <button type="button" className="btn btn-cancel" onClick={prevStep}>
                        <ChevronLeft size={18} aria-hidden="true" />
                        Atras
                    </button>
                )}

                {isFirstStep && (
                    <button type="button" className="btn btn-cancel" onClick={onCancel}>
                        Cancelar
                    </button>
                )}

                <button
                    type="button"
                    className="btn btn-save"
                    onClick={handleNext}
                    disabled={isSaving}
                >
                    {isSaving ? (
                        <>
                            <Loader2 size={18} aria-hidden="true" /> Guardando...
                        </>
                    ) : isLastStep ? (
                        <>
                            <Check size={18} aria-hidden="true" /> Guardar producto
                        </>
                    ) : (
                        <>
                            Continuar <ChevronRight size={18} aria-hidden="true" />
                        </>
                    )}
                </button>
            </div>

            {activeRubroContext && (
                <div className="product-form-wizard__tip">
                    <Lightbulb size={22} aria-hidden="true" />
                    <div>
                        <p className="product-form-wizard__tip-title">
                            Modo {getRubroLabel(activeRubroContext)}
                        </p>
                        <p className="product-form-wizard__tip-copy">
                            {getRubroTip(activeRubroContext)}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

function ProductWizardStep({
    currentStep,
    wizard,
    categories,
    onOpenCategoryManager,
    activeRubroContext
}) {
    switch (currentStep) {
        case 1:
            return (
                <Step1Basicos
                    wizard={wizard}
                    categories={categories}
                    onOpenCategoryManager={onOpenCategoryManager}
                />
            );
        case 2:
            return (
                <Step2Inventario
                    wizard={wizard}
                    activeRubroContext={activeRubroContext}
                />
            );
        case 3:
            return (
                <Step3PrecioDetalles
                    wizard={wizard}
                    activeRubroContext={activeRubroContext}
                />
            );
        default:
            return null;
    }
}

function getRubroLabel(rubro) {
    const labels = {
        food_service: 'Restaurante',
        abarrotes: 'Abarrotes',
        farmacia: 'Farmacia',
        'verduleria/fruteria': 'Fruteria',
        apparel: 'Ropa y Accesorios',
        hardware: 'Ferreteria',
        otro: 'General'
    };
    return labels[rubro] || rubro;
}

function getRubroTip(rubro) {
    const tips = {
        food_service: 'Para platillos, configura el tiempo de preparacion y la estacion de impresion. Para ingredientes, usa el constructor de recetas.',
        abarrotes: 'Si vendes a granel, configura la unidad de medida correcta (kg, lt, mt). Activa alertas de stock minimo.',
        farmacia: 'Los medicamentos controlados requieren sustancia activa. El sistema manejara caducidades con FEFO.',
        'verduleria/fruteria': 'Configura la vida util para alertas de merma. Usa kg para peso o pieza para productos unitarios.',
        apparel: 'Puedes agregar variantes de talla y color en el siguiente paso.',
        hardware: 'Para productos con medidas (tornillos, cables), especifica la unidad de venta claramente.',
        otro: 'Configura los campos basicos y agrega detalles segun necesites.'
    };
    return tips[rubro] || 'Configura los campos segun las necesidades de tu producto.';
}
