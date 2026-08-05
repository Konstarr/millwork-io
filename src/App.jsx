import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import RequireAuth from './components/auth/RequireAuth.jsx';
import AppShell    from './components/layout/AppShell.jsx';

import Login          from './pages/Login.jsx';
import Signup         from './pages/Signup.jsx';
import Dashboard      from './pages/Dashboard.jsx';

import CustomersList  from './pages/customers/CustomersList.jsx';
import CustomerDetail from './pages/customers/CustomerDetail.jsx';

import ProjectsList   from './pages/projects/ProjectsList.jsx';
import ProjectDetail  from './pages/projects/ProjectDetail.jsx';

import EstimatesList  from './pages/estimates/EstimatesList.jsx';
import EstimateDetail from './pages/estimates/EstimateDetail.jsx';

import MaterialsLibrary from './pages/materials/MaterialsLibrary.jsx';
import LaborSettings    from './pages/labor/LaborSettings.jsx';

import ProductsList  from './pages/products/ProductsList.jsx';
import ProductDetail from './pages/products/ProductDetail.jsx';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login"  element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route path="/"                 element={<Dashboard />} />

          <Route path="/customers"        element={<CustomersList />} />
          <Route path="/customers/new"    element={<CustomerDetail />} />
          <Route path="/customers/:id"    element={<CustomerDetail />} />

          <Route path="/projects"         element={<ProjectsList />} />
          <Route path="/projects/new"     element={<ProjectDetail />} />
          <Route path="/projects/:id"     element={<ProjectDetail />} />

          <Route path="/estimates"        element={<EstimatesList />} />
          <Route path="/estimates/new"    element={<EstimateDetail />} />
          <Route path="/estimates/:id"    element={<EstimateDetail />} />

          <Route path="/products"         element={<ProductsList />} />
          <Route path="/products/new"     element={<ProductDetail />} />
          <Route path="/products/:id"     element={<ProductDetail />} />

          <Route path="/materials"        element={<MaterialsLibrary />} />
          <Route path="/labor"            element={<LaborSettings />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
