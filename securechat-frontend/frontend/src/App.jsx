import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import AppLayout from './components/AppLayout';
import './App.css';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const PrivacyDashboardPage = lazy(() => import('./pages/PrivacyDashboardPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const DataTransparencyPage = lazy(() => import('./pages/DataTransparencyPage'));
const DataControlPage = lazy(() => import('./pages/DataControlPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const HelpCenterPage = lazy(() => import('./pages/HelpCenterPage'));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));

function RouteFallback() {
  return <div className="page-loading" role="status" aria-live="polite"><span className="spinner" /> Loading…</div>;
}

export default function App() {
  return <AuthProvider><BrowserRouter><Suspense fallback={<RouteFallback />}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/signup" element={<SignupPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route element={<AppLayout />}>
      <Route path="/" element={<ChatPage />} />
      <Route path="/privacy" element={<PrivacyDashboardPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/your-data" element={<DataTransparencyPage />} />
      <Route path="/data-control" element={<DataControlPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/help" element={<HelpCenterPage />} />
      <Route path="/feedback" element={<FeedbackPage />} />
      <Route path="/about" element={<AboutPage />} />
    </Route>
    <Route path="*" element={<NotFoundPage />} />
  </Routes></Suspense></BrowserRouter></AuthProvider>;
}