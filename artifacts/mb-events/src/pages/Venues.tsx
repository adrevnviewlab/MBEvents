import { venues, M } from '@/lib/content';
import { Button, SectionEyebrow } from '@/components/site/ui';
import { PageHero, SiteShell, useSiteFunnels } from '@/components/site/Layout';

function Inner() {
  const { openBuilder, openVenue } = useSiteFunnels();
  return (
    <main>
      <PageHero
        eyebrow="Venues"
        title={
          <>
            Rooms we know
            <br />
            <em className="text-[var(--mb-champagne)]">by heart.</em>
          </>
        }
        subtitle="Long Island favorites and affiliate spaces where MB production has filled dance floors for years. Browse, then request info — we’ll help match capacity, vibe, and date."
        image={`${M}uplighting-ballroom.jpg`}
      >
        <Button onClick={openVenue} variant="red" testId="button-venues-page-finder">
          Open venue finder
        </Button>
      </PageHero>
      <section className="bg-[var(--mb-charcoal)] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <SectionEyebrow>Directory</SectionEyebrow>
          <h2 className="mt-4 font-display text-4xl text-[var(--mb-ivory)] sm:text-5xl">Browse & request</h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {venues.map((v, i) => (
              <button
                key={v.name}
                type="button"
                data-testid={`card-venue-dir-${i}`}
                onClick={() => openBuilder({ source: 'venue_finder', venueName: v.name })}
                className="group relative min-h-[320px] overflow-hidden text-left"
              >
                <img src={v.image} alt={v.name} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)] via-[var(--mb-ink)]/40 to-transparent" />
                <div className="relative flex h-full flex-col justify-end p-6 text-[var(--mb-ivory)]">
                  <p className="font-mono text-[9px] uppercase tracking-[.16em] text-[var(--mb-champagne)]">{v.area}</p>
                  <h3 className="mt-2 font-display text-3xl leading-tight">{v.name}</h3>
                  <p className="mt-2 text-xs text-white/70">{v.capacity} guests</p>
                  <p className="mt-1 text-xs text-white/50">{v.vibe}</p>
                  <span className="mt-4 text-[10px] font-extrabold uppercase tracking-[.14em] text-[var(--mb-champagne)] opacity-0 transition-opacity group-hover:opacity-100">
                    Request this venue →
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

export function VenuesPage() {
  return (
    <SiteShell solidHeader>
      <Inner />
    </SiteShell>
  );
}
