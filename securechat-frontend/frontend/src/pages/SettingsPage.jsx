import { Link } from 'react-router-dom';
import { Accessibility, Bell, Database, Settings2, ShieldCheck, UserRound } from 'lucide-react';

const ITEMS = [
  [UserRound, 'Profile & account', 'Update your display name and privacy-aware profile photo.', '/profile'],
  [ShieldCheck, 'Privacy & security', 'Control discovery, presence, receipts, retention and blocked contacts.', '/privacy#privacy-security'],
  [Bell, 'Notifications', 'Choose permission and how much appears in message previews.', '/privacy#notifications'],
  [Accessibility, 'Accessibility', 'Adjust text size, contrast, motion and appearance.', '/privacy#accessibility'],
  [Database, 'Your data & account', 'Review, export or permanently delete your data.', '/data-control'],
];

export default function SettingsPage() {
  return <div className="page-shell settings-hub"><div className="page-heading"><div><span className="eyebrow">One predictable control center</span><h1>Settings</h1><p>Find important controls by task instead of remembering where each option lives.</p></div><Settings2 aria-hidden="true" /></div><div className="settings-hub-grid">{ITEMS.map(([Icon,title,text,to]) => <Link className="settings-hub-card" to={to} key={title}><span aria-hidden="true"><Icon /></span><div><h2>{title}</h2><p>{text}</p></div><b aria-hidden="true">›</b></Link>)}</div><section className="panel"><div className="section-title"><div><h2>Need guidance?</h2><p>Help, app information and feedback are kept together.</p></div></div><div className="action-row wrap"><Link className="secondary-button" to="/help">Help center</Link><Link className="secondary-button" to="/feedback">Report a problem</Link><Link className="secondary-button" to="/about">About SecureChat</Link></div></section></div>;
}
