import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, Component, type ReactNode } from 'react';
import { getWebApp, signalReady } from './bridge';
import { Home } from './pages/Home';
import { OrderStatus } from './pages/OrderStatus';
import { LinkAccount } from './pages/LinkAccount';
import { MyOrders } from './pages/MyOrders';
import { RepairRequest } from './pages/RepairRequest';
import { OrderCard } from './pages/OrderCard';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="crash">
          <div className="crash__title">Сбой</div>
          <p className="crash__text">Не удалось загрузить приложение. Закройте и откройте его заново.</p>
          <pre className="crash__trace">{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function BackButtonManager() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    try {
      const webapp = getWebApp();
      if (!webapp?.BackButton) return;

      const isHome = location.pathname === '/';

      if (isHome) {
        webapp.BackButton.hide();
      } else {
        webapp.BackButton.show();
      }

      const handleBack = () => navigate(-1);
      webapp.BackButton.onClick(handleBack);
      return () => {
        try { webapp.BackButton.offClick(handleBack); } catch {}
      };
    } catch (e) {
      console.warn('[BackButton]', e);
    }
  }, [location.pathname, navigate]);

  return null;
}

export function App() {
  useEffect(() => {
    try { signalReady(); } catch (e) { console.warn('[signalReady]', e); }
  }, []);

  return (
    <ErrorBoundary>
      <BrowserRouter basename="/max-app">
        <BackButtonManager />
        <div className="app">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/order" element={<OrderStatus />} />
            <Route path="/link" element={<LinkAccount />} />
            <Route path="/orders" element={<MyOrders />} />
            <Route path="/orders/:number" element={<OrderCard />} />
            <Route path="/repair" element={<RepairRequest />} />
          </Routes>
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
