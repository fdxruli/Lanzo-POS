// src/components/scanner/CameraViewport.jsx
import React from 'react';

/**
 * Icono de menos/menos (stroke-width: 2, fill: none)
 */
const MinusIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="scanner-icon"
    aria-hidden="true"
  >
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

/**
 * Icono de trash/basura (stroke-width: 2, fill: none)
 */
const TrashIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="scanner-icon"
    aria-hidden="true"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

/**
 * Icono de check/éxito (stroke-width: 2, fill: none)
 */
const CheckIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="scanner-icon"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/**
 * Icono de alerta/error (stroke-width: 2, fill: none)
 */
const AlertIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="scanner-icon"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

/**
 * Componente de Retícula de Escaneo (SVG Corners + Láser)
 * Reemplaza el hack de box-shadow con un enfoque de bajo impacto
 */
const ScannerReticle = ({ isScanning, isConfirming }) => {
  const cornerSize = 24;
  const strokeWidth = 3;

  return (
    <div className="scanner-reticle">
      {/* Esquina superior izquierda */}
      <svg
        className="reticle-corner reticle-corner-tl"
        viewBox={`0 0 ${cornerSize} ${cornerSize}`}
        style={{ position: 'absolute', top: 0, left: 0, width: cornerSize, height: cornerSize }}
      >
        <path
          d={`M 0 ${cornerSize} L 0 0 L ${cornerSize} 0`}
          fill="none"
          stroke="var(--success-color, #28a745)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Esquina superior derecha */}
      <svg
        className="reticle-corner reticle-corner-tr"
        viewBox={`0 0 ${cornerSize} ${cornerSize}`}
        style={{ position: 'absolute', top: 0, right: 0, width: cornerSize, height: cornerSize }}
      >
        <path
          d={`M 0 0 L ${cornerSize} 0 L ${cornerSize} ${cornerSize}`}
          fill="none"
          stroke="var(--success-color, #28a745)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Esquina inferior izquierda */}
      <svg
        className="reticle-corner reticle-corner-bl"
        viewBox={`0 0 ${cornerSize} ${cornerSize}`}
        style={{ position: 'absolute', bottom: 0, left: 0, width: cornerSize, height: cornerSize }}
      >
        <path
          d={`M 0 0 L 0 ${cornerSize} L ${cornerSize} ${cornerSize}`}
          fill="none"
          stroke="var(--success-color, #28a745)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Esquina inferior derecha */}
      <svg
        className="reticle-corner reticle-corner-br"
        viewBox={`0 0 ${cornerSize} ${cornerSize}`}
        style={{ position: 'absolute', bottom: 0, right: 0, width: cornerSize, height: cornerSize }}
      >
        <path
          d={`M ${cornerSize} 0 L ${cornerSize} ${cornerSize} L 0 ${cornerSize}`}
          fill="none"
          stroke="var(--success-color, #28a745)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Línea láser animada - translateY para aceleración por hardware */}
      <div
        className={`scanner-laser ${isScanning && !isConfirming ? 'scanning' : ''}`}
        aria-hidden="true"
      />

      {/* Texto de estado */}
      <div className="scanner-status-text">
        {isConfirming
          ? 'Guardando carrito temporal...'
          : isScanning
            ? 'Centra el codigo aqui'
            : 'Procesando...'}
      </div>
    </div>
  );
};

/**
 * Componente de Toast Feedback
 * Reemplaza el overlay invasivo con una píldora flotante no invasiva
 */
const ScanFeedbackToast = ({ message }) => {
  if (!message) return null;

  // Detectar tipo de mensaje basado en contenido
  const isError = message.toLowerCase().includes('falló') ||
                  message.toLowerCase().includes('error') ||
                  message.toLowerCase().includes('no se');
  const isSearching = message.toLowerCase().includes('buscando');

  let toastClass = 'scan-toast';
  if (isError) toastClass += ' scan-toast-error';
  else if (isSearching) toastClass += ' scan-toast-info';
  else toastClass += ' scan-toast-success';

  return (
    <div className={toastClass} role="status" aria-live="polite">
      <span className="scan-toast-icon">
        {isError ? <AlertIcon /> : <CheckIcon />}
      </span>
      <span className="scan-toast-message">{message}</span>
    </div>
  );
};

export function CameraViewport({
  videoRef,
  cameraError,
  scanFeedback,
  isScanning,
  isConfirming,
  onRetryCamera,
}) {
  if (cameraError) {
    return (
      <div className="camera-error-feedback">
        <div className="camera-error-icon">
          <AlertIcon />
        </div>
        <p>{cameraError}</p>
        <button
          onClick={onRetryCamera}
          className="btn btn-secondary"
          disabled={isConfirming}
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <>
      <video
        ref={videoRef}
        id="scanner-video"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          filter: isScanning ? 'none' : 'brightness(0.6)',
          transition: 'filter 0.2s ease',
        }}
      />

      {/* Toast de feedback no invasivo */}
      <ScanFeedbackToast message={scanFeedback} />

      {/* Retícula moderna con corners SVG y láser animado */}
      <ScannerReticle isScanning={isScanning} isConfirming={isConfirming} />
    </>
  );
}

// Exportar iconos para reuso en ScannerCartList
export { MinusIcon, TrashIcon, CheckIcon, AlertIcon };
