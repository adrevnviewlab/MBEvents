import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { A, brand, type EventTypeValue, type ExperienceId, type LeadSource } from '@/lib/content';
import { BuildMyEventWizard, CheckMyDateModal, FindVenueModal } from '@/components/site/funnels';
import { captureLeadAttribution } from '@/lib/leads';

type BuilderState = {
  source: LeadSource;
  selectedType?: EventTypeValue;
  experienceId?: ExperienceId;
  serviceIds?: string[];
  venueName?: string;
  venueId?: string;
  vendorId?: string;
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
    venueId?: string;
    vendorId?: string;
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
  { href: '/experiences', label: 'Experiences' },
  { href: '/services', label: 'Services' },
  { href: '/venues', label: 'Venues' },
  { href: '/gallery', label: 'Real Events' },
  { href: '/contact', label: 'Contact' },
];

const secondaryLinks = [
  { href: '/weddings', label: 'Weddings' },
  { href: '/sweet-16', label: 'Sweet 16s' },
  { href: '/about', label: 'About Us' },
  { href: '/partners', label: 'Partners' },
  { href: '/stories/rob-krista', label: 'Featured story' },
];

const CTA_SPRING = { type: 'spring' as const, stiffness: 420, damping: 17, mass: 0.8 };

export function SiteHeader({
  onDate,
  solid = false,
}: {
  onDate: () => void;
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
    ? 'relative border-b border-white/10 bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl'
    : `fixed inset-x-0 top-0 transition-[background-color,border-color,backdrop-filter,box-shadow] duration-500 ${
        scrolled
          ? 'border-b border-white/12 bg-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-2xl'
          : 'border-b border-white/[0.06] bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl'
      }`;

  return (
    <header className={`${headerBase} z-40 supports-[backdrop-filter]:bg-white/[0.04]`}>
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
            type="button"
            onClick={onDate}
            whileHover={{ y: -2, scale: 1.04 }}
            whileTap={{ scale: 0.95 }}
            transition={CTA_SPRING}
            className="rounded-full border border-white/20 bg-white/12 px-5 py-2.5 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-ivory)] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-md transition-colors hover:border-[var(--mb-champagne)]/50 hover:bg-[var(--mb-champagne)] hover:text-[var(--mb-ink)]"
          >
            Check my date
          </motion.button>
        </nav>
        <motion.button data-testid="button-mobile-menu" type="button" whileTap={{ scale: 0.85 }} onClick={() => setMenu(!menu)} className="text-[var(--mb-ivory)] xl:hidden" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu}>
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
            className="overflow-hidden border-t border-white/10 bg-white/[0.05] backdrop-blur-2xl xl:hidden"
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
              <motion.button variants={{ closed: { opacity: 0, y: 10 }, open: { opacity: 1, y: 0 } }} whileTap={{ scale: 0.97 }} data-testid="button-mobile-date" type="button" onClick={() => { setMenu(false); onDate(); }} className="mt-5 w-full rounded-full bg-[var(--mb-champagne)] py-4 text-xs font-extrabold uppercase tracking-widest text-[var(--mb-ink)] transition-colors hover:bg-[var(--mb-ivory)]">
                Check my date
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
    <footer className="border-t border-[var(--mb-glass-border)] bg-[var(--mb-ink)]/40 px-5 py-12 text-[var(--mb-ivory)] backdrop-blur-2xl sm:px-8 lg:px-12">
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
            {[...navLinks, ...secondaryLinks].map((l) => (
              <Link key={l.href} href={l.href} className="text-sm text-white/75 hover:text-[var(--mb-champagne)]">
                {l.label}
              </Link>
            ))}
            <a href="/planner" className="text-sm text-white/75 hover:text-[var(--mb-champagne)]">Client planner</a>
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
    <section className="relative overflow-hidden px-5 pb-16 pt-32 text-[var(--mb-ivory)] sm:px-8 sm:pb-20 sm:pt-36 lg:px-12">
      {image && (
        <div className="absolute inset-0" aria-hidden>
          <img src={image} alt="" className="h-full w-full object-cover opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--mb-ink)]/90 via-[var(--mb-ink)]/70 to-[var(--mb-ink)]/35 backdrop-blur-[2px]" />
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

  useEffect(() => {
    captureLeadAttribution();
  }, []);

  const openBuilder: SiteFunnels['openBuilder'] = (opts = {}) => {
    setDateCheck(false);
    setVenueModal(false);
    setBuilder({
      source: opts.source ?? 'website_builder',
      selectedType: opts.selectedType,
      experienceId: opts.experienceId,
      serviceIds: opts.serviceIds,
      venueName: opts.venueName,
      venueId: opts.venueId,
      vendorId: opts.vendorId,
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
      <div className="mb-site relative min-h-screen overflow-x-hidden bg-transparent">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-[var(--mb-champagne)] focus:px-4 focus:py-2 focus:text-[10px] focus:font-extrabold focus:uppercase focus:tracking-[.16em] focus:text-[var(--mb-ink)]"
        >
          Skip to main content
        </a>
        <SiteHeader onDate={openDate} solid={solidHeader} />
        <div id="main-content" className="pb-24 xl:pb-0">{children}</div>
        <SiteFooter />
        {!builder && !dateCheck && !venueModal && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30, delay: 0.15 }}
          className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--mb-glass-border)] bg-[var(--mb-ink)]/55 p-3 backdrop-blur-2xl xl:hidden"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <motion.button whileTap={{ scale: 0.96 }} data-testid="button-sticky-date" type="button" onClick={openDate} className="w-full rounded-full bg-[var(--mb-champagne)] py-3.5 text-[10px] font-extrabold uppercase tracking-[.14em] text-[var(--mb-ink)] transition-colors hover:bg-[var(--mb-ivory)]">
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
            initialVenueId={builder.venueId}
            initialVendorId={builder.vendorId}
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
            onRequest={({ venueName, venueId }) => {
              setVenueModal(false);
              openBuilder({ source: 'venue_finder', venueName, venueId });
            }}
          />
        )}
      </div>
    </FunnelsContext.Provider>
  );
}
