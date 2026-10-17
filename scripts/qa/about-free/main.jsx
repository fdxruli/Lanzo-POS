import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import AboutPage from '../../../src/pages/AboutPage';
import Navbar from '../../../src/components/layout/Navbar';
import '../../../src/index.css';
import '../../../src/components/layout/Layout.css';

// Real AboutPage and Navbar/CSS, synthetic local state. Layout's operational
// runtimes are deliberately not mounted in this visual-only harness.
const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/acerca-de']}>
    <div className="app-layout">
      <Navbar />
      <div className="content-wrapper"><div className="page-container"><AboutPage /></div></div>
    </div>
  </MemoryRouter>
);
