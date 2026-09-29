import { M, privateCopy } from '@/lib/content';
import { OccasionPage } from '@/pages/Occasion';

export function PrivatePartyPage() {
  return <OccasionPage copy={privateCopy} eventType="Private Party" image={`${M}private-party.jpg`} testId="private" />;
}
