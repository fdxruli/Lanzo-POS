import React, { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { getDocumentInstanceCoordinator } from '../../../src/services/instance/instanceCoordinator';
const stats = window.strictStats = { setup: 0, cleanup: 0 };
function View() {
  useEffect(() => {
    stats.setup++;
    const service = getDocumentInstanceCoordinator();
    void service.start();
    const unsubscribe = service.subscribe(() => {});
    return () => { stats.cleanup++; unsubscribe(); };
  }, []);
  return <p>Coordination laboratory</p>;
}
const root = createRoot(document.getElementById('root'));
root.render(<StrictMode><View /></StrictMode>);
window.unmountStrict = () => root.unmount();
