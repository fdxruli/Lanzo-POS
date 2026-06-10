import React from 'react';
import { Leaf, Utensils, AlertTriangle, ArrowLeft, ArrowRight, Trash2, Info, CheckCircle } from 'lucide-react';
import './WasteHistory.css';

export default function WasteHistory({
    logs,
    onNext = () => {},
    onPrev = () => {},
    hasMoreWaste = false,
    currentWastePageIndex = 0,
    isWasteLoading = false,
    activeRubros = []
}) {
    const totalLoss = logs.reduce((sum, log) => sum + (log.lossAmount || 0), 0);

    // Determine the main theme based on rubro
    const isVerduleria = activeRubros.includes('verduleria/fruteria');
    const isFoodService = activeRubros.includes('food_service');
    const themeClass = isVerduleria ? 'theme-verduleria' : isFoodService ? 'theme-food' : 'theme-default';

    // Helper for icons based on rubro
    const getProductIcon = () => {
        if (isVerduleria) return <Leaf size={20} />;
        if (isFoodService) return <Utensils size={20} />;
        return <AlertTriangle size={20} />;
    };

    // Helper for reason styling
    const getReasonStyle = (reason = '') => {
        const lowerReason = reason.toLowerCase();
        if (lowerReason.includes('venci') || lowerReason.includes('caduca')) {
            return { badge: 'badge-red', severity: 'severity-high' };
        }
        if (lowerReason.includes('error') || lowerReason.includes('devolu')) {
            return { badge: 'badge-orange', severity: 'severity-medium' };
        }
        if (lowerReason.includes('mal estado') || lowerReason.includes('dañ') || lowerReason.includes('podri')) {
            return { badge: 'badge-yellow', severity: 'severity-medium' };
        }
        return { badge: 'badge-gray', severity: 'severity-low' };
    };

    return (
        <div className={`waste-history-wrapper ${themeClass}`}>
            {/* Summary Card */}
            <div className="waste-summary-card">
                <div className="waste-header-title">
                    <Trash2 size={28} color="#ef4444" />
                    <div>
                        <h3>Reporte de Mermas</h3>
                        <small style={{ color: '#6b7280' }}>
                            {isVerduleria ? 'Control de mermas y desperdicios de productos' : 
                             isFoodService ? 'Control de ingredientes y platillos desperdiciados' : 
                             'Control de pérdidas y mermas'}
                        </small>
                    </div>
                </div>
                <div className="waste-total-box">
                    <div className="waste-total-label">Pérdida Registrada (Pág.)</div>
                    <div className="waste-total-value">
                        -${totalLoss.toFixed(2)}
                    </div>
                </div>
            </div>

            {/* List or Empty State */}
            {logs.length === 0 ? (
                <div className="waste-empty-state">
                    <CheckCircle size={48} className="waste-empty-icon" />
                    <div className="waste-empty-title">¡Excelente trabajo!</div>
                    <div className="waste-empty-text">No hay registros de merma en esta página.</div>
                </div>
            ) : (
                <div className="waste-grid">
                    {logs.map((log) => {
                        const { badge, severity } = getReasonStyle(log.reason || '');
                        return (
                            <div key={log.id} className={`waste-card ${severity}`}>
                                <div className="waste-card-header">
                                    <div className="waste-product-info">
                                        <div className="waste-icon-container">
                                            {getProductIcon()}
                                        </div>
                                        <div>
                                            <h4 className="waste-product-name">{log.productName}</h4>
                                            <span className="waste-product-qty">
                                                {log.quantity} {log.unit}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="waste-loss-amount">
                                        -${log.lossAmount?.toFixed(2)}
                                    </div>
                                </div>
                                
                                <div className="waste-card-body">
                                    <span className={`waste-reason-badge ${badge}`}>
                                        <Info size={14} />
                                        {log.reason || 'Sin motivo'}
                                    </span>
                                    
                                    {log.notes && (
                                        <div className="waste-notes">
                                            "{log.notes}"
                                        </div>
                                    )}
                                    
                                    <div className="waste-date">
                                        {new Date(log.timestamp).toLocaleDateString()} {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Pagination controls */}
            <div className="waste-pagination">
                <button
                    className="waste-page-btn"
                    onClick={onPrev}
                    disabled={isWasteLoading || currentWastePageIndex === 0}
                >
                    <ArrowLeft size={18} />
                    {isWasteLoading ? 'Cargando...' : 'Anterior'}
                </button>

                <span className="waste-page-info">
                    Página {currentWastePageIndex + 1}
                </span>

                <button
                    className="waste-page-btn"
                    onClick={onNext}
                    disabled={isWasteLoading || !hasMoreWaste}
                >
                    {isWasteLoading ? 'Cargando...' : 'Siguiente'}
                    <ArrowRight size={18} />
                </button>
            </div>
        </div>
    );
}
