import { M, corporateCopy } from '@/lib/content';
import { OccasionPage } from '@/pages/Occasion';

export function CorporatePage() {
  return <OccasionPage copy={corporateCopy} eventType="Corporate Event" image={`${M}corporate.jpg`} testId="corporate" />;
}