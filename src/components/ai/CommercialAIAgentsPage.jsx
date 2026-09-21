import { BarChart3, Globe2, ShieldCheck, Sparkles } from 'lucide-react';
import './CommercialAIAgentsPage.css';

const COMMERCIAL_AGENTS = [
  {
    key: 'salesProfitability',
    title: 'Ventas y rentabilidad',
    description: 'Explica cambios de margen, detecta productos problemáticos y ayuda a simular decisiones comerciales.',
    icon: BarChart3,
    tone: 'violet'
  },
  {
    key: 'ecommerce',
    title: 'Ecommerce',
    description: 'Analiza pedidos, catálogo, productos online y oportunidades para mejorar tu tienda.',
    icon: Globe2,
    tone: 'blue'
  }
];

export default function CommercialAIAgentsPage() {
  return (
    <main className="commercial-ai-page" aria-labelledby="commercial-ai-title">
      <header className="commercial-ai-hero">
        <div className="commercial-ai-hero__icon" aria-hidden="true">
          <Sparkles size={24} />
        </div>
        <div>
          <p className="commercial-ai-eyebrow">Centro de agentes IA</p>
          <h1 id="commercial-ai-title">Agentes IA comerciales</h1>
          <p className="commercial-ai-intro">
            Una fundación segura para entender el negocio y preparar mejores decisiones comerciales.
          </p>
        </div>
      </header>

      <section className="commercial-ai-card-grid" aria-label="Agentes IA comerciales disponibles">
        {COMMERCIAL_AGENTS.map(({ key, title, description, icon: Icon, tone }) => (
          <article className={`commercial-ai-card commercial-ai-card--${tone}`} key={key}>
            <div className="commercial-ai-card__topline">
              <span className="commercial-ai-card__icon" aria-hidden="true">
                <Icon size={22} />
              </span>
              <span className="commercial-ai-status">Fundación preparada</span>
            </div>
            <h2>{title}</h2>
            <p>{description}</p>
            <div className="commercial-ai-card__availability">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>Las capacidades estarán disponibles en la siguiente fase.</span>
            </div>
          </article>
        ))}
      </section>

      <aside className="commercial-ai-notice" role="note">
        <ShieldCheck size={18} aria-hidden="true" />
        <p>
          En esta fase no se ejecutan análisis, no se envían prompts a proveedores y abrir este centro no reserva ni consume cuota.
        </p>
      </aside>
    </main>
  );
}
