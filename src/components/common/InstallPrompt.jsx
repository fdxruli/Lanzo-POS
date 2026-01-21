import React, { useState, useEffect } from 'react';
import { Download, Share, PlusSquare, X } from 'lucide-react'; // Asegúrate de tener lucide-react instalado

const InstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIosPrompt, setShowIosPrompt] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // 1. Lógica para ANDROID / PC (Chrome/Edge)
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault(); // Evita que el navegador muestre su aviso feo/tímido
      setDeferredPrompt(e); // Guarda el evento para dispararlo cuando quieras
      setIsVisible(true);   // Muestra tu botón bonito
    };

    // 2. Lógica para iOS (iPhone/iPad)
    // iOS no tiene evento de instalación, hay que detectar el User Agent
    const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true; // Si ya está instalada

    if (isIos && !isStandalone) {
      // Opcional: Mostrar aviso solo la primera vez usando localStorage
      // if (!localStorage.getItem('iosPromptSeen')) { 
         setShowIosPrompt(true);
      // }
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    // Muestra el prompt nativo del sistema
    deferredPrompt.prompt();

    // Espera a que el usuario decida
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setIsVisible(false); // Si aceptó, ocultamos el botón
    }
    setDeferredPrompt(null);
  };

  const closeIosPrompt = () => {
    setShowIosPrompt(false);
    // localStorage.setItem('iosPromptSeen', 'true'); // Descomentar para recordar
  };

  // --- RENDERIZADO ---

  // A) Caso ANDROID / PC
  if (isVisible && deferredPrompt) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 bg-slate-900 text-white p-4 rounded-xl shadow-2xl flex items-center justify-between border border-slate-700 animate-in fade-in slide-in-from-bottom-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary/20 p-2 rounded-lg">
            <Download className="w-6 h-6 text-primary-400" />
          </div>
          <div>
            <p className="font-bold text-sm">Instalar Lanzo POS</p>
            <p className="text-xs text-slate-400">Accede más rápido y sin internet</p>
          </div>
        </div>
        <button 
          onClick={handleInstallClick}
          className="bg-[#FF3B5C] hover:bg-[#ff1f45] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
        >
          Instalar
        </button>
      </div>
    );
  }

  // B) Caso iOS (Instrucciones manuales)
  if (showIosPrompt) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] pb-safe">
        <button 
          onClick={closeIosPrompt}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
        >
          <X className="w-5 h-5" />
        </button>
        
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
             <img src="/pwa-192x192.png" alt="Icono" className="w-12 h-12 rounded-xl shadow-sm" />
             <div>
               <h3 className="font-bold text-lg dark:text-white">Instalar en iPhone</h3>
               <p className="text-slate-500 text-sm">Agrega la App a tu inicio para una mejor experiencia.</p>
             </div>
          </div>

          <div className="flex flex-col gap-3 text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl">
             <div className="flex items-center gap-3">
                <Share className="w-5 h-5 text-blue-500" />
                <span>1. Toca el botón <b>Compartir</b> en la barra inferior.</span>
             </div>
             <div className="bg-slate-200 dark:bg-slate-700 h-px w-full"></div>
             <div className="flex items-center gap-3">
                <PlusSquare className="w-5 h-5 text-slate-500" />
                <span>2. Busca y selecciona <b>"Agregar al inicio"</b>.</span>
             </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default InstallPrompt;