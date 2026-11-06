// Isolated component harness. smoke.py replaces identity/stores with explicit fixtures.
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import AssistantBot from '../../../src/components/common/AssistantBot';
import '../../../src/index.css';
import '../../../src/styles/design-tokens.css';
import '../../../src/styles/buttons.css';
function Fixture() {
  const location = useLocation(); const navigate = useNavigate();
  return <><p>Prueba aislada de Lanzó Bot · sin datos reales</p><p id="qa-path">{location.pathname + location.search}</p><button onClick={() => navigate('/clientes?tab=add')}>Cambiar a Clientes</button><AssistantBot /></>;
}
createRoot(document.getElementById('root')).render(<MemoryRouter><Fixture /></MemoryRouter>);
