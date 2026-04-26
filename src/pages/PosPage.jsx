// src/pages/PosPage.jsx
import { usePos } from '../hooks/pos/usePos';
import PosPageContent from '../components/pos/PosPageContent';
import './PosPage.css';

/**
 * Página principal del Punto de Venta (POS).
 *
 * Arquitectura:
 * - Wrapper que consume el hook maestro usePos
 * - Delega todo el render a PosPageContent
 * - Cero lógica, cero estado, cero handlers inline
 */
export default function PosPage() {
    const pos = usePos();
    const { data, ui, actions, features } = pos;

    return (
        <PosPageContent
            data={data}
            ui={ui}
            actions={actions}
            features={features}
        />
    );
}
