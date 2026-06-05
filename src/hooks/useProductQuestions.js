import { useState, useCallback, useMemo } from 'react';

/**
 * Hook para manejar preguntas inteligentes por rubro
 * Ayuda al usuario a configurar su producto mediante preguntas en lenguaje natural
 */
export function useProductQuestions(activeRubroContext, initialData = {}) {
    // Estado para las respuestas del usuario
    const [answers, setAnswers] = useState({});

    // Preguntas configuradas por rubro
    const questionsConfig = useMemo(() => ({
        // ABARROTES / TIENDA
        'abarrotes': [
            {
                id: 'saleType',
                question: '¿Cómo vendes este producto?',
                icon: '📦',
                options: [
                    { 
                        value: 'unit', 
                        label: 'Por Pieza/Unidad', 
                        icon: '🍬',
                        description: 'Productos individuales como latas, bolsas, cajas'
                    },
                    { 
                        value: 'bulk', 
                        label: 'A Granel', 
                        icon: '⚖️',
                        description: 'Productos que se venden por peso o medida'
                    }
                ]
            },
            {
                id: 'bulkUnit',
                question: '¿En qué unidad lo vendes?',
                icon: '📏',
                dependsOn: { field: 'saleType', value: 'bulk' },
                options: [
                    { value: 'kg', label: 'Kilogramos (kg)', icon: '🥡' },
                    { value: 'gr', label: 'Gramos (gr)', icon: '🧂' },
                    { value: 'lt', label: 'Litros (lt)', icon: '🥛' },
                    { value: 'ml', label: 'Mililitros (ml)', icon: '🧴' },
                    { value: 'mt', label: 'Metros (m)', icon: '📐' }
                ]
            },
            {
                id: 'hasConversion',
                question: '¿Compras en una unidad y vendes en otra?',
                icon: '🔄',
                dependsOn: { field: 'saleType', value: 'bulk' },
                type: 'yesno',
                helpText: 'Ejemplo: Compras cajas de 25kg pero vendes por kilo'
            }
        ],

        // FERRETERÍA
        'hardware': [
            {
                id: 'productSubtype',
                question: '¿Qué tipo de producto es?',
                icon: '🔧',
                options: [
                    { 
                        value: 'fastener', 
                        label: 'Tornillería', 
                        icon: '🔩',
                        description: 'Tornillos, tuercas, tornillos, clavos'
                    },
                    { 
                        value: 'tool', 
                        label: 'Herramientas', 
                        icon: '🔨',
                        description: 'Martillos, destornilladores, llaves'
                    },
                    { 
                        value: 'electrical', 
                        label: 'Eléctricos', 
                        icon: '⚡',
                        description: 'Cables, interruptores, focos'
                    },
                    { 
                        value: 'plumbing', 
                        label: 'Plomería', 
                        icon: '🚿',
                        description: 'Tubos, conexiones, grifos'
                    },
                    { 
                        value: 'paint', 
                        label: 'Pinturas', 
                        icon: '🎨',
                        description: 'Pinturas, barnices, brochas'
                    },
                    { 
                        value: 'other', 
                        label: 'Otro', 
                        icon: '📦',
                        description: 'Otros productos de ferretería'
                    }
                ]
            },
            {
                id: 'measurementUnit',
                question: '¿Cómo se mide o vende?',
                icon: '📏',
                dependsOn: { field: 'productSubtype', value: 'fastener' },
                options: [
                    { value: 'pza', label: 'Por Pieza', icon: '🔩' },
                    { value: 'caja', label: 'Por Caja', icon: '📦' },
                    { value: 'kg', label: 'Por Kilo', icon: '⚖️' },
                    { value: 'lt', label: 'Por Litro', icon: '🥛' }
                ]
            },
            {
                id: 'hasVariants',
                question: '¿Tiene variantes (medida, color, material)?',
                icon: '🎯',
                dependsOn: { field: 'productSubtype', value: 'tool' },
                type: 'yesno'
            }
        ],

        // RESTAURANTE / FOOD SERVICE
        'food_service': [
            {
                id: 'productNature',
                question: '¿Qué tipo de producto es?',
                icon: '🍽️',
                options: [
                    { 
                        value: 'dish', 
                        label: 'Platillo Preparado', 
                        icon: '🍝',
                        description: 'Platos que se preparan bajo pedido'
                    },
                    { 
                        value: 'ingredient', 
                        label: 'Ingrediente', 
                        icon: '🥬',
                        description: 'Insumos para preparar platillos'
                    },
                    { 
                        value: 'beverage', 
                        label: 'Bebida', 
                        icon: '🥤',
                        description: 'Refrescos, jugos, bebidas alcohólicas'
                    },
                    { 
                        value: 'ready', 
                        label: 'Producto Listo', 
                        icon: '🍱',
                        description: 'Productos empaquetados para vender'
                    }
                ]
            },
            {
                id: 'prepTime',
                question: '¿Cuánto tarda en prepararse?',
                icon: '⏱️',
                dependsOn: { field: 'productNature', value: 'dish' },
                type: 'number',
                unit: 'minutos',
                placeholder: 'Ej: 15'
            },
            {
                id: 'hasRecipe',
                question: '¿Lleva receta con ingredientes?',
                icon: '📝',
                dependsOn: { field: 'productNature', value: 'dish' },
                type: 'yesno',
                helpText: 'El sistema descontará automáticamente los ingredientes al vender'
            },
            {
                id: 'printStation',
                question: '¿Dónde se imprime la comanda?',
                icon: '🖨️',
                dependsOn: { field: 'productNature', value: 'dish' },
                type: 'select',
                options: [
                    { value: 'kitchen', label: 'Cocina', icon: '🔥' },
                    { value: 'bar', label: 'Barra', icon: '🍹' },
                    { value: 'both', label: 'Ambos', icon: '🏪' }
                ]
            }
        ],

        // FARMACIA
        'farmacia': [
            {
                id: 'medicationType',
                question: '¿Qué tipo de medicamento es?',
                icon: '💊',
                options: [
                    { 
                        value: 'otc', 
                        label: 'Venta Libre', 
                        icon: '🟢',
                        description: 'No requiere receta (OTC)'
                    },
                    { 
                        value: 'antibiotic', 
                        label: 'Antibiótico', 
                        icon: '🟠',
                        description: 'Requiere receta simple'
                    },
                    { 
                        value: 'controlled', 
                        label: 'Controlado', 
                        icon: '🔴',
                        description: 'Requiere receta retenida'
                    }
                ]
            },
            {
                id: 'hasActiveSubstance',
                question: '¿Conoces la sustancia activa?',
                icon: '🧪',
                dependsOn: { field: 'medicationType', value: 'antibiotic' },
                type: 'yesno',
                helpText: 'Requerido para reportes de COFEPRIS'
            },
            {
                id: 'hasBatchTracking',
                question: '¿Manejas número de lote?',
                icon: '📋',
                type: 'yesno',
                helpText: 'Recomendado para control de caducidades'
            }
        ],

        // FRUTERÍA / VERDULERÍA
        'verduleria/fruteria': [
            {
                id: 'saleType',
                question: '¿Cómo vendes este producto?',
                icon: '🛒',
                options: [
                    { 
                        value: 'unit', 
                        label: 'Por Pieza/Manojo', 
                        icon: '🍎',
                        description: 'Productos individuales como manzanas, zanahorias'
                    },
                    { 
                        value: 'bulk', 
                        label: 'Por Peso', 
                        icon: '⚖️',
                        description: 'Productos que se pesan'
                    }
                ]
            },

            {
                id: 'isPerishable',
                question: '¿Es producto perecedero?',
                icon: '🥬',
                type: 'yesno',
                helpText: 'Los productos perecederos requieren control de caducidad'
            }
        ],

        // ROPA / APPAREL
        'apparel': [
            {
                id: 'hasVariants',
                question: '¿Este producto tiene variantes?',
                icon: '👕',
                type: 'yesno',
                helpText: 'Tallas, colores, modelos diferentes'
            },
            {
                id: 'variantTypes',
                question: '¿Qué tipos de variantes manejas?',
                icon: '🎯',
                dependsOn: { field: 'hasVariants', value: true },
                type: 'multiselect',
                options: [
                    { value: 'size', label: 'Tallas', icon: '📏' },
                    { value: 'color', label: 'Colores', icon: '🎨' },
                    { value: 'model', label: 'Modelos', icon: '👗' }
                ]
            }
        ],

        // POR DEFECTO (OTRO)
        'otro': [
            {
                id: 'saleType',
                question: '¿Cómo vendes este producto?',
                icon: '📦',
                options: [
                    { 
                        value: 'unit', 
                        label: 'Por Pieza', 
                        icon: '📦',
                        description: 'Productos individuales'
                    },
                    { 
                        value: 'bulk', 
                        label: 'Por Medida', 
                        icon: '📏',
                        description: 'Productos medibles'
                    },
                    { 
                        value: 'service', 
                        label: 'Servicio', 
                        icon: '🛠️',
                        description: 'Servicios sin inventario'
                    }
                ]
            }
        ]
    }), []);

    // Obtener preguntas para el rubro actual
    const questions = useMemo(() => {
        return questionsConfig[activeRubroContext] || questionsConfig['otro'];
    }, [activeRubroContext, questionsConfig]);

    // Filtrar preguntas según respuestas previas
    const visibleQuestions = useMemo(() => {
        return questions.filter(q => {
            if (!q.dependsOn) return true;
            const { field, value } = q.dependsOn;
            return answers[field] === value;
        });
    }, [questions, answers]);

    // Manejar respuesta
    const answerQuestion = useCallback((questionId, value) => {
        setAnswers(prev => {
            const newAnswers = { ...prev, [questionId]: value };
            
            // Si cambiamos una respuesta de la que dependen otras, limpiamos las dependientes
            const dependentQuestions = questions.filter(q => 
                q.dependsOn?.field === questionId
            );
            
            dependentQuestions.forEach(q => {
                delete newAnswers[q.id];
            });
            
            return newAnswers;
        });
    }, [questions]);

    // Obtener configuración derivada de las respuestas
    const derivedConfig = useMemo(() => {
        const config = {};
        
        // Configurar según rubro
        switch (activeRubroContext) {
            case 'abarrotes':
                config.saleType = answers.saleType || 'unit';
                if (answers.saleType === 'bulk') {
                    config.unit = answers.bulkUnit || 'kg';
                    config.hasConversion = answers.hasConversion === true;
                }
                break;
                
            case 'hardware':
                config.productSubtype = answers.productSubtype || 'other';
                if (answers.productSubtype === 'fastener') {
                    config.unit = answers.measurementUnit || 'pza';
                }
                break;
                
            case 'food_service':
                config.productNature = answers.productNature || 'ready';
                if (answers.productNature === 'dish') {
                    config.prepTime = answers.prepTime || 0;
                    config.hasRecipe = answers.hasRecipe === true;
                    config.printStation = answers.printStation || 'kitchen';
                }
                break;
                
            case 'farmacia':
                config.prescriptionType = answers.medicationType || 'otc';
                config.hasBatchTracking = answers.hasBatchTracking !== false;
                break;
                
            case 'verduleria/fruteria':
                config.saleType = answers.saleType || 'unit';
                config.isPerishable = answers.isPerishable !== false;
                break;
                
            case 'apparel':
                config.hasVariants = answers.hasVariants === true;
                config.variantTypes = answers.variantTypes || [];
                break;
                
            default:
                config.saleType = answers.saleType || 'unit';
                break;
        }
        
        return config;
    }, [answers, activeRubroContext]);

    // Progreso de respuestas
    const progress = useMemo(() => {
        const totalQuestions = questions.length;
        const answeredQuestions = Object.keys(answers).length;
        return {
            total: totalQuestions,
            answered: answeredQuestions,
            percentage: totalQuestions > 0 ? (answeredQuestions / totalQuestions) * 100 : 0
        };
    }, [questions, answers]);

    return {
        questions,
        visibleQuestions,
        answers,
        answerQuestion,
        derivedConfig,
        progress,
        resetAnswers: () => setAnswers({})
    };
}
