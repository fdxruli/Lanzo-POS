import NoPermission from '../common/NoPermission';
import ProFeatureShowcase from '../plans/ProFeatureShowcase';
import { useAppStore } from '../../store/useAppStore';
import { getCommercialAIAgentAccessState } from '../../services/auth/aiAgentAuthorization';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';
import {
  BarChart3,
  ChartNoAxesCombined,
  PackageSearch,
  Scale
} from 'lucide-react';

const AI_SHOWCASE_FEATURES = [
  {
    title: 'Ventas y rentabilidad',
    description: 'Revisa ventas, márgenes, cambios recientes y productos que pueden requerir atención con los datos disponibles.',
    icon: <BarChart3 size={19} />
  },
  {
    title: 'Surtido y productos',
    description: 'Explora la actividad de tu catálogo y oportunidades para revisar o reactivar productos actuales.',
    icon: <PackageSearch size={19} />
  },
  {
    title: 'Estrategia y simulaciones',
    description: 'Compara periodos y explora metas, ticket promedio, precios, promociones y combos antes de decidir.',
    icon: <ChartNoAxesCombined size={19} />
  },
  {
    title: 'Contexto competitivo',
    description: 'Compara productos y precios con observaciones que tú agregas; Lanzo no busca competidores en Internet.',
    icon: <Scale size={19} />
  }
];

const AI_SHOWCASE_BENEFITS = [
  'Los análisis usan la información disponible de ventas, catálogo y costos registrados.',
  'Las simulaciones ayudan a explorar escenarios y no modifican tus precios ni productos.',
  'Las comparaciones competitivas se basan en observaciones que comparte tu negocio.'
];

export default function CommercialAIAgentsRoute({ children }) {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const actorSnapshot = useActorRuntimeSnapshot();
  const access = getCommercialAIAgentAccessState({ licenseDetails, actorSnapshot });

  if (!access.canSeeEntry) return <NoPermission />;
  if (!access.canEnter) {
    return (
      <ProFeatureShowcase
        variant="page"
        eyebrow="Agentes IA · Lanzo Nube"
        badge="PRO"
        title="Agentes IA de Lanzo"
        description="Convierte los datos de tu negocio en decisiones. Lanzo calcula con la información registrada y Lía te ayuda a interpretar ventas, rentabilidad y escenarios comerciales."
        features={AI_SHOWCASE_FEATURES}
        benefits={AI_SHOWCASE_BENEFITS}
        offerTitle="Explora Agentes IA con Lanzo Nube"
        offerDescription="Lanzo Nube reúne análisis con IA, sincronización en la nube y herramientas para trabajar en equipo, según las capacidades de tu licencia."
        ctaLabel="Conocer Lanzo Nube"
        ctaTo="/acerca-de"
        secondaryText="Este enlace muestra información; no cambia tu plan ni tu licencia."
      />
    );
  }

  return children;
}
