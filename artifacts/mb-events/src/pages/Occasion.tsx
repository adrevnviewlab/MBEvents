import type { EventTypeValue } from '@/lib/content';
import { Button, SectionEyebrow } from '@/components/site/ui';
import { PageHero, SiteShell, useSiteFunnels } from '@/components/site/Layout';

type Copy = {
  title: string;
  eyebrow: string;
  lead: string;
  body: string;
  bullets: string[];
};

export function OccasionPage({
  copy,
  eventType,
  image,
  testId,
}: {
  copy: Copy;
  eventType: EventTypeValue;
  image: string;
  testId: string;
}) {
  const { openBuilder, openDate } = useSiteFunnels();
  return (
    <SiteShell solidHeader>
      <main>
        <PageHero
          eyebrow={copy.eyebrow}
          title={
            <>
              {copy.title}
              <br />
              <em className="text-[var(--mb-champagne)]">with MB.</em>
            </>
          }
          subtitle={copy.lead}
          image={image}
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => openBuilder({ selectedType: eventType })} variant="red" testId={`button-${testId}-build`}>
              Build my event
            </Button>
            <Button onClick={openDate} variant="outline" testId={`button-${testId}-date`} showArrow={false}>
              Check my date
            </Button>
          </div>
        </PageHero>
        <section className="bg-[var(--mb-charcoal)] px-5 py-20 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-28">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <SectionEyebrow>How we shape it</SectionEyebrow>
              <h2 className="mt-4 font-display text-4xl sm:text-5xl">One team for the whole night</h2>
              <p className="mt-6 text-sm leading-7 text-[var(--mb-muted)]">{copy.body}</p>
              <ul className="mt-8 space-y-3">
                {copy.bullets.map((b) => (
                  <li key={b} className="border-l-2 border-[var(--mb-champagne)] pl-4 font-mono text-[10px] uppercase tracking-[.14em] text-[var(--mb-ivory-soft)]">
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <img src={image} alt="" className="min-h-[320px] w-full object-cover" />
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
