import { weddingCopy, M, galleryItems } from '@/lib/content';
import { Button, SectionEyebrow } from '@/components/site/ui';
import { PageHero, SiteShell, useSiteFunnels } from '@/components/site/Layout';

function Inner() {
  const { openBuilder, openDate } = useSiteFunnels();
  const clips = galleryItems.filter((g) => g.type === 'video').slice(0, 3);

  return (
    <main>
      <PageHero
        eyebrow={weddingCopy.eyebrow}
        title={
          <>
            {weddingCopy.title}
            <br />
            <em className="text-[var(--mb-champagne)]">without the stress.</em>
          </>
        }
        subtitle={weddingCopy.lead}
        image={`${M}weddings.jpg`}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={() => openBuilder({ selectedType: 'Wedding' })} variant="red" testId="button-wedding-build">
            Build my wedding
          </Button>
          <Button onClick={openDate} variant="outline" testId="button-wedding-date" showArrow={false}>
            Check my date
          </Button>
        </div>
      </PageHero>

      <section className="bg-[var(--mb-charcoal)] px-5 py-20 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:items-start">
          <div>
            <SectionEyebrow>We care about your special day</SectionEyebrow>
            <h2 className="mt-4 font-display text-4xl sm:text-5xl">From prelude to last dance</h2>
            <p className="mt-6 text-sm leading-7 text-[var(--mb-muted)]">{weddingCopy.body}</p>
            <ul className="mt-8 space-y-3">
              {weddingCopy.bullets.map((b) => (
                <li key={b} className="border-l-2 border-[var(--mb-champagne)] pl-4 font-mono text-[10px] uppercase tracking-[.14em] text-[var(--mb-ivory-soft)]">
                  {b}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative min-h-[360px] overflow-hidden">
            <video className="absolute inset-0 h-full w-full object-cover" autoPlay muted loop playsInline poster={`${M}sparkler-entrance-poster.jpg`}>
              <source src={`${M}sparkler-entrance.mp4`} type="video/mp4" />
            </video>
            <div className="absolute inset-0 bg-gradient-to-t from-[var(--mb-ink)]/50 to-transparent" />
          </div>
        </div>
      </section>

      <section className="bg-[var(--mb-ink)] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <SectionEyebrow tone="gold">In motion</SectionEyebrow>
          <h2 className="mt-4 font-display text-4xl text-[var(--mb-ivory)]">Sparkling wedding production</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {clips.map((c, i) => (
              <figure key={i} className="overflow-hidden border border-[var(--mb-line)]">
                <video className="aspect-video w-full object-cover" controls preload="metadata" poster={c.poster} playsInline>
                  <source src={c.src} type="video/mp4" />
                </video>
                <figcaption className="px-4 py-3 font-display text-xl text-[var(--mb-ivory)]">{c.caption}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

export function WeddingsPage() {
  return (
    <SiteShell solidHeader>
      <Inner />
    </SiteShell>
  );
}
