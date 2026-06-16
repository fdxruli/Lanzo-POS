/**
 * Componente que muestra ayuda visual dinámica basada en las respuestas del usuario
 * Muestra ejemplos en tiempo real para ayudar al usuario a entender su configuración
 */
export default function DynamicHelp({
    activeRubroContext,
    answers,
    wizard
}) {
    // No mostrar si no hay respuestas
    if (!answers || Object.keys(answers).length === 0) return null;

    return (
        <div className="dynamic-help-container">
            {activeRubroContext === 'abarrotes' && (
                <AbarrotesHelp answers={answers} wizard={wizard} />
            )}
            {activeRubroContext === 'hardware' && (
                <HardwareHelp answers={answers} wizard={wizard} />
            )}
            {activeRubroContext === 'food_service' && (
                <FoodServiceHelp answers={answers} wizard={wizard} />
            )}
            {activeRubroContext === 'farmacia' && (
                <FarmaciaHelp answers={answers} wizard={wizard} />
            )}
            {activeRubroContext === 'verduleria/fruteria' && (
                <FruteriaHelp answers={answers} wizard={wizard} />
            )}
        </div>
    );
}

/**
 * Ayuda para Abarrotes
 */
function AbarrotesHelp({ answers }) {
    const { saleType, bulkUnit, hasConversion } = answers;

    if (saleType === undefined) return null;

    return (
        <div style={{
            marginTop: '15px',
            padding: '15px',
            backgroundColor: 'rgba(0, 196, 140, 0.1)',
            borderRadius: '10px',
            border: '1px solid #bbf7d0'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <span style={{ fontSize: '1.3rem' }}>📦</span>
                <strong style={{ color: 'var(--success-color)', fontSize: '0.95rem' }}>
                    Ejemplo en tiempo real
                </strong>
            </div>

            {saleType === 'unit' && (
                <div style={{ color: '#15803d', fontSize: '0.9rem' }}>
                    <p style={{ margin: '0 0 8px 0' }}>
                        <strong>Configuración:</strong> Venta por pieza/unidad
                    </p>
                    <div style={{ 
                        backgroundColor: 'var(--card-background-color)', 
                        padding: '10px', 
                        borderRadius: '6px',
                        border: '1px solid #86efac'
                    }}>
                        <p style={{ margin: 0 }}>
                            🛒 Si vendes <strong>Coca Cola 600ml</strong> y tienes <strong>24 piezas</strong> en stock:
                        </p>
                        <ul style={{ margin: '8px 0 0 20px', padding: 0 }}>
                            <li>Vendes 1 pieza → Restas 1 pieza</li>
                            <li>Quedan 23 piezas</li>
                        </ul>
                    </div>
                </div>
            )}

            {saleType === 'bulk' && bulkUnit && (
                <div style={{ color: '#15803d', fontSize: '0.9rem' }}>
                    <p style={{ margin: '0 0 8px 0' }}>
                        <strong>Configuración:</strong> Venta por {getUnitLabel(bulkUnit)}
                    </p>
                    <div style={{ 
                        backgroundColor: 'var(--card-background-color)', 
                        padding: '10px', 
                        borderRadius: '6px',
                        border: '1px solid #86efac'
                    }}>
                        <p style={{ margin: 0 }}>
                            ⚖️ Si vendes <strong>Arroz a granel</strong> y tienes <strong>50 {bulkUnit}</strong>:
                        </p>
                        <ul style={{ margin: '8px 0 0 20px', padding: 0 }}>
                            <li>Un cliente pide 2 {bulkUnit} → Restas 2 {bulkUnit}</li>
                            <li>Quedan 48 {bulkUnit}</li>
                        </ul>
                    </div>
                </div>
            )}

            {hasConversion === true && bulkUnit && (
                <div style={{ 
                    marginTop: '12px',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid var(--primary-color)'
                }}>
                    <p style={{ margin: '0 0 8px 0', color: 'var(--text-color)', fontSize: '0.9rem' }}>
                        <strong>🔄 Con conversión de compra:</strong>
                    </p>
                    <div style={{ color: 'var(--text-color)', fontSize: '0.85rem' }}>
                        <p style={{ margin: '0 0 6px 0' }}>
                            Si configuras que compras una <strong>caja de 25kg</strong>:
                        </p>
                        <div style={{ 
                            backgroundColor: 'var(--card-background-color)', 
                            padding: '8px', 
                            borderRadius: '6px',
                            fontFamily: 'monospace',
                            fontSize: '0.85rem'
                        }}>
                            1 caja = 25kg → Al recibir 1 caja, sumas 25kg al stock
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Ayuda para Ferretería
 */
function HardwareHelp({ answers }) {
    const { productSubtype, measurementUnit } = answers;

    if (!productSubtype) return null;

    const examples = {
        fastener: {
            icon: '🔩',
            name: 'Tornillos',
            example: 'Tornillos 3/8"x1"',
            config: measurementUnit === 'kg' ? 'venta por kilo' : measurementUnit === 'caja' ? 'venta por caja' : 'venta por pieza'
        },
        tool: {
            icon: '🔨',
            name: 'Herramientas',
            example: 'Martillo de acero',
            config: 'venta por pieza'
        },
        electrical: {
            icon: '⚡',
            name: 'Eléctricos',
            example: 'Cable calibre 12',
            config: measurementUnit === 'mt' ? 'venta por metro' : 'venta por pieza'
        },
        plumbing: {
            icon: '🚿',
            name: 'Plomería',
            example: 'Tubo PVC 1/2"',
            config: measurementUnit === 'mt' ? 'venta por metro' : 'venta por pieza'
        },
        paint: {
            icon: '🎨',
            name: 'Pinturas',
            example: 'Pintura blanca 1L',
            config: measurementUnit === 'lt' ? 'venta por litro' : 'venta por unidad'
        },
        other: {
            icon: '📦',
            name: 'Productos',
            example: 'Producto de ferretería',
            config: 'venta estándar'
        }
    };

    const selectedExample = examples[productSubtype] || examples.other;

    return (
        <div style={{
            marginTop: '15px',
            padding: '15px',
            backgroundColor: '#fef3c7',
            borderRadius: '10px',
            border: '1px solid #fcd34d'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <span style={{ fontSize: '1.3rem' }}>🔧</span>
                <strong style={{ color: '#92400e', fontSize: '0.95rem' }}>
                    Ejemplo para {selectedExample.name}
                </strong>
            </div>

            <div style={{ 
                backgroundColor: 'var(--card-background-color)', 
                padding: '12px', 
                borderRadius: '8px',
                border: '1px solid #fde68a'
            }}>
                <p style={{ margin: '0 0 8px 0', color: '#78350f', fontSize: '0.9rem' }}>
                    <strong>{selectedExample.icon} {selectedExample.example}</strong>
                </p>
                <p style={{ margin: 0, color: '#92400e', fontSize: '0.85rem' }}>
                    Configuración: {selectedExample.config}
                </p>
                {measurementUnit && (
                    <p style={{ margin: '8px 0 0 0', color: '#b45309', fontSize: '0.8rem' }}>
                        📏 Unidad de medida: {getUnitLabel(measurementUnit)}
                    </p>
                )}
            </div>
        </div>
    );
}

/**
 * Ayuda para Food Service
 */
function FoodServiceHelp({ answers }) {
    const { productNature, prepTime, hasRecipe, printStation } = answers;

    if (!productNature) return null;

    return (
        <div style={{
            marginTop: '15px',
            padding: '15px',
            backgroundColor: 'rgba(255, 59, 92, 0.1)',
            borderRadius: '10px',
            border: '1px solid #fecaca'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <span style={{ fontSize: '1.3rem' }}>🍽️</span>
                <strong style={{ color: 'var(--error-color)', fontSize: '0.95rem' }}>
                    Ejemplo de configuración
                </strong>
            </div>

            {productNature === 'dish' && (
                <div style={{ color: 'var(--error-color)', fontSize: '0.9rem' }}>
                    <div style={{ 
                        backgroundColor: 'var(--card-background-color)', 
                        padding: '12px', 
                        borderRadius: '8px',
                        border: '1px solid #fca5a5',
                        marginBottom: '10px'
                    }}>
                        <p style={{ margin: '0 0 8px 0' }}>
                            <strong>🍝 Platillo: &quot;Pasta Alfredo&quot;</strong>
                        </p>
                        {prepTime && (
                            <p style={{ margin: '0 0 6px 0', fontSize: '0.85rem' }}>
                                ⏱️ Tiempo de preparación: <strong>{prepTime} minutos</strong>
                            </p>
                        )}
                        {hasRecipe && (
                            <p style={{ margin: '0 0 6px 0', fontSize: '0.85rem' }}>
                                📝 Lleva receta → El sistema descontará ingredientes automáticamente
                            </p>
                        )}
                        {printStation && (
                            <p style={{ margin: 0, fontSize: '0.85rem' }}>
                                🖨️ Comanda se imprime en: <strong>{getPrintStationLabel(printStation)}</strong>
                            </p>
                        )}
                    </div>
                </div>
            )}

            {productNature === 'ingredient' && (
                <div style={{ 
                    backgroundColor: 'var(--card-background-color)', 
                    padding: '12px', 
                    borderRadius: '8px',
                    border: '1px solid #fca5a5'
                }}>
                    <p style={{ margin: 0, color: 'var(--error-color)', fontSize: '0.9rem' }}>
                        <strong>🥬 Ingrediente</strong>
                    </p>
                    <p style={{ margin: '8px 0 0 0', fontSize: '0.85rem', color: '#b91c1c' }}>
                        Se usará en las recetas de tus platillos. El stock se descontará cuando vendas esos platillos.
                    </p>
                </div>
            )}

            {productNature === 'beverage' && (
                <div style={{ 
                    backgroundColor: 'var(--card-background-color)', 
                    padding: '12px', 
                    borderRadius: '8px',
                    border: '1px solid #fca5a5'
                }}>
                    <p style={{ margin: 0, color: 'var(--error-color)', fontSize: '0.9rem' }}>
                        <strong>🥤 Bebida</strong>
                    </p>
                    <p style={{ margin: '8px 0 0 0', fontSize: '0.85rem', color: '#b91c1c' }}>
                        Configura si es alcohólica para controlar su venta.
                    </p>
                </div>
            )}

            {productNature === 'ready' && (
                <div style={{ 
                    backgroundColor: 'var(--card-background-color)', 
                    padding: '12px', 
                    borderRadius: '8px',
                    border: '1px solid #fca5a5'
                }}>
                    <p style={{ margin: 0, color: 'var(--error-color)', fontSize: '0.9rem' }}>
                        <strong>🍱 Producto Listo</strong>
                    </p>
                    <p style={{ margin: '8px 0 0 0', fontSize: '0.85rem', color: '#b91c1c' }}>
                        Producto empaquetado que se vende directamente sin preparación.
                    </p>
                </div>
            )}
        </div>
    );
}

/**
 * Ayuda para Farmacia
 */
function FarmaciaHelp({ answers }) {
    const { medicationType, hasActiveSubstance, hasBatchTracking } = answers;

    if (!medicationType) return null;

    const typeInfo = {
        otc: { icon: '🟢', label: 'Venta Libre', color: 'var(--success-color)', bg: 'rgba(0, 196, 140, 0.1)', border: '#86efac' },
        antibiotic: { icon: '🟠', label: 'Antibiótico', color: '#92400e', bg: '#fff7ed', border: '#fdba74' },
        controlled: { icon: '🔴', label: 'Controlado', color: 'var(--error-color)', bg: 'rgba(255, 59, 92, 0.1)', border: '#fca5a5' }
    };

    const info = typeInfo[medicationType] || typeInfo.otc;

    return (
        <div style={{
            marginTop: '15px',
            padding: '15px',
            backgroundColor: info.bg,
            borderRadius: '10px',
            border: `1px solid ${info.border}`
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <span style={{ fontSize: '1.3rem' }}>{info.icon}</span>
                <strong style={{ color: info.color, fontSize: '0.95rem' }}>
                    {info.label}
                </strong>
            </div>

            <div style={{ backgroundColor: 'var(--card-background-color)', padding: '12px', borderRadius: '8px' }}>
                {medicationType === 'otc' && (
                    <p style={{ margin: 0, color: '#15803d', fontSize: '0.85rem' }}>
                        ✅ Se puede vender sin restricciones. No requiere receta.
                    </p>
                )}
                {medicationType === 'antibiotic' && (
                    <>
                        <p style={{ margin: '0 0 8px 0', color: '#92400e', fontSize: '0.85rem' }}>
                            ⚠️ Requiere receta médica simple
                        </p>
                        {hasActiveSubstance && (
                            <p style={{ margin: 0, color: '#78350f', fontSize: '0.8rem' }}>
                                📋 Sustancia activa registrada para reportes COFEPRIS
                            </p>
                        )}
                    </>
                )}
                {medicationType === 'controlled' && (
                    <>
                        <p style={{ margin: '0 0 8px 0', color: 'var(--error-color)', fontSize: '0.85rem' }}>
                            🔒 Requiere receta retenida
                        </p>
                        <p style={{ margin: '0 0 6px 0', color: '#7f1d1d', fontSize: '0.8rem' }}>
                            El sistema solicitará:
                        </p>
                        <ul style={{ margin: 0, paddingLeft: '20px', color: '#7f1d1d', fontSize: '0.8rem' }}>
                            <li>Cédula del médico</li>
                            <li>Datos completos del paciente</li>
                            <li>Registro de la receta</li>
                        </ul>
                    </>
                )}
                {hasBatchTracking && (
                    <p style={{ 
                        marginTop: '10px', 
                        color: 'var(--text-dark)', 
                        fontSize: '0.8rem',
                        borderTop: '1px solid #e0f2fe',
                        paddingTop: '8px'
                    }}>
                        📋 Manejo de lotes activado → Control de caducidades
                    </p>
                )}
            </div>
        </div>
    );
}

/**
 * Ayuda para Frutería
 */
function FruteriaHelp({ answers }) {
    const { saleType, isPerishable } = answers;

    if (saleType === undefined) return null;

    return (
        <div style={{
            marginTop: '15px',
            padding: '15px',
            backgroundColor: 'rgba(0, 196, 140, 0.1)',
            borderRadius: '10px',
            border: '1px solid #86efac'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <span style={{ fontSize: '1.3rem' }}>🥬</span>
                <strong style={{ color: 'var(--success-color)', fontSize: '0.95rem' }}>
                    Ejemplo de producto fresco
                </strong>
            </div>

            <div style={{ backgroundColor: 'var(--card-background-color)', padding: '12px', borderRadius: '8px' }}>
                {saleType === 'unit' && (
                    <p style={{ margin: '0 0 8px 0', color: '#15803d', fontSize: '0.9rem' }}>
                        <strong>🍎 Por Pieza/Manojo</strong>
                    </p>
                )}
                {saleType === 'bulk' && (
                    <p style={{ margin: '0 0 8px 0', color: '#15803d', fontSize: '0.9rem' }}>
                        <strong>⚖️ Por Peso (kg)</strong>
                    </p>
                )}
                {isPerishable !== false && (
                    <p style={{ margin: 0, color: '#dc2626', fontSize: '0.85rem' }}>
                        ⚠️ Producto perecedero → La caducidad se registra por Lote
                    </p>
                )}
            </div>
        </div>
    );
}

// Helpers
function getUnitLabel(unit) {
    const labels = {
        kg: 'kilogramos',
        gr: 'gramos',
        lt: 'litros',
        ml: 'mililitros',
        mt: 'metros',
        pza: 'piezas',
        caja: 'cajas',
        manojo: 'manojos',
        bolsa: 'bolsas'
    };
    return labels[unit] || unit;
}

function getPrintStationLabel(station) {
    const labels = {
        kitchen: 'Cocina',
        bar: 'Barra',
        both: 'Cocina y Barra'
    };
    return labels[station] || station;
}
