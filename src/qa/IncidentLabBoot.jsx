import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import '../styles/design-tokens.css';
import '../styles/buttons.css';

import LabLoadBoundary from './LabLoadBoundary';

const Lab = lazy(() => import('../components/common/IncidentRecoveryQaGallery'));
if (import.meta.env.DEV || import.meta.env.VITE_INCIDENT_QA_PREVIEW === true) {
  createRoot(document.getElementById('root')).render(<React.StrictMode><LabLoadBoundary><Suspense fallback={<p role="status">Cargando laboratorio QA…</p>}><Lab /></Suspense></LabLoadBoundary></React.StrictMode>);
}
