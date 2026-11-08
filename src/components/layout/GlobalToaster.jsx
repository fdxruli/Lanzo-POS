import { Toaster } from 'react-hot-toast';

const GlobalToaster = () => (
  <Toaster
    position="top-center"
    containerStyle={{
      zIndex: 'var(--z-toast)',
      top: 'max(20px, env(safe-area-inset-top, 0px))'
    }}
    toastOptions={{
      style: {
        background: '#333',
        color: '#fff',
        borderRadius: '8px',
        fontSize: '1rem'
      },
      success: {
        style: { background: 'var(--success-color)', color: 'white' },
        iconTheme: { primary: 'white', secondary: 'var(--success-color)' }
      },
      error: {
        style: { background: 'var(--error-color)', color: 'white' },
        iconTheme: { primary: 'white', secondary: 'var(--error-color)' }
      }
    }}
  />
);

export default GlobalToaster;
