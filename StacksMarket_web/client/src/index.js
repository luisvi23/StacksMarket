import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { Toaster } from 'react-hot-toast';
import './index.css';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';

// Ignore known wallet extension noise (e.g. MetaMask) that can break dev overlay
// while this app only supports Leather/Xverse flows.
const shouldIgnoreExtensionWalletError = (message = '', source = '') => {
  const msg = String(message || '').toLowerCase();
  const src = String(source || '').toLowerCase();
  return (
    msg.includes('failed to connect to metamask') ||
    msg.includes('metamask extension not found') ||
    msg.includes('could not establish connection. receiving end does not exist') ||
    src.includes('chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn')
  );
};

window.onerror = (message, source) => {
  if (shouldIgnoreExtensionWalletError(message, source)) {
    return true;
  }
  return false;
};

window.onunhandledrejection = (event) => {
  const reasonMessage = event?.reason?.message || event?.reason || '';
  if (shouldIgnoreExtensionWalletError(reasonMessage, '')) {
    event.preventDefault();
    event.stopImmediatePropagation?.();
    return true;
  }
  return false;
};

window.addEventListener(
  'error',
  (event) => {
    if (shouldIgnoreExtensionWalletError(event?.message, event?.filename)) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
    }
  },
  true
);

window.addEventListener(
  'unhandledrejection',
  (event) => {
    const reasonMessage = event?.reason?.message || event?.reason || '';
    if (shouldIgnoreExtensionWalletError(reasonMessage, '')) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
    }
  },
  true
);

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <App />
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#363636',
                  color: '#fff',
                },
                success: {
                  duration: 3000,
                  iconTheme: {
                    primary: '#22c55e',
                    secondary: '#fff',
                  },
                },
                error: {
                  duration: 5000,
                  iconTheme: {
                    primary: '#ef4444',
                    secondary: '#fff',
                  },
                },
              }}
            />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
