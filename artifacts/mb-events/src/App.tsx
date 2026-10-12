import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Home } from '@/components/site/Home';
import { ExperiencesPage } from '@/pages/Experiences';
import { ServicesPage } from '@/pages/Services';
import { GalleryPage } from '@/pages/Gallery';
import { VenuesPage } from '@/pages/Venues';
import { ContactPage } from '@/pages/Contact';
import { AboutPage } from '@/pages/About';
import { WeddingsPage } from '@/pages/Weddings';
import { Sweet16Page } from '@/pages/Sweet16';
import { QuincePage } from '@/pages/Quince';
import { MitzvahPage } from '@/pages/Mitzvah';
import { CorporatePage } from '@/pages/Corporate';
import { BirthdayPage } from '@/pages/Birthday';
import { SchoolPage } from '@/pages/School';
import { PrivatePartyPage } from '@/pages/PrivateParty';
import { PartnersPage } from '@/pages/Partners';
import { StoryPage } from '@/pages/Story';
import { Route, Switch, Router as WouterRouter, Link } from 'wouter';

const queryClient = new QueryClient();

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--mb-ink)] px-6 text-center">
      <div>
        <h1 className="font-display text-6xl text-[var(--mb-ivory)]">That room isn’t here.</h1>
        <Link data-testid="link-not-found-home" href="/" className="mt-6 inline-block text-xs font-bold uppercase tracking-widest text-[var(--mb-champagne)]">
          Return home
        </Link>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/experiences" component={ExperiencesPage} />
      <Route path="/services" component={ServicesPage} />
      <Route path="/gallery" component={GalleryPage} />
      <Route path="/portfolio" component={GalleryPage} />
      <Route path="/venues" component={VenuesPage} />
      <Route path="/contact" component={ContactPage} />
      <Route path="/about" component={AboutPage} />
      <Route path="/weddings" component={WeddingsPage} />
      <Route path="/sweet-16" component={Sweet16Page} />
      <Route path="/quinceanera" component={QuincePage} />
      <Route path="/mitzvah" component={MitzvahPage} />
      <Route path="/corporate" component={CorporatePage} />
      <Route path="/birthday" component={BirthdayPage} />
      <Route path="/school" component={SchoolPage} />
      <Route path="/private-party" component={PrivatePartyPage} />
      <Route path="/partners" component={PartnersPage} />
      <Route path="/stories/rob-krista" component={StoryPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <ErrorBoundary>
            <Router />
          </ErrorBoundary>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
