import { useId } from 'react';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import './ProFeatureShowcase.css';

export default function ProFeatureShowcase({
  variant = 'page',
  eyebrow = 'Lanzo Nube',
  badge = 'PRO',
  title,
  description,
  features = [],
  benefits = [],
  benefitsTitle = 'Diseñado para ayudarte a decidir',
  offerEyebrow = 'Disponible con Lanzo Nube',
  offerTitle = 'Conoce las capacidades de Lanzo Nube',
  offerDescription,
  ctaLabel = 'Conocer Lanzo Nube',
  ctaTo = '/acerca-de',
  secondaryText,
  children,
  className = ''
}) {
  const id = useId();
  const isPage = variant !== 'card';
  const Surface = isPage ? 'main' : 'section';
  const Title = isPage ? 'h1' : 'h2';
  const titleId = `pro-feature-showcase-title-${id}`;
  const featuresId = `pro-feature-showcase-features-${id}`;
  const benefitsId = `pro-feature-showcase-benefits-${id}`;
  const offerId = `pro-feature-showcase-offer-${id}`;

  return (
    <Surface
      className={`pro-feature-showcase pro-feature-showcase--${isPage ? 'page' : 'card'} ${className}`.trim()}
      aria-labelledby={titleId}
    >
      <header className="pro-feature-showcase__hero">
        <span className="pro-feature-showcase__hero-icon" aria-hidden="true">
          <Sparkles size={24} />
        </span>
        <div className="pro-feature-showcase__hero-copy">
          <div className="pro-feature-showcase__eyebrow-row">
            {eyebrow && <p className="pro-feature-showcase__eyebrow">{eyebrow}</p>}
            {badge && <span className="pro-feature-showcase__badge">{badge}</span>}
          </div>
          <Title id={titleId}>{title}</Title>
          {description && <p className="pro-feature-showcase__description">{description}</p>}
        </div>
      </header>

      {features.length > 0 && (
        <section className="pro-feature-showcase__section" aria-labelledby={featuresId}>
          <h2 id={featuresId} className="pro-feature-showcase__section-title">Lo que puedes explorar</h2>
          <div className="pro-feature-showcase__grid">
            {features.map(({ title: featureTitle, description: featureDescription, icon }) => (
              <article className="pro-feature-showcase__feature" key={featureTitle}>
                {icon && (
                  <span className="pro-feature-showcase__feature-icon" aria-hidden="true">
                    {icon}
                  </span>
                )}
                <h3>{featureTitle}</h3>
                <p>{featureDescription}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {benefits.length > 0 && (
        <section className="pro-feature-showcase__benefits" aria-labelledby={benefitsId}>
          <h2 id={benefitsId} className="pro-feature-showcase__section-title">{benefitsTitle}</h2>
          <ul>
            {benefits.map((benefit) => (
              <li key={benefit}>
                <Check size={17} aria-hidden="true" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {children && <div className="pro-feature-showcase__content">{children}</div>}

      <section className="pro-feature-showcase__offer" aria-labelledby={offerId}>
        <div className="pro-feature-showcase__offer-copy">
          {offerEyebrow && <p className="pro-feature-showcase__offer-eyebrow">{offerEyebrow}</p>}
          <h2 id={offerId}>{offerTitle}</h2>
          {offerDescription && <p>{offerDescription}</p>}
        </div>
        <div className="pro-feature-showcase__actions">
          <Link className="pro-feature-showcase__cta" to={ctaTo}>
            {ctaLabel}
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
          {secondaryText && <p className="pro-feature-showcase__secondary">{secondaryText}</p>}
        </div>
      </section>
    </Surface>
  );
}
