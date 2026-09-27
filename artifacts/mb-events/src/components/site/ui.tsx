import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

export function Label({ children }: { children: ReactNode }) {
  return <label className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-muted)]">{children}</label>;
}

export function Field({
  label,
  value,
  onChange,
  testId,
  type = 'text',
  required = false,
  placeholder = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input
        data-testid={testId}
        required={required}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2 h-12 w-full border border-[var(--mb-line-strong)] bg-[var(--mb-ink)]/40 px-4 text-sm text-[var(--mb-ivory)] outline-none placeholder:text-[var(--mb-muted)] focus:border-[var(--mb-champagne)] focus:ring-1 focus:ring-[var(--mb-champagne)]"
      />
    </label>
  );
}

export function Button({
  children,
  onClick,
  variant = 'dark',
  type = 'button',
  className = '',
  testId,
  showArrow = true,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'dark' | 'red' | 'light' | 'outline' | 'ghost';
  type?: 'button' | 'submit';
  className?: string;
  testId: string;
  showArrow?: boolean;
  disabled?: boolean;
}) {
  const variants = {
    dark: 'bg-[var(--mb-ivory)] text-[var(--mb-ink)] hover:bg-[var(--mb-champagne)] focus-visible:ring-[var(--mb-champagne)]',
    red: 'bg-[var(--mb-champagne)] text-[var(--mb-ink)] hover:bg-[var(--mb-ivory)] focus-visible:ring-[var(--mb-champagne)]',
    light: 'bg-[var(--mb-champagne)] text-[var(--mb-ink)] hover:bg-[var(--mb-ivory)]',
    outline: 'border border-[var(--mb-ivory)]/45 text-[var(--mb-ivory)] hover:border-[var(--mb-champagne)] hover:text-[var(--mb-champagne)]',
    ghost: 'border border-[var(--mb-line-strong)] text-[var(--mb-ivory)] hover:border-[var(--mb-champagne)] hover:text-[var(--mb-champagne)]',
  } as const;

  return (
    <motion.button
      data-testid={testId}
      type={type}
      disabled={disabled}
      onClick={onClick}
      whileHover={disabled ? undefined : { y: -2, scale: 1.03 }}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 420, damping: 17, mass: 0.8 }}
      className={`group inline-flex items-center justify-center gap-3 px-5 py-3 text-[11px] font-extrabold uppercase tracking-[.16em] transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mb-ink)] disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {children}
      {showArrow && <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />}
    </motion.button>
  );
}

export function SectionEyebrow({ children, tone = 'gold' }: { children: ReactNode; tone?: 'crimson' | 'gold' | 'ink' | 'red' | 'navy' }) {
  const resolved = tone === 'red' ? 'crimson' : tone === 'navy' ? 'ink' : tone;
  const color =
    resolved === 'gold'
      ? 'text-[var(--mb-champagne)]'
      : resolved === 'ink'
        ? 'text-[var(--mb-ink)]/65'
        : 'text-[var(--mb-crimson)]';
  return <p className={`font-mono text-[10px] uppercase tracking-[.2em] ${color}`}>{children}</p>;
}
