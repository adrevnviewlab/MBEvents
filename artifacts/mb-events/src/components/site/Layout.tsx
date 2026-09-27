import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Menu, Pin, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { A, brand, type EventTypeValue, type ExperienceId, type LeadSource } from '@/lib/content';
import { BuildMyEventWizard, CheckMyDateModal, FindVenueModal } from '@/components/site/funnels';

type BuilderState = {
  source: LeadSource;
  selectedType?: EventTypeValue;
  experienceId?: ExperienceId;
  serviceIds?: string[];
  venueName?: string;
  eventDate?: string;
  eventDateUnknown?: boolean;
  note?: string;
} | null;

type SiteFunnels = {
  openBuilder: (opts?: {
    source?: LeadSource;
    selectedType?: EventTypeValue;
    experienceId?: ExperienceId;
    serviceIds?: string[];
    venueName?: string;
    eventDate?: string;
    eventDateUnknown?: boolean;
    note?: string;
  }) => void;
  openDate: () => void;
  openVenue: () => void;
};

const FunnelsContext = createContext<SiteFunnels | null>(null);

export function useSiteFunnels() {
  const ctx = useContext(FunnelsContext);
  if (!ctx) throw new Error('useSiteFunnels must be used within SiteShell');
  return ctx;
}

const navLinks = [
  { href: '/weddings', label: 'Weddings' },
  { href: '/experiences', label: 'Experiences' },
  { href: '/services', label: 'Services' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/venues', label: 'Venues' },
  { href: '/contact', label: 'Contact' },
];

const platformLinks = [
  { href: '/plan/jessica', label: 'Planner' },
  { href: '/e/jessica16', label: 'Sample invite' },
  { href: '/partners', label: 'Partners' },
  { href: '/stories/rob-krista', label: 'Real story' },
];

const CTA_SPRING = { type: 'spring' as const, stiffness: 420, damping: 17, mass: 0.8 };

export function SiteHeader({
  onBuild,
  onDate,
  onVenue,
  solid = false,
}: {
  onBuild: () => void;
  onDate: () => void;
  onVenue: () => void;
  solid?: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const headerBase = solid
    ? 'relative border-b border-[var(--mb-line)] bg-[var(--mb-ink)]'
    : `fixed inset-x-0 top-0 transition-[background-color,border-color,backdrop-filter] duration-500 ${
        scrolled
          ? 'border-b border-[var(--mb-line)] bg-[var(--mb-ink)]/80 backdrop-blur-xl'
          : 'border-b border-transparent bg-transparent'
      }`;

  return (
    <header className={`${headerBase} z-40`}>
      <div className={`mx-auto flex max-w-7xl items-center justify-between px-5 transition-[padding] duration-500 sm:px-8 lg:px-12 ${scrolled && !solid ? 'py-3' : 'py-5'}`}>
        <Link data-testid="link-home-logo" href="/" className="flex items-center">
          <img src={`${A}mb-events-logo.png`} alt={brand.name} className={`w-auto object-contain transition-[height] duration-500 ${scrolled && !solid ? 'h-8 sm:h-9' : 'h-10 sm:h-12'}`} />
        </Link>
        <nav className="hidden items-center gap-6 xl:flex">
          {navLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              data-testid={`link-nav-${l.label.toLowerCase()}`}
              className={`text-[10px] font-extrabold uppercase tracking-[.18em] transition-colors hover:text-[var(--mb-champagne)] ${
                location === l.href || location.startsWith(l.href + '/')
                  ? 'text-[var(--mb-champagne)]'
                  : 'text-[var(--mb-ivory-soft)]'
              }`}
            >
              {l.label}
            </Link>
          ))}
          <motion.button
            data-testid="button-header-date"
            onClick={onDate}
            whileHover={{ y: -2, scale: 1.04 }}
            whileTap={{ scale: 0.95 }}
            transition={CTA_SPRING}
            className="rounded-full border border-[var(--mb-ivory)]/45 px-4 py-2.5 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-ivory)] transition-colors hover:border-[var(--mb-champagne)] hover:text-[var(--mb-champagne)]"
          >
            Check my date
          </motion.button>
          <motion.button
            data-testid="button-header-build"
            onClick={onBuild}
            whileHover={{ y: -2, scale: 1.04 }}
            whileTap={{ scale: 0.95 }}
            transition={CTA_SPRING}
            className="rounded-full bg-[var(--mb-champagne)] px-4 py-2.5 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-ink)] transition-colors hover:bg-[var(--mb-ivory)]"
          >
            Build my event
          </motion.button>
        </nav>
        <motion.button data-testid="button-mobile-menu" whileTap={{ scale: 0.85 }} onClick={() => setMenu(!menu)} className="text-[var(--mb-ivory)] xl:hidden" aria-label="Open menu">
          <motion.span animate={{ rotate: menu ? 90 : 0 }} transition={CTA_SPRING} className="inline-flex">
            {menu ? <X /> : <Menu />}
          </motion.span>
        </motion.button>
      </div>
      <AnimatePresence initial={false}>
        {menu && (
          <motion.div
            key="mobile-menu"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30, mass: 0.9 }}
            className="overflow-hidden border-t border-[var(--mb-line)] bg-[var(--mb-charcoal)]/98 backdrop-blur-md xl:hidden"
          >
            <motion.div
              variants={{ open: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } } }}
              initial="closed"
              animate="open"
              className="px-5 pb-6 pt-3"
            >
              {navLinks.map((l) => (
                <motion.div
                  key={l.href}
                  variants={{ closed: { opacity: 0, x: -16 }, open: { opacity: 1, x: 0 } }}
                  transition={{ type: 'spring', stiffness: 340, damping: 26 }}
                >
                  <Link
                    href={l.href}
                    data-testid={`link-mobile-${l.label.toLowerCase()}`}
                    onClick={() => setMenu(false)}
                    className="block border-b border-[var(--mb-line)] py-4 text-xs font-bold uppercase tracking-widest text-[var(--mb-ivory)] transition-colors active:text-[var(--mb-champagne)]"
                  >
                    {l.label}
                  </Link>
                </motion.div>
              ))}
              <motion.button variants={{ closed: { opacity: 0, y: 10 }, open: { opacity: 1, y: 0 } }} whileTap={{ scale: 0.97 }} data-testid="button-mobile-venue" onClick={() => { setMenu(false); onVenue(); }} className="mt-4 flex w-full items-center justify-center gap-2 border border-[var(--mb-line-strong)] py-3.5 text-xs font-bold uppercase tracking-widest text-[var(--mb-ivory)]">
                Find a venue <Pin size={14} />
              </motion.button>
              <motion.button variants={{ closed: { opacity: 0, y: 10 }, open: { opacity: 1, y: 0 } }} whileTap={{ scale: 0.97 }} data-testid="button-mobile-date" onClick={() => { setMenu(false); onDate(); }} className="mt-3 w-full border border-[var(--mb-line-strong)] py-3.5 text-xs font-bold uppercase tracking-widest text-[var(--mb-ivory)]">
                Check my date
              </motion.button>
              <motion.button variants={{ closed: { opacity: 0, y: 10 }, open: { opacity: 1, y: 0 } }} whileTap={{ scale: 0.97 }} data-testid="button-mobile-build" onClick={() => { setMenu(false); onBuild(); }} className="mt-3 w-full bg-[var(--mb-champagne)] py-4 text-xs font-bold uppercase tracking-widest text-[var(--mb-ink)]">
                Build my event
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-[var(--mb-ink)] px-5 py-12 text-[var(--mb-ivory)] sm:px-8 lg:px-12">
      <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <img src={`${A}mb-events-logo.png`} alt={brand.name} className="h-12 w-auto" />
          <p className="mt-5 max-w-xs text-sm leading-6 text-[var(--mb-muted)]">
            Entertainment and production for the moments you’ll talk about for years.
          </p>
        </div>
        <div>
          <p className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[.2em] text-[var(--mb-champagne)]">
            <span className="h-px w-6 bg-[var(--mb-champagne)]" aria-hidden />
            Explore
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {[...navLinks, ...platformLinks].map((l) => (
              <Link key={l.href} href={l.href} className="text-sm text-white/75 hover:text-[var(--mb-champagne)]">
                {l.label}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <p className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[.2em] text-[var(--mb-champagne)]">
            <span className="h-px w-6 bg-[var(--mb-champagne)]" aria-hidden />
            Say hello
          </p>
          <a data-testid="link-footer-phone" href={`tel:${brand.phoneTel}`} className="mt-4 block text-sm text-white/80 hover:text-[var(--mb-champagne)]">
            {brand.phone}
          </a>
          <a data-testid="link-footer-email" href={`mailto:${brand.email}`} className="mt-2 block break-all text-sm text-white/80 hover:text-[var(--mb-champagne)]">
            {brand.email}
          </a>
        </div>
        <div>
          <p className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[.2em] text-[var(--mb-champagne)]">
            <span className="h-px w-6 bg-[var(--mb-champagne)]" aria-hidden />
            Based in Wantagh
          </p>
          <p className="mt-4 max-w-[220px] text-sm leading-6 text-[var(--mb-muted)]">
            {brand.address}
            <br />
            {brand.city}
          </p>
        </div>
      </div>
      <div className="mx-auto mt-12 flex max-w-7xl flex-col justify-between gap-3 border-t border-[var(--mb-line)] pt-5 font-mono text-[9px] uppercase tracking-[.16em] text-white/35 sm:flex-row">
        <span>© {new Date().getFullYear()} {brand.short}</span>
        <span>Make a night of it.</span>
      </div>
    </footer>
  );
}

export function PageHero({
  eyebrow,
  title,
  subtitle,
  image,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: string;
  image?: string;
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden bg-[var(--mb-ink)] px-5 pb-16 pt-32 text-[var(--mb-ivory)] sm:px-8 sm:pb-20 sm:pt-36 lg:px-12">
      {image && (
        <div className="absolute inset-0" aria-hidden>
          <img src={image} alt="" className="h-full w-full object-cover opacity-35" />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--mb-ink)] via-[var(--mb-ink)]/85 to-[var(--mb-ink)]/55" />
        </div>
      )}
      <div className="relative mx-auto max-w-7xl">
        <p className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[.22em] text-[var(--mb-champagne)]">
          <span className="h-px w-8 bg-[var(--mb-champagne)]" aria-hidden />
          {eyebrow}
        </p>
        <h1 className="mt-4 max-w-3xl font-display text-5xl leading-[.94] sm:text-7xl">{title}</h1>
        {subtitle && <p className="mt-6 max-w-xl text-sm leading-7 text-[var(--mb-ivory-soft)]">{subtitle}</p>}
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
}

