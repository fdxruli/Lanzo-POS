import {
  ArrowRight,
  CheckCircle2,
  Image,
  Link2,
  Palette,
  PackagePlus,
  RefreshCw,
  Shapes,
  Warehouse
} from 'lucide-react';
import { Link } from 'react-router-dom';
import './EcommerceProBenefitsPanel.css';

function CapabilityItem({ available, children }) {
  return (
    <li className={available ? 'is-available' : 'is-pro'}>
      <CheckCircle2 size={16} aria-hidden="true" />
      <span>{children}</span>
      <small>{available ? 'Ya disponible' : 'Con Lanzo Nube'}</small>
    </li>
  );
}

function BenefitSection({ icon: Icon, title, description, children }) {
  return (
    <article className="ecommerce-pro-benefit">
      <div className="ecommerce-pro-benefit__heading">
        <span className="ecommerce-pro-benefit__icon" aria-hidden="true">
          <Icon size={20} />
        </span>
        <h3>{title}</h3>
      </div>
      <p>{description}</p>
      <ul>{children}</ul>
    </article>
  );
}

export default function EcommerceProBenefitsPanel({ features = {}, headingRef }) {
  const publishedLimit = Number(features.maxPublishedProducts);
  const hasPublishedLimit = Number.isFinite(publishedLimit) && publishedLimit >= 0;
  const brandingAdvanced = features.brandingCustomization === 'advanced';
  const builderAdvanced = features.layoutCustomization === 'advanced';
  const deliveryAdvanced = features.deliveryPickupSettings === 'advanced';

  return (
    <div className="ecommerce-pro-benefits">
      <header className="ecommerce-pro-benefits__hero">
        <div>
          <span className="ecommerce-pro-benefits__eyebrow">LANZO NUBE · ECOMMERCE</span>
          <h2 id="ecom-nube-benefits-title" ref={headingRef} tabIndex={-1}>
            Lleva tu tienda al siguiente nivel
          </h2>
          <p>
            Descubre las herramientas avanzadas que Lanzo Nube ofrece para personalizar tu tienda,
            ampliar tu catálogo y conectar mejor tus operaciones.
          </p>
        </div>
        <span className="ecommerce-pro-benefits__badge">PRO</span>
      </header>

      <div className="ecommerce-pro-benefits__grid">
        <BenefitSection
          icon={Palette}
          title="Una tienda con identidad propia"
          description="Organiza la presentación de tu tienda con controles visuales y conserva tus cambios antes de publicarlos."
        >
          <CapabilityItem available={builderAdvanced}>Constructor visual y organización de secciones</CapabilityItem>
          <CapabilityItem available={brandingAdvanced}>Plantillas, colores de marca y tipografía</CapabilityItem>
          <CapabilityItem available={brandingAdvanced}>Portada e imágenes de la tienda</CapabilityItem>
          <CapabilityItem available={builderAdvanced}>Guardar y publicar cambios de diseño</CapabilityItem>
          <li className="ecommerce-pro-benefit__detail">
            <Shapes size={16} aria-hidden="true" />
            <span>El historial de versiones aparece cuando está habilitado para la tienda.</span>
          </li>
        </BenefitSection>

        <BenefitSection
          icon={PackagePlus}
          title="Más espacio para tus productos"
          description="Amplía la capacidad para publicar productos cuando la licencia lo autorice. El límite vigente siempre se valida desde tu plan."
        >
          <CapabilityItem available={!hasPublishedLimit}>
            Límite de publicaciones definido por la licencia
          </CapabilityItem>
          <li className="ecommerce-pro-benefit__detail">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>Puedes seguir editando o despublicando productos existentes al alcanzar el límite.</span>
          </li>
        </BenefitSection>

        <BenefitSection
          icon={RefreshCw}
          title="Mantén conectado tu catálogo"
          description="La sincronización ayuda a mantener alineados los productos locales y los publicados cuando la capacidad está habilitada."
        >
          <CapabilityItem available={features.cloudCatalogSource === true}>Sincronización automática cuando está habilitada</CapabilityItem>
          <li className="ecommerce-pro-benefit__detail">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>Vinculación con productos locales y campos compatibles.</span>
          </li>
          <li className="ecommerce-pro-benefit__detail">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>Estados para revisar cambios pendientes o productos que requieren atención.</span>
          </li>
        </BenefitSection>

        <BenefitSection
          icon={Link2}
          title="Haz que tus clientes reconozcan tu tienda"
          description="Cuida la presentación de tu marca y usa un enlace más fácil de identificar."
        >
          <CapabilityItem available={features.customSlug === true}>Personalización del slug del enlace</CapabilityItem>
          <li className="ecommerce-pro-benefit__detail">
            <Image size={16} aria-hidden="true" />
            <span>La identidad visual acompaña la presentación de la tienda.</span>
          </li>
          <li className="ecommerce-pro-benefit__detail">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>El slug modifica la dirección de la tienda; no equivale a un dominio personalizado.</span>
          </li>
        </BenefitSection>

        <BenefitSection
          icon={Warehouse}
          title="Más contexto para operar"
          description="Combina el catálogo con información útil para preparar y atender pedidos online."
        >
          <CapabilityItem available={deliveryAdvanced}>Configuración avanzada de modalidades de entrega</CapabilityItem>
          <CapabilityItem available={features.stockVisibility === true}>Opciones para mostrar el estado o la cantidad disponible</CapabilityItem>
          <CapabilityItem available={features.realtimeOrders === true}>Avisos de pedidos en tiempo real cuando están habilitados</CapabilityItem>
          <li className="ecommerce-pro-benefit__detail">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>La recepción básica de pedidos online no se presenta como exclusiva de PRO.</span>
          </li>
        </BenefitSection>
      </div>

      <section className="ecommerce-pro-benefits__cta" aria-labelledby="ecom-nube-cta-title">
        <div>
          <span className="ecommerce-pro-benefits__eyebrow">Más información</span>
          <h3 id="ecom-nube-cta-title">Conoce todo lo que puedes hacer con Lanzo Nube</h3>
          <p>Consultar esta información no modifica tu licencia ni tu plan.</p>
        </div>
        <Link className="ecommerce-pro-benefits__cta-button" to="/acerca-de">
          Conocer Lanzo Nube
          <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
