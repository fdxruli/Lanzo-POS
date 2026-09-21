import NoPermission from '../common/NoPermission';
import { useAppStore } from '../../store/useAppStore';
import { getCommercialAIAgentAccessState } from '../../services/auth/aiAgentAuthorization';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';

const AvailabilityMessage = ({ message }) => (
  <main className="commercial-ai-page" aria-labelledby="commercial-ai-unavailable-title">
    <section className="ui-card" style={{ maxWidth: '680px', margin: '2rem auto', padding: '2rem' }}>
      <p className="commercial-ai-eyebrow">Centro de agentes IA</p>
      <h1 id="commercial-ai-unavailable-title">Agentes IA comerciales</h1>
      <p>{message}</p>
    </section>
  </main>
);

export default function CommercialAIAgentsRoute({ children }) {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const actorSnapshot = useActorRuntimeSnapshot();
  const access = getCommercialAIAgentAccessState({ licenseDetails, actorSnapshot });

  if (!access.canSeeEntry) return <NoPermission />;
  if (!access.canEnter) return <AvailabilityMessage message={access.message} />;

  return children;
}
