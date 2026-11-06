// Isolated component harness. smoke.py replaces identity/stores with explicit fixtures.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import AssistantBot from '../../../src/components/common/AssistantBot';
import '../../../src/index.css';
import '../../../src/styles/design-tokens.css';
import '../../../src/styles/buttons.css';
function Fixture() {
  const [enabled, setEnabled] = useState(!window.location.search.includes('disabled=1'));
  const [actor, setActor] = useState(1);
  useEffect(() => {
    window.changeTestActor = () => { window.actorGeneration = actor + 1; setActor(actor + 1); };
    return () => { delete window.changeTestActor; };
  }, [actor]);
  const location = useLocation(); const navigate = useNavigate();
  useEffect(() => { window.navigateTest = path => navigate(path); return () => { delete window.navigateTest; }; }, [navigate]);
  return <><p>Prueba aislada de Lanzó Bot · sin datos reales</p><p id="qa-path">{location.pathname + location.search}</p><button onClick={() => navigate('/clientes?tab=add')}>Cambiar a Clientes</button><button id="toggle-bot" onClick={() => setEnabled(value => !value)}>{enabled ? 'Desactivar bot' : 'Activar bot'}</button>{enabled && <AssistantBot />}</>;
}
createRoot(document.getElementById('root')).render(<MemoryRouter><Fixture /></MemoryRouter>);
