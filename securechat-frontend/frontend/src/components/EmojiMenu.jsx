import { useEffect, useRef } from 'react';

export const EMOJIS = [
  '👍', '👎', '👏', '🙏', '💪', '👌', '🤌', '✌️',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
  '😂', '🤣', '😊', '😍', '😘', '😅', '🥲', '😎',
  '😮', '😐', '😴', '🤔', '😢', '😭', '😡', '🤯',
  '😳', '🥺', '🙈', '🤝', '✊', '🎉', '🥳', '🎂',
  '🎁', '🔥', '✨', '⭐', '💯', '✅', '⚠️', '🚀',
];

export default function EmojiMenu({ onPick, onClose, label }) {
  const ref = useRef(null);

  useEffect(() => {
    const onPointerDown = (event) => { if (ref.current && !ref.current.contains(event.target)) onClose(); };
    const onKeyDown = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, [onClose]);

  return <div className="emoji-menu" ref={ref} role="menu" aria-label={label || 'Emoji picker'}>
    {EMOJIS.map((emoji) => <button key={emoji} type="button" role="menuitem" aria-label={`React with ${emoji}`} onClick={() => onPick(emoji)}>{emoji}</button>)}
  </div>;
}