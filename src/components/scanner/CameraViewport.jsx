// src/components/scanner/CameraViewport.jsx
import React from 'react';

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
          filter: isScanning ? 'none' : 'brightness(0.5) blur(2px)',
          transition: 'filter 0.3s ease',
        }}
      />

      {scanFeedback && (
        <div className="scan-feedback-overlay">
          <div className="scan-feedback-message">{scanFeedback}</div>
        </div>
      )}

      <div
        className="scanner-reticle"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '70%',
          height: '40%',
          border: '3px solid rgba(0, 255, 0, 0.5)',
          borderRadius: '12px',
          pointerEvents: 'none',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.3)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            bottom: '-30px',
            left: '50%',
            transform: 'translateX(-50%)',
            color: 'white',
            fontSize: '0.9rem',
            textShadow: '0 2px 4px rgba(0,0,0,0.8)',
            whiteSpace: 'nowrap',
          }}
        >
          {isConfirming
            ? 'Guardando carrito temporal...'
            : isScanning
              ? 'Centra el codigo aqui'
              : 'Procesando...'}
        </div>
      </div>
    </>
  );
}
