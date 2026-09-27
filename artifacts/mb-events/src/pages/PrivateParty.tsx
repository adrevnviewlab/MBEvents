import { A, privateCopy } from '@/lib/content';
import { OccasionPage } from '@/pages/Occasion';

export function PrivatePartyPage() {
  return <OccasionPage copy={privateCopy} eventType="Private Party" image={`${A}hero-ballroom.jpg`} testId="private" />;
}
