import { useState, type FormEvent } from 'react';
import { CircleCheck } from 'lucide-react';
import { brand, faqs, M } from '@/lib/content';
import { Button, Field, SectionEyebrow } from '@/components/site/ui';
import { PageHero, SiteShell, useSiteFunnels } from '@/components/site/Layout';

function Inner() {
  const { openBuilder, openDate } = useSiteFunnels();
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) return;
    setSubmitting(true);
    console.log('[MB Events] Contact form', { ...form, source: 'contact_form' });
    await new Promise((r) => setTimeout(r, 600));
    setSubmitting(false);
    setSent(true);
  };

  return (
    <main>
      <PageHero
        eyebrow="Contact"
        title={
          <>
            Let’s talk about
            <br />
            <em className="text-[var(--mb-champagne)]">your night.</em>
          </>
        }
        subtitle="Want MB Events to provide the ultimate sound and lighting experience? Fill out a quick note — or jump into Build My Event / Check My Date."
        image={`${M}service-planning.jpg`}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={() => openBuilder()} variant="red" testId="button-contact-build">
            Build my event
          </Button>
          <Button onClick={openDate} variant="outline" testId="button-contact-date" showArrow={false}>
            Check my date
          </Button>
        </div>
      </PageHero>

      <section className="bg-[var(--mb-charcoal)] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div className="text-[var(--mb-ivory)]">
            <SectionEyebrow>Say hello</SectionEyebrow>
            <h2 className="mt-4 font-display text-4xl">We’re based in Wantagh</h2>
            <div className="mt-8 space-y-5 text-sm leading-7 text-[var(--mb-muted)]">
              <p>
                <a href={`tel:${brand.phoneTel}`} className="text-[var(--mb-ivory)] hover:text-[var(--mb-champagne)]">
                  {brand.phone}
                </a>
                <br />
                Toll free · 855-MBSOUND
              </p>
              <p>
                <a href={`mailto:${brand.email}`} className="text-[var(--mb-ivory)] hover:text-[var(--mb-champagne)]">
                  {brand.email}
                </a>
              </p>
              <p>
                {brand.address}
                <br />
                {brand.city}
              </p>
              <p>{brand.hours}</p>
              <p className="max-w-sm">{brand.about}</p>
            </div>
          </div>

          <div className="border border-[var(--mb-line)] bg-[var(--mb-surface)]/40 p-6 sm:p-8">
            {sent ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center text-center animate-rise">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--mb-champagne)] text-[var(--mb-ink)]">
                  <CircleCheck size={32} />
                </div>
                <h3 className="font-display text-3xl text-[var(--mb-ivory)]">Message received</h3>
                <p className="mt-3 max-w-sm text-sm text-[var(--mb-muted)]">We’ll get back within one business day.</p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-5">
                <h3 className="font-display text-3xl text-[var(--mb-ivory)]">Send a note</h3>
                <Field label="Name" value={form.name} onChange={(v) => setForm((c) => ({ ...c, name: v }))} required testId="input-contact-name" />
                <Field label="Email" type="email" value={form.email} onChange={(v) => setForm((c) => ({ ...c, email: v }))} required testId="input-contact-email" />
                <Field label="Phone" type="tel" value={form.phone} onChange={(v) => setForm((c) => ({ ...c, phone: v }))} testId="input-contact-phone" />
                <label className="block">
                  <span className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--mb-muted)]">Message</span>
                  <textarea
                    data-testid="input-contact-message"
                    required
                    value={form.message}
                    onChange={(e) => setForm((c) => ({ ...c, message: e.target.value }))}
                    rows={4}
                    className="mt-2 w-full border border-[var(--mb-line-strong)] bg-[var(--mb-ink)]/40 px-4 py-3 text-sm text-[var(--mb-ivory)] outline-none placeholder:text-[var(--mb-muted)] focus:border-[var(--mb-crimson)]"
                    placeholder="Date, venue, what you’re dreaming up…"
                  />
                </label>
                <Button type="submit" variant="red" testId="button-contact-submit" disabled={submitting} showArrow={!submitting}>
                  {submitting ? 'Sending…' : 'Send message'}
                </Button>
              </form>
            )}
          </div>
        </div>
      </section>

      <section className="bg-[var(--mb-ink)] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <SectionEyebrow tone="gold">FAQ</SectionEyebrow>
          <h2 className="mt-4 font-display text-4xl text-[var(--mb-ivory)] sm:text-5xl">Quick answers</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {faqs.map((f) => (
              <details key={f.q} className="group border border-[var(--mb-line)] bg-[var(--mb-surface)]/30 p-5 open:border-[var(--mb-champagne)]/40">
                <summary className="cursor-pointer list-none font-display text-xl text-[var(--mb-ivory)] marker:content-none">
                  {f.q}
                </summary>
                <p className="mt-3 text-sm leading-7 text-[var(--mb-muted)]">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

export function ContactPage() {
  return (
    <SiteShell solidHeader>
      <Inner />
    </SiteShell>
  );
}
