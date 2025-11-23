import React from 'react';

export default function WasteHistory({ logs }) {
    const totalLoss = logs.reduce((sum, log) => sum + (log.lossAmount || 0), 0);

    return (
        <div className="sales-history-container" style={{ marginTop: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3 className="subtitle" style={{ marginBottom: 0, color: 'var(--error-color)' }}>📉 Historial de Mermas y Desperdicios</h3>
                <div style={{ textAlign: 'right' }}>
                    <small>Pérdida Total Registrada</small>
                    <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--error-color)' }}>
                        -${totalLoss.toFixed(2)}
                    </div>
                </div>
            </div>

            {logs.length === 0 ? (
                <div className="empty-message">No hay registros de merma. ¡Bien hecho!</div>
            ) : (
                <div className="sales-history-list">
                    {logs.map((log) => (
                        <div key={log.id} className="sale-item" style={{ borderLeft: '4px solid var(--error-color)' }}>
                            <div className="sale-item-info" style={{ width: '100%' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ fontWeight: 'bold' }}>{log.productName}</span>
                                    <span style={{ color: 'var(--error-color)', fontWeight: 'bold' }}>- ${log.lossAmount?.toFixed(2)}</span>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px', fontSize: '0.9rem', color: '#666' }}>
                                    <span>
                                        {log.quantity} {log.unit} &bull; {new Date(log.timestamp).toLocaleDateString()}
                                    </span>
                                    <span style={{
                                        backgroundColor: '#fee2e2', color: '#b91c1c',
                                        padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', textTransform: 'uppercase'
                                    }}>
                                        {log.reason}
                                    </span>
                                </div>
                                {log.notes && (
                                    <div style={{ fontSize: '0.85rem', fontStyle: 'italic', marginTop: '4px', color: '#888' }}>
                                        📝 {log.notes}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}