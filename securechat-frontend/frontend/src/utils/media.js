export const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');

export function mediaUrl(value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) return value;
  return `${API_ORIGIN}${value.startsWith('/') ? '' : '/'}${value}`;
}
