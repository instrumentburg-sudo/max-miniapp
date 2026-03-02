import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { getWebApp } from './bridge';
import { Home } from './pages/Home';
import { OrderStatus } from './pages/OrderStatus';
import { Catalog } from './pages/Catalog';
import { CatalogCategory } from './pages/CatalogCategory';
import { RepairRequest } from './pages/RepairRequest';

function BackButtonManager() {
  const navigate = useNavigate();
  const location = useLocation();
  const webapp = getWebApp();

  useEffect(() => {
    if (!webapp) return;

    const isHome = location.pathname === '/';

    if (isHome) {
      webapp.BackButton.hide();
    } else {
      webapp.BackButton.show();
    }

    const handleBack = () => {
      navigate(-1);
    };

    webapp.BackButton.onClick(handleBack);
    return () => {
      webapp.BackButton.offClick(handleBack);
    };
  }, [location.pathname, navigate, webapp]);

  return null;
}

export function App() {
  return (
    <HashRouter>
      <BackButtonManager />
      <div className="app">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/order" element={<OrderStatus />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/catalog/:categoryId" element={<CatalogCategory />} />
          <Route path="/repair" element={<RepairRequest />} />
        </Routes>
      </div>
    </HashRouter>
  );
}
