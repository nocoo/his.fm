import type { ReactNode } from 'react';

function observeReveal(node: HTMLDivElement | null) {
  if (!node) return;
  const element = node;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (preference.matches) {
    element.dataset.revealed = '';
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) reveal();
    },
    { rootMargin: '-40px' },
  );
  function cleanup() {
    observer.disconnect();
    preference.removeEventListener('change', preferenceChanged);
    element.removeEventListener('focusin', reveal);
  }
  function reveal() {
    element.dataset.revealed = '';
    cleanup();
  }
  function preferenceChanged() {
    if (preference.matches) reveal();
  }
  observer.observe(element);
  preference.addEventListener('change', preferenceChanged);
  element.addEventListener('focusin', reveal);
  return cleanup;
}

export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div ref={observeReveal} className={`public-reveal ${className}`}>
      {children}
    </div>
  );
}
