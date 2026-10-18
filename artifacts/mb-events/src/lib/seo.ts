import { useEffect } from 'react';
import { brand } from '@/lib/content';

export type PageMeta = {
  title: string;
  description: string;
  path?: string;
  image?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[] | null;
};

const DEFAULT_IMAGE = '/assets/hero-ballroom.jpg';

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  const selector = attr === 'name' ? `meta[name="${key}"]` : `meta[property="${key}"]`;
  let node = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!node) {
    node = document.createElement('meta');
    node.setAttribute(attr, key);
    document.head.appendChild(node);
  }
  node.setAttribute('content', content);
}

function upsertLink(rel: string, href: string) {
  let node = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!node) {
    node = document.createElement('link');
    node.setAttribute('rel', rel);
    document.head.appendChild(node);
  }
  node.setAttribute('href', href);
}

function absoluteUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return origin ? `${origin}${normalized}` : normalized;
}

/** Route-level title, description, Open Graph, and optional JSON-LD for the SPA. */
export function usePageMeta({ title, description, path = '/', image = DEFAULT_IMAGE, jsonLd = null }: PageMeta) {
  const jsonLdKey = jsonLd ? JSON.stringify(jsonLd) : '';
  useEffect(() => {
    const fullTitle = title.includes(brand.short) ? title : `${title} | ${brand.short}`;
    document.title = fullTitle;
    upsertMeta('name', 'description', description);
    upsertMeta('property', 'og:title', fullTitle);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:type', 'website');
    upsertMeta('property', 'og:image', absoluteUrl(image));
    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', fullTitle);
    upsertMeta('name', 'twitter:description', description);
    upsertMeta('name', 'twitter:image', absoluteUrl(image));
    upsertLink('canonical', absoluteUrl(path));

    const scriptId = 'mb-jsonld';
    const existing = document.getElementById(scriptId);
    if (existing) existing.remove();
    if (jsonLdKey) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.type = 'application/ld+json';
      script.text = jsonLdKey;
      document.head.appendChild(script);
    }
    return () => {
      document.getElementById(scriptId)?.remove();
    };
  }, [title, description, path, image, jsonLdKey]);
}

export function localBusinessJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'EntertainmentBusiness',
    name: brand.name,
    alternateName: brand.short,
    description: brand.about,
    telephone: brand.phone,
    email: brand.email,
    url: typeof window !== 'undefined' ? window.location.origin : 'https://mbeventsny.com',
    address: {
      '@type': 'PostalAddress',
      streetAddress: brand.address,
      addressLocality: 'Wantagh',
      addressRegion: 'NY',
      postalCode: '11793',
      addressCountry: 'US',
    },
    areaServed: 'Tri-State area',
  };
}

export function faqJsonLd(items: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}
