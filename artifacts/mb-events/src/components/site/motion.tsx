import { useRef, type ReactNode } from 'react';
import { Link } from 'wouter';
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
  type Variants,
} from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Shared spring configs — tuned to feel weighty (higher mass) yet responsive.
 */
export const LIFT_SPRING = {
  type: 'spring' as const,
  stiffness: 260,
  damping: 20,
  mass: 1.1,
};

const TILT_SPRING = { stiffness: 150, damping: 15, mass: 1 };

function useCoarsePointer() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

const REVEAL_SPRING = { type: 'spring' as const, stiffness: 90, damping: 20, mass: 1 };

/**
 * Scroll-reveal: content eases + rises into view once, as it enters the
 * viewport. Respects reduced-motion. Direction controls the offset axis.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 26,
  once = true,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  once?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, amount: 0.25, margin: '0px 0px -10% 0px' }}
      transition={{ ...REVEAL_SPRING, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Staggered container: children using `revealItem` variants animate in
 * sequence as the group scrolls into view.
 */
export function RevealGroup({
  children,
  className,
  stagger = 0.09,
  once = true,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  once?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount: 0.2 }}
      variants={{ show: { transition: { staggerChildren: stagger } } }}
    >
      {children}
    </motion.div>
  );
}

export const revealItem: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: REVEAL_SPRING },
};

type SpringCardProps = {
  children: ReactNode;
  className?: string;
  /** Client-side navigation target (renders an accessible overlay link). */
  href?: string;
  /** Action handler (renders an accessible overlay button). */
  onClick?: () => void;
  /** Accessible label for the overlay action. */
  label?: string;
  testId?: string;
  /** Max tilt in degrees on pointer move (desktop only). */
  tilt?: number;
  /** Hover lift distance in px (negative = up). */
  lift?: number;
};

/**
 * A card wrapper that adds real spring physics: a weighted lift on hover,
 * a subtle pointer-driven 3D tilt, and a springy press. Pairs with the
 * `.mb-card` "mass" border treatment. Tilt is disabled for touch devices
 * and when the user prefers reduced motion.
 */
export function SpringCard({
  children,
  className,
  href,
  onClick,
  label,
  testId,
  tilt = 6,
  lift = -10,
}: SpringCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const coarse = useCoarsePointer();
  const interactive = !reduceMotion && !coarse;

  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateX = useSpring(
    useTransform(py, [0, 1], [tilt, -tilt]),
    TILT_SPRING,
  );
  const rotateY = useSpring(
    useTransform(px, [0, 1], [-tilt, tilt]),
    TILT_SPRING,
  );

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    px.set((e.clientX - rect.left) / rect.width);
    py.set((e.clientY - rect.top) / rect.height);
  }

  function handlePointerLeave() {
    px.set(0.5);
    py.set(0.5);
  }

  const Overlay = href ? (
    <Link
      href={href}
      data-testid={testId}
      className="absolute inset-0 z-20 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mb-champagne)]"
    >
      <span className="sr-only">{label ?? 'Open'}</span>
    </Link>
  ) : onClick ? (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="absolute inset-0 z-20 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mb-champagne)]"
    >
      <span className="sr-only">{label ?? 'Open'}</span>
    </button>
  ) : null;

  return (
    <motion.div
      ref={ref}
      className={cn('mb-card group relative', className)}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={
        interactive
          ? { rotateX, rotateY, transformPerspective: 1000, transformStyle: 'preserve-3d' }
          : undefined
      }
      whileHover={interactive ? { y: lift, scale: 1.015 } : undefined}
      whileTap={{ scale: 0.985 }}
      transition={LIFT_SPRING}
    >
      {children}
      {Overlay}
    </motion.div>
  );
}
