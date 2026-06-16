import Step1Basicos from './Step1Basicos';
import Step2Inventario from './Step2Inventario';
import Step3PrecioDetalles from './Step3PrecioDetalles';

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

    // Renderizar el paso actual
    const renderStep = () => {
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
    };

    // Manejar envío del formulario
    const handleSubmit = async () => {
        // Validar último paso
        const isValid = wizard.validateStep3?.() || true;
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
            alert('Error al guardar el producto. Por favor intenta de nuevo.');
        } finally {
            setIsSaving?.(false);
        }
    };

    // Manejar navegación con validación
    const handleNext = () => {
        if (isLastStep) {
            handleSubmit();
        } else {
            nextStep();
        }
    };

    return (
        <div className="product-form-wizard">
            {/* Barra de Progreso Superior */}
            <div style={{
                marginBottom: '25px',
                backgroundColor: 'var(--card-background-color)',
                padding: '20px',
                borderRadius: '12px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
                {/* Steps Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                    {steps.map((step, index) => {
                        const isCompleted = currentStep > step.id;
                        const isCurrent = currentStep === step.id;
                        
                        return (
                            <div
                                key={step.id}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    flex: 1,
                                    position: 'relative'
                                }}
                            >
                                {/* Círculo del paso */}
                                <div
                                    style={{
                                        width: '40px',
                                        height: '40px',
                                        borderRadius: '50%',
                                        backgroundColor: isCompleted || isCurrent 
                                            ? 'var(--primary-color)' 
                                            : 'var(--border-color)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '1.2rem',
                                        transition: 'all 0.3s ease',
                                        boxShadow: isCurrent ? '0 0 0 3px rgba(59, 130, 246, 0.3)' : 'none',
                                        zIndex: 1
                                    }}
                                >
                                    {isCompleted ? '✓' : step.icon}
                                </div>
                                
                                {/* Label del paso */}
                                <span style={{
                                    fontSize: '0.85rem',
                                    marginTop: '8px',
                                    color: isCompleted || isCurrent 
                                        ? 'var(--primary-color)' 
                                        : 'var(--text-light)',
                                    fontWeight: isCurrent ? '600' : '400'
                                }}>
                                    {step.name}
                                </span>

                                {/* Línea conectora (excepto último) */}
                                {index < steps.length - 1 && (
                                    <div style={{
                                        position: 'absolute',
                                        top: '20px',
                                        left: '50%',
                                        width: '100%',
                                        height: '2px',
                                        backgroundColor: 'var(--border-color)',
                                        zIndex: 0,
                                        transform: 'translateY(-50%)'
                                    }}>
                                        <div style={{
                                            height: '100%',
                                            width: `${isCompleted ? '100%' : '0%'}`,
                                            backgroundColor: 'var(--primary-color)',
                                            transition: 'width 0.3s ease'
                                        }}></div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Barra de progreso lineal */}
                <div style={{
                    height: '6px',
                    backgroundColor: 'var(--light-background)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                    marginTop: '10px'
                }}>
                    <div style={{
                        height: '100%',
                        width: `${progress}%`,
                        backgroundColor: 'var(--primary-color)',
                        transition: 'width 0.3s ease'
                    }}></div>
                </div>
            </div>

            {/* Contenido del Paso */}
            <div style={{
                backgroundColor: 'var(--card-background-color)',
                padding: '25px',
                borderRadius: '12px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                minHeight: '400px'
            }}>
                {renderStep()}
            </div>

            {/* Botones de Navegación */}
            <div style={{
                display: 'flex',
                gap: '15px',
                marginTop: '25px',
                paddingTop: '20px',
                borderTop: '1px solid var(--border-color)'
            }}>
                {/* Botón Atrás */}
                {!isFirstStep && (
                    <button
                        type="button"
                        className="btn btn-cancel"
                        onClick={prevStep}
                        style={{
                            flex: 1,
                            padding: '14px 24px',
                            fontSize: '1rem',
                            fontWeight: '600'
                        }}
                    >
                        ← Atrás
                    </button>
                )}

                {/* Botón Cancelar (solo en primer paso) */}
                {isFirstStep && (
                    <button
                        type="button"
                        className="btn btn-cancel"
                        onClick={onCancel}
                        style={{
                            flex: 1,
                            padding: '14px 24px',
                            fontSize: '1rem',
                            fontWeight: '600'
                        }}
                    >
                        Cancelar
                    </button>
                )}

                {/* Botón Siguiente / Guardar */}
                <button
                    type="button"
                    className="btn btn-save"
                    onClick={handleNext}
                    disabled={isSaving}
                    style={{
                        flex: isFirstStep ? 2 : 2,
                        padding: '14px 24px',
                        fontSize: '1rem',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '10px'
                    }}
                >
                    {isSaving ? (
                        <>
                            <span>⏳</span> Guardando...
                        </>
                    ) : isLastStep ? (
                        <>
                            <span>✓</span> Guardar Producto
                        </>
                    ) : (
                        <>
                            Continuar <span>→</span>
                        </>
                    )}
                </button>
            </div>

            {/* Tips por rubro */}
            {activeRubroContext && (
                <div style={{
                    marginTop: '20px',
                    padding: '15px',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderRadius: '12px',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px'
                }}>
                    <span style={{ fontSize: '1.5rem' }}>💡</span>
                    <div>
                        <p style={{ 
                            margin: 0, 
                            fontSize: '0.9rem', 
                            fontWeight: '600', 
                            color: 'var(--text-dark)',
                            marginBottom: '4px'
                        }}>
                            Modo {getRubroLabel(activeRubroContext)}
                        </p>
                        <p style={{ 
                            margin: 0, 
                            fontSize: '0.85rem', 
                            color: 'var(--text-color)' 
                        }}>
                            {getRubroTip(activeRubroContext)}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

// Helpers para labels y tips por rubro
function getRubroLabel(rubro) {
    const labels = {
        'food_service': 'Restaurante',
        'abarrotes': 'Abarrotes',
        'farmacia': 'Farmacia',
        'verduleria/fruteria': 'Frutería',
        'apparel': 'Ropa y Accesorios',
        'hardware': 'Ferretería',
        'otro': 'General'
    };
    return labels[rubro] || rubro;
}

function getRubroTip(rubro) {
    const tips = {
        'food_service': 'Para platillos, configura el tiempo de preparación y la estación de impresión. Para ingredientes, usa el constructor de recetas.',
        'abarrotes': 'Si vendes a granel, configura la unidad de medida correcta (kg, lt, mt). Activa alertas de stock mínimo.',
        'farmacia': 'Los medicamentos controlados requieren sustancia activa. El sistema manejará caducidades con FEFO.',
        'verduleria/fruteria': 'Configura la vida útil para alertas de merma. Usa kg para peso o pieza para productos unitarios.',
        'apparel': 'Puedes agregar variantes de talla y color en el siguiente paso.',
        'hardware': 'Para productos con medidas (tornillos, cables), especifica la unidad de venta claramente.',
        'otro': 'Configura los campos básicos y agrega detalles según necesites.'
    };
    return tips[rubro] || 'Configura los campos según las necesidades de tu producto.';
}