export function SiteShell({ children, solidHeader = false }: { children: ReactNode; solidHeader?: boolean }) {
  const [builder, setBuilder] = useState<BuilderState>(null);
  const [dateCheck, setDateCheck] = useState(false);
  const [venueModal, setVenueModal] = useState(false);

  const openBuilder: SiteFunnels['openBuilder'] = (opts = {}) => {
    setDateCheck(false);
    setVenueModal(false);
    setBuilder({
      source: opts.source ?? 'website_builder',
      selectedType: opts.selectedType,
      experienceId: opts.experienceId,
      serviceIds: opts.serviceIds,
      venueName: opts.venueName,
      eventDate: opts.eventDate,
      eventDateUnknown: opts.eventDateUnknown,
      note: opts.note,
    });
  };
  const openDate = () => {
    setBuilder(null);
    setVenueModal(false);
    setDateCheck(true);
  };
  const openVenue = () => {
    setBuilder(null);
    setDateCheck(false);
    setVenueModal(true);
  };

  return (
    <FunnelsContext.Provider value={{ openBuilder, openDate, openVenue }}>
      <div className="grain min-h-screen overflow-x-hidden bg-[var(--mb-ink)]">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-[var(--mb-champagne)] focus:px-4 focus:py-2 focus:text-[10px] focus:font-extrabold focus:uppercase focus:tracking-[.16em] focus:text-[var(--mb-ink)]"
        >
          Skip to main content
        </a>
        <SiteHeader onBuild={() => openBuilder()} onDate={openDate} onVenue={openVenue} solid={solidHeader} />
        <div id="main-content" className="pb-24 xl:pb-0">{children}</div>
        <SiteFooter />
        {!builder && !dateCheck && !venueModal && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30, delay: 0.15 }}
          className="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t border-[var(--mb-line)] bg-[var(--mb-ink)]/95 p-3 backdrop-blur-md xl:hidden"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <motion.button whileTap={{ scale: 0.96 }} data-testid="button-sticky-build" onClick={() => openBuilder()} className="flex-1 rounded-full bg-[var(--mb-champagne)] py-3.5 text-[10px] font-extrabold uppercase tracking-[.14em] text-[var(--mb-ink)]">
            Build my event
          </motion.button>
          <motion.button whileTap={{ scale: 0.96 }} data-testid="button-sticky-date" onClick={openDate} className="flex-1 rounded-full border border-[var(--mb-ivory)]/40 py-3.5 text-[10px] font-extrabold uppercase tracking-[.14em] text-[var(--mb-ivory)]">
            Check my date
          </motion.button>
        </motion.div>
        )}
        {builder && (
          <BuildMyEventWizard
            source={builder.source}
            selectedType={builder.selectedType}
            experienceId={builder.experienceId}
            initialServices={builder.serviceIds}
            initialVenue={builder.venueName}
            initialDate={builder.eventDate}
            initialDateUnknown={builder.eventDateUnknown}
            initialNote={builder.note}
            onClose={() => setBuilder(null)}
          />
        )}
        {dateCheck && (
          <CheckMyDateModal
            onClose={() => setDateCheck(false)}
            onContinueBuild={({ selectedType, eventDate }) => {
              setDateCheck(false);
              openBuilder({ source: 'date_check', selectedType, eventDate });
            }}
          />
        )}
        {venueModal && (
          <FindVenueModal
            onClose={() => setVenueModal(false)}
            onRequest={(venueName) => {
              setVenueModal(false);
              openBuilder({ source: 'venue_finder', venueName });
            }}
          />
        )}
      </div>
    </FunnelsContext.Provider>
  );
}
