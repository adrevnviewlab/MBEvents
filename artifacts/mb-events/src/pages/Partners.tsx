import { useEffect, useState } from 'react';
import { Button, SectionEyebrow } from '@/components/site/ui';
import { PageHero, SiteShell, useSiteFunnels } from '@/components/site/Layout';
import { usePageMeta } from '@/lib/seo';

type LivePartner = {
  id: string;
  name: string;
  category: string;
  description: string;
  area: string;
  verified: boolean;
  photos: { url: string }[];
};

function Inner() {
  const { openBuilder } = useSiteFunnels();
  const [live, setLive] = useState<LivePartner[] | null>(null);
  const [failed, setFailed] = useState(false);
  usePageMeta({
    title: 'Partners',
    description: 'Photographers, florists, cake, decor, and film partners MB Events has published — not a guarantee of availability or quality.',
    path: '/partners',
  });
  useEffect(() => {
    let gone = false;
    fetch('/api/partners')
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { partners?: LivePartner[] } | null) => {
        if (gone) return;
        setLive(Array.isArray(body?.partners) ? body.partners : []);
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
        eyebrow="MB Partners"
        title={
          <>
            The people around
            <br />
            <em className="text-[var(--mb-champagne)]">the night.</em>
          </>
        }
        subtitle="Only partners MB has published appear here. MB Verified means we have worked with or vetted them — not a legal or quality guarantee."
      />
      <section className="bg-[var(--mb-charcoal)] px-5 py-16 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-24">
        <div className="mx-auto max-w-7xl">
          <SectionEyebrow>Request a quote</SectionEyebrow>
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {live === null && <p className="text-sm text-[var(--mb-muted)]">Loading partners…</p>}
            {live && live.length === 0 && (
              <div className="col-span-full max-w-lg border border-dashed border-[var(--mb-line)] p-8">
                <p className="font-display text-2xl">No published partners yet</p>
                <p className="mt-3 text-sm leading-6 text-[var(--mb-muted)]">
                  {failed
                    ? 'We could not load the directory. Ask us for recommendations that fit your event.'
                    : 'Ask us for photographers, florals, cake, and film we have actually worked beside.'}
                </p>
                <Button onClick={() => openBuilder({ source: 'service', note: 'Partner recommendation request' })} variant="ghost" testId="button-partners-empty" className="mt-6">
                  Ask for a recommendation
                </Button>
              </div>
            )}
            {live?.map((p) => (
              <article key={p.id} className="flex flex-col overflow-hidden border border-[var(--mb-line)] bg-[var(--mb-surface)]/50">
                {p.photos[0] && <img src={p.photos[0].url} alt="" className="h-40 w-full object-cover" loading="lazy" />}
                <div className="flex flex-1 flex-col p-6">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--mb-champagne)]">{p.category}</p>
                    {p.verified && (
                      <span className="border border-[var(--mb-champagne)] px-2 py-1 font-mono text-[9px] uppercase tracking-[.14em] text-[var(--mb-champagne)]">MB Verified</span>
                    )}
                  </div>
                  <h2 className="mt-4 font-display text-3xl">{p.name}</h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--mb-muted)]">{p.description}</p>
                  <p className="mt-3 text-xs text-[var(--mb-ivory-soft)]">{p.area}</p>
                  <Button
                    onClick={() => openBuilder({ source: 'service', vendorId: p.id, note: `Quote request: ${p.name} (${p.category})` })}
                    variant="ghost"
                    testId={`button-partner-${p.name}`}
                    className="mt-6 self-start"
                  >
                    Request quote
                  </Button>
                </div>
              </article>
            ))}
          </div>
          <p className="mt-8 text-xs text-[var(--mb-muted)]">MB Verified means we have worked with or vetted this partner. It is not a legal, safety, or quality guarantee.</p>
        </div>
      </section>
    </main>
  );
}

export function PartnersPage() {
  return (
    <SiteShell solidHeader>
      <Inner />
    </SiteShell>
  );
}
