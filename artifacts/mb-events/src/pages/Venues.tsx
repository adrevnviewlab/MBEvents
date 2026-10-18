import { useEffect, useState } from 'react';
import { M } from '@/lib/content';
import { Button, SectionEyebrow } from '@/components/site/ui';
import { PageHero, SiteShell, useSiteFunnels } from '@/components/site/Layout';
import { usePageMeta } from '@/lib/seo';

type LiveVenue = {
  id: string;
  name: string;
  description: string;
  capacity: string;
  area: string;
  serviceArea: string;
  mbProduction: boolean;
  photos: { url: string }[];
};

function Inner() {
  const { openBuilder, openVenue } = useSiteFunnels();
  const [live, setLive] = useState<LiveVenue[] | null>(null);
  const [failed, setFailed] = useState(false);
  usePageMeta({
    title: 'Venues',
    description: 'Published venues from the MB Events directory. Availability is checked against the real calendar — an inquiry does not hold a date.',
    path: '/venues',
    image: '/media/uplighting-ballroom.jpg',
  });
  useEffect(() => {
    let gone = false;
    fetch('/api/venues')
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { venues?: LiveVenue[] } | null) => {
        if (gone) return;
        setLive(Array.isArray(body?.venues) ? body.venues : []);
      })
      .catch(() => {
        if (!gone) {
          setLive([]);
          setFailed(true);
        }
      });
    return () => { gone = true; };
  }, []);
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
        subtitle="Only published venues appear here. Browse, then request info — we’ll help match capacity, vibe, and date. Listing a room does not reserve it."
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
            {live === null && <p className="text-sm text-[var(--mb-muted)]">Loading venues…</p>}
            {live && live.length === 0 && (
              <div className="col-span-full max-w-lg border border-dashed border-[var(--mb-line)] p-8 text-[var(--mb-ivory)]">
                <p className="font-display text-2xl">No published venues yet</p>
                <p className="mt-3 text-sm leading-6 text-[var(--mb-muted)]">
                  {failed
                    ? 'We could not load the directory. Tell us your date and guest count and we’ll help match a room.'
                    : 'Tell us your date and guest count — we’ll help match a room from spaces we know.'}
                </p>
                <Button onClick={() => openBuilder({ source: 'venue_finder', note: 'Looking for a venue' })} variant="ghost" testId="button-venues-empty" className="mt-6">
                  Request venue help
                </Button>
              </div>
            )}
            {live?.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => openBuilder({ source: 'venue_finder', venueName: v.name, venueId: v.id })}
                className="group relative min-h-[320px] overflow-hidden bg-[var(--mb-ink)] text-left"
              >
                {v.photos[0] && <img src={v.photos[0].url} alt={v.name} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" loading="lazy" />}
                <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)] via-[var(--mb-ink)]/40 to-transparent" />
                <div className="relative flex h-full flex-col justify-end p-6 text-[var(--mb-ivory)]">
                  <p className="font-mono text-[9px] uppercase tracking-[.16em] text-[var(--mb-champagne)]">{v.serviceArea || v.area}</p>
                  <h3 className="mt-2 font-display text-3xl leading-tight">{v.name}</h3>
                  {v.capacity && <p className="mt-2 text-xs text-white/70">{v.capacity} guests</p>}
                  {v.description && <p className="mt-1 text-xs text-white/50">{v.description}</p>}
                  {v.mbProduction && <p className="mt-2 font-mono text-[9px] uppercase tracking-[.16em] text-[var(--mb-champagne)]">MB production</p>}
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
