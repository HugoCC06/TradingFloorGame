import { Component, useEffect, useState, type ReactNode } from 'react';
import { controller } from './controller';
import { go, useRoute } from './router';
import { useGameMaybe, useSettings } from './store';
import { updateSettings } from './settings';
import type { GameSetup } from '../game/types';
import { Shell } from '../features/shell/Shell';
import { Terminal } from '../features/terminal/Terminal';
import { Markets } from '../features/markets/Markets';
import { InstrumentPage } from '../features/markets/Instrument';
import { Portfolio } from '../features/portfolio/Portfolio';
import { Orders } from '../features/orders/Orders';
import { News } from '../features/news/News';
import { Research } from '../features/research/Research';
import { Risk } from '../features/risk/Risk';
import { Clients } from '../features/clients/Clients';
import { Rivals } from '../features/rivals/Rivals';
import { Team } from '../features/team/Team';
import { Business } from '../features/business/Business';
import { Report } from '../features/report/Report';
import { AchievementsView, CareerView } from '../features/meta/Achievements';
import { SettingsView } from '../features/meta/Settings';
import { SavesView } from '../features/meta/Saves';
import { Help } from '../features/meta/Help';
import { GameOver } from '../features/meta/GameOver';
import { Intro } from '../features/onboarding/Intro';
import { Credits, MainMenu, type MenuView } from '../features/onboarding/MainMenu';
import { NewGame } from '../features/onboarding/NewGame';
import { Wordmark } from '../ui/components';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(e: Error) { console.error(e); }
  render() {
    if (this.state.error) {
      return (
        <div className="setup">
          <h1>Something went wrong</h1>
          <p className="muted mt">{this.state.error.message}</p>
          <p className="muted">Your last autosave is intact. Reload to return to the main menu.</p>
          <div className="row mt">
            <button className="btn primary" onClick={() => { location.hash = ''; location.reload(); }}>Reload</button>
            {controller.state && <button className="btn" onClick={() => { void controller.save(controller.slot ?? 'slot5', 'Recovery save'); }}>Try saving now</button>}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function GameScreens({ onNewGame }: { onNewGame: () => void }) {
  const route = useRoute();
  let body: ReactNode;
  switch (route.screen) {
    case 'markets': body = <Markets />; break;
    case 'instrument': body = <InstrumentPage id={route.id} />; break;
    case 'portfolio': body = <Portfolio />; break;
    case 'orders': body = <Orders />; break;
    case 'news': body = <News id={route.id} />; break;
    case 'research': body = <Research />; break;
    case 'risk': body = <Risk />; break;
    case 'clients': body = <Clients id={route.id} />; break;
    case 'rivals': body = <Rivals />; break;
    case 'team': body = <Team />; break;
    case 'business': body = <Business />; break;
    case 'report': body = <Report />; break;
    case 'achievements': body = <AchievementsView />; break;
    case 'career': body = <CareerView />; break;
    case 'settings': body = <SettingsView />; break;
    case 'saves': body = <SavesView />; break;
    case 'help': body = <Help />; break;
    case 'gameover': body = <GameOver onNewGame={onNewGame} />; break;
    default: body = <Terminal />;
  }
  return <Shell>{body}</Shell>;
}

export function App() {
  const settings = useSettings();
  const state = useGameMaybe();
  const [intro, setIntro] = useState(() => { try { return !sessionStorage.getItem('tf.intro'); } catch { return true; } });
  const [mode, setMode] = useState<'menu' | 'setup'>('menu');
  const [menuView, setMenuView] = useState<MenuView>('main');

  useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = settings.theme;
    r.dataset.largeText = String(settings.largeText);
    r.dataset.reduceMotion = String(settings.reduceMotion);
  }, [settings.theme, settings.largeText, settings.reduceMotion]);

  const endIntro = () => { setIntro(false); try { sessionStorage.setItem('tf.intro', '1'); } catch { /* ignore */ } if (!settings.introSeen) updateSettings({ introSeen: true }); };

  const start = async (setup: GameSetup) => {
    await controller.startNew(setup);
    setMode('menu');
    setMenuView('main');
    go('terminal');
  };

  if (intro && !settings.reduceMotion) return <Intro onDone={endIntro} />;

  return (
    <ErrorBoundary>
      {state ? (
        <GameScreens onNewGame={() => { controller.quitToMenu(); location.hash = ''; setMode('setup'); }} />
      ) : mode === 'setup' ? (
        <NewGame onStart={start} onBack={() => setMode('menu')} />
      ) : menuView === 'main' ? (
        <MainMenu onNew={() => setMode('setup')} onView={setMenuView} onContinue={async (slot) => { await controller.loadSlot(slot); go('terminal'); }} />
      ) : (
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px 60px' }}>
          <div className="spread mb"><Wordmark /><button className="btn" onClick={() => setMenuView('main')}>← Main menu</button></div>
          {menuView === 'saves' && <SavesView onLoaded={() => setMenuView('main')} />}
          {menuView === 'achievements' && <AchievementsView />}
          {menuView === 'career' && <CareerView />}
          {menuView === 'settings' && <SettingsView />}
          {menuView === 'help' && <Help />}
          {menuView === 'credits' && <Credits />}
        </div>
      )}
    </ErrorBoundary>
  );
}
