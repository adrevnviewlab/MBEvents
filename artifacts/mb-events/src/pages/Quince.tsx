import { M, quinceCopy } from '@/lib/content';
import { OccasionPage } from '@/pages/Occasion';

export function QuincePage() {
  return <OccasionPage copy={quinceCopy} eventType="Quinceañera" image={`${M}quince.jpg`} testId="quince" />;
}
