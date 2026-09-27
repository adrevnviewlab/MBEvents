import { M } from '@/lib/content';
import { Button, SectionEyebrow } from '@/components/site/ui';
import { PageHero, SiteShell, useSiteFunnels } from '@/components/site/Layout';

function Inner() {
  const { openBuilder } = useSiteFunnels();
  return (
    <main>
      <PageHero
        eyebrow="Real event"
        title={
          <>
            Rob & Krista
            <br />
            <em className="text-[var(--mb-champagne)]">at the reception.</em>
          </>
        }
        subtitle="A wedding night with soft light, a hosted reception, and a floor that stayed full. This is the kind of story every MB event can become."
        image={`${M}weddings.jpg`}
      >
        <Button
          onClick={() => openBuilder({ selectedType: 'Wedding', note: 'Build an event like Rob & Krista' })}
          variant="red"
          testId="button-story-build"
        >
          Build an event like this
        </Button>
      </PageHero>
      <section className="bg-[var(--mb-charcoal)] px-5 py-16 text-[var(--mb-ivory)] sm:px-8 lg:px-12 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.2fr_.8fr]">
          <video className="aspect-video w-full object-cover" controls playsInline poster={`${M}wedding-rob-krista-poster.jpg`}>
            <source src={`${M}wedding-rob-krista.mp4`} type="video/mp4" />
          </video>
          <div>
            <SectionEyebrow>The setup</SectionEyebrow>
            <ul className="mt-6 space-y-3 text-sm leading-6 text-[var(--mb-ivory-soft)]">
              <li>Theme — modern luxury, warm light</li>
              <li>MB setup — DJ, MC, uplighting, reception pacing</li>
              <li>Venue — Long Island ballroom</li>
              <li>Vendors — photography and florals alongside MB</li>
            </ul>
            <p className="mt-6 text-sm leading-7 text-[var(--mb-muted)]">
              Guest count stays private unless the couple wants it shared. The page is the portfolio, the venue proof, and the next inquiry — one story, three jobs.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

export function StoryPage() {
  return (
    <SiteShell solidHeader>
      <Inner />
    </SiteShell>
  );
}
