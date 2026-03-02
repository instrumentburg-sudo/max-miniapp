import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { signalReady } from './bridge';
import { App } from './App';
import './styles/global.css';
import './styles/components.css';
import './styles/pages.css';

signalReady();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
