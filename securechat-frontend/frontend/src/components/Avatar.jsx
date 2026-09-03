import { useEffect, useState } from 'react';
import api from '../api/client';
import { mediaUrl } from '../utils/media';
import { UserRound } from 'lucide-react';

export default function Avatar({ user, size = 'md', hidden = false, label }) {
  const source = !hidden ? user?.avatarUrl : null;
  const [src, setSrc] = useState(null);
  const name = user?.name || user?.username || 'User';

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    setSrc(null);
    if (!source) return undefined;

    // SecureChat-owned avatar endpoints require the authenticated bearer token.
    // Fetching as a Blob avoids exposing the stored file through a public URL.
    if (source.startsWith('/users/') && source.endsWith('/avatar')) {
      api.get(source, { responseType: 'blob' }).then(({ data }) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(data);
        setSrc(objectUrl);
      }).catch(() => { if (!cancelled) setSrc(null); });
    } else {
      // Backward-compatible rendering for an explicitly supplied external/data URL.
      setSrc(mediaUrl(source));
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);

  if (!src) {
    return <span className={`avatar avatar-${size} placeholder-avatar`} role="img" aria-label={label || `${name} profile photo unavailable or private`}><UserRound aria-hidden="true" /></span>;
  }
  return <img className={`avatar avatar-${size}`} src={src} alt={`${name} profile`} loading="lazy" referrerPolicy="no-referrer" />;
}
