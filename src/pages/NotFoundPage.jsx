import { ArrowLeft, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import NotFoundBarcode from '../components/common/NotFoundBarcode';
import './NotFoundPage.css';

const hasSafeInAppHistory = () => {
  if (typeof window === 'undefined') return false;

  const historyIndex = window.history.state?.idx;
  return Number.isInteger(historyIndex) && historyIndex > 0;
};

function NotFoundPage() {
  const navigate = useNavigate();

  const handleGoBack = () => {
    if (hasSafeInAppHistory()) {
      navigate(-1);
      return;
    }

    navigate('/');
  };

  return (
    <main className="not-found-page">
      <section className="not-found-page__layout" aria-labelledby="not-found-title">
        <div className="not-found-page__visual" aria-label="Error 404">
          <div className="not-found-page__eyebrow">
            <p className="not-found-page__code">404</p>
            <span>RUTA NO ENCONTRADA</span>
          </div>
          <NotFoundBarcode />
        </div>

        <div className="not-found-page__content">
          <h1 id="not-found-title">Parece que esta página no existe</h1>
          <p className="not-found-page__description">
            La dirección que intentaste abrir no está disponible. Puede que el enlace esté incompleto o que la página haya cambiado.
          </p>

          <div className="not-found-page__actions">
            <button
              type="button"
              className="btn btn-primary not-found-page__action"
              onClick={() => navigate('/')}
            >
              <Home size={18} aria-hidden="true" />
              Volver al inicio
            </button>
            <button
              type="button"
              className="btn btn-secondary not-found-page__action"
              onClick={handleGoBack}
            >
              <ArrowLeft size={18} aria-hidden="true" />
              Volver atrás
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

export default NotFoundPage;
