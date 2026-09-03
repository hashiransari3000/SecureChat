import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ChatPage from './pages/ChatPage';
import PrivacyDashboardPage from './pages/PrivacyDashboardPage';
import ProfilePage from './pages/ProfilePage';
import DataTransparencyPage from './pages/DataTransparencyPage';
import DataControlPage from './pages/DataControlPage';
import DesignEthicsPage from './pages/DesignEthicsPage';
import NotFoundPage from './pages/NotFoundPage';
import SettingsPage from './pages/SettingsPage';
import HelpCenterPage from './pages/HelpCenterPage';
import FeedbackPage from './pages/FeedbackPage';
import AboutPage from './pages/AboutPage';
import './App.css';

export default function App() {
  return <AuthProvider><BrowserRouter><Routes>
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
      <Route path="/design-ethics" element={<DesignEthicsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/help" element={<HelpCenterPage />} />
      <Route path="/feedback" element={<FeedbackPage />} />
      <Route path="/about" element={<AboutPage />} />
    </Route>
    <Route path="*" element={<NotFoundPage />} />
  </Routes></BrowserRouter></AuthProvider>;
}
