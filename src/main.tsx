import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Register service worker for PWA support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        console.log('Service Worker registered:', registration);
        
        // If there's a waiting worker, activate it immediately
        if (registration.waiting) {
          registration.waiting.postMessage('SKIP_WAITING');
        }
        
        // Handle updates
        registration.addEventListener('updatefound', () => {
          const sw = registration.installing;
          if (!sw) return;
          
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              // New version ready; reload to get fresh content
              console.log('New service worker installed, reloading...');
              location.reload();
            }
          });
        });
      })
      .catch((error) => {
        console.log('Service Worker registration failed:', error);
      });
  });

  // Listen for messages from service worker
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SW_ACTIVE') {
      console.log('Service Worker active, version:', event.data.version);
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);
