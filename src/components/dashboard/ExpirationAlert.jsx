import React from 'react';
import { useExpirationAlert } from '../../hooks/useExpirationAlert';
import {
  AlertTriangle,
  PackageMinus,
  CalendarCheck,
  EyeOff,
  RotateCcw,
  Pill,
  ChefHat,
  Tag,
  Lightbulb,
  Clock,
  Package,
  Barcode,
  AlertCircle
} from 'lucide-react';
import './ExpirationAlert.css';

const ICONS = {
  pill: Pill,
  'chef-hat': ChefHat,
  tag: Tag,
  lightbulb: Lightbulb
};

export default function ExpirationAlert() {
  const {
    alerts,
    loading,
    editingItem,
    newDate,
    processingId,
    ignoredCount,
    businessContext,
    strategyTip,
    refreshAlerts,
    handleIgnore,
    handleRestoreAll,
    handleMoveToWaste,
    openEditModal,
    handleSaveDate,
    cancelEdit,
    setNewDate
  } = useExpirationAlert();

  const expiredCount = alerts.filter((item) => item.daysRemaining < 0).length;
  const expiringCount = alerts.length - expiredCount;

  const StrategyIcon = ICONS[strategyTip?.icon] || Lightbulb;

  if (loading) {
    return (
      <div className="expiration-loading">
        <Clock className="loading-spinner" size={24} />
        <span>Buscando lotes próximos a vencer...</span>
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="expiration-widget expiration-empty">
        <div className="empty-icon">
          <CalendarCheck size={48} strokeWidth={1.5} />
        </div>
        <div className="empty-content">
          <h3>Todo el inventario está fresco</h3>
          <p>No hay lotes vencidos ni próximos a caducar visibles.</p>
          {ignoredCount > 0 && (
            <button className="btn-restore" onClick={handleRestoreAll}>
              <RotateCcw size={14} />
              Restaurar {ignoredCount} ignoradas
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="expiration-widget" style={{ position: 'relative' }}>
      {/* Header */}
      <div className={`widget-header ${expiredCount > 0 ? 'header-critical' : 'header-warning'}`}>
        <div className="header-content">
          <span className="header-icon">
            {expiredCount > 0 ? (
              <AlertTriangle size={24} />
            ) : (
              <AlertCircle size={24} />
            )}
          </span>
          <div className="header-text">
            <h3>Control de Caducidad</h3>
            <p>
              {expiredCount > 0
                ? `¡Atención! ${expiredCount} lotes vencidos y ${expiringCount} por vencer.`
                : `Tienes ${expiringCount} productos que caducan pronto.`}
            </p>
          </div>
        </div>
      </div>

      {/* Body - Cards Grid */}
      <div className="widget-body">
        <div className="expiration-cards-grid">
          {alerts.slice(0, 10).map((item) => {
            const isExpired = item.daysRemaining < 0;
            const isUrgent = item.daysRemaining <= 7 && !isExpired;
            const isBatch = item.type === 'Lote';

            return (
              <div
                key={item.id}
                className={`expiration-card ${isExpired ? 'card-expired' : (isUrgent ? 'card-urgent' : 'card-normal')}`}
              >
                {/* Card Header */}
                <div className="card-header">
                  <div className="card-product-info">
                    <Package className="card-icon" size={20} />
                    <div>
                      <h4 className="card-product-name">{item.productName}</h4>
                      {isBatch && (
                        <div className="card-batch-sku">
                          <Barcode size={12} />
                          <span>{item.batchSku}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={`card-status ${isExpired ? 'status-danger' : (isUrgent ? 'status-warning' : 'status-info')}`}>
                    {isExpired ? (
                      <>
                        <AlertTriangle size={14} />
                        <span>Vencido</span>
                      </>
                    ) : (
                      <span>{item.daysRemaining} días</span>
                    )}
                  </div>
                </div>

                {/* Card Body */}
                <div className="card-body">
                  {/* Stock Info */}
                  <div className="card-row">
                    <span className="card-label">Stock:</span>
                    <span className="card-value">{item.stock} {item.type === 'Lote' ? 'unidades' : ''}</span>
                  </div>

                  {/* Expiry Date */}
                  <div className="card-row">
                    <span className="card-label">Caducidad:</span>
                    <span className="card-value">{new Date(item.expiryDate).toLocaleDateString()}</span>
                  </div>

                  {/* Contextual Info based on business type */}
                  {businessContext.isPharmacy && isBatch && (
                    <div className="card-row pharmacy-info">
                      <Pill size={14} />
                      <span className="card-label">Requiere:</span>
                      <span className="card-value">
                        {item.prescriptionType === 'antibiotic' ? 'Antibiótico' :
                         item.prescriptionType === 'controlled' ? 'Receta Especial' :
                         item.prescriptionType === 'prescription' ? 'Receta' : 'Venta Libre'}
                      </span>
                    </div>
                  )}

                  {businessContext.isFood && isBatch && (
                    <div className="card-row food-info">
                      <Clock size={14} />
                      <span className="card-label">Ubicación:</span>
                      <span className="card-value">{item.location || 'No especificada'}</span>
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div className="card-actions">
                  {isBatch ? (
                    <>
                      <button
                        className="btn-action btn-edit"
                        onClick={() => openEditModal(item)}
                        disabled={processingId === item.id}
                        title="Corregir Fecha"
                      >
                        <CalendarCheck size={18} />
                        <span className="btn-label">Editar</span>
                      </button>
                      <button
                        className="btn-action btn-waste"
                        onClick={() => handleMoveToWaste(item)}
                        disabled={processingId === item.id}
                        title="Mover a Merma"
                      >
                        <PackageMinus size={18} />
                        <span className="btn-label">Merma</span>
                      </button>
                    </>
                  ) : (
                    <div className="card-info-text">
                      Producto general - actualiza en ficha técnica
                    </div>
                  )}
                  <button
                    className="btn-action btn-ignore"
                    onClick={() => handleIgnore(item.id)}
                    disabled={processingId === item.id}
                    title="Ignorar por 24h"
                  >
                    <EyeOff size={18} />
                    <span className="btn-label">Ignorar</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {alerts.length > 10 && (
          <div className="view-more">
            <small>
              ... y {alerts.length - 10} más.
            </small>
          </div>
        )}

        {/* Strategy Box */}
        {strategyTip && (
          <div className="strategy-box">
            <div className="strategy-icon">
              <StrategyIcon size={24} />
            </div>
            <div className="strategy-content">
              <strong>{strategyTip.title}</strong>
              <p>{strategyTip.text}</p>
            </div>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingItem && (
        <div className="mini-modal-overlay">
          <div className="mini-modal">
            <div className="modal-header">
              <CalendarCheck size={24} className="modal-icon" />
              <h4>Corregir Fecha de Vencimiento</h4>
            </div>

            <div className="modal-body">
              <div className="modal-product-info">
                <p className="modal-product-name">{editingItem.productName}</p>
                {editingItem.batchSku && (
                  <p className="modal-batch-sku">
                    <Barcode size={12} />
                    Lote: <b>{editingItem.batchSku}</b>
                  </p>
                )}
              </div>

              <div className="date-input-group">
                <label htmlFor="expiry-date-input">
                  Nueva Fecha de Vencimiento:
                </label>
                <input
                  id="expiry-date-input"
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  autoFocus
                />
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={handleSaveDate}>
                Guardar
              </button>
              <button className="btn-cancel" onClick={cancelEdit}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
