import { controller } from '../../app/controller';
import { go } from '../../app/router';
import { useGame } from '../../app/store';

interface Step { title: string; text: string; screen?: string; done?: (s: ReturnType<typeof useGame>) => boolean; action?: string }

const STEPS: Step[] = [
  { title: 'Welcome to the trading floor', text: 'You run a hedge fund. Investors gave you capital; your job is to grow it without blowing up. This Terminal is your cockpit: watchlist on the left, chart in the middle, news and your book on the right.' },
  { title: 'Read the overnight news', text: 'Before the open, scan the news feed. Earnings, central-bank decisions and company stories move prices — and the calendar shows what is coming next.', screen: 'terminal' },
  { title: 'Place your first order', text: 'Pick an instrument from the watchlist, choose Buy, enter a quantity (try the 5% button) and submit. Before the open, orders queue and fill at the opening price.', done: (s) => s.orders.length > 0 },
  { title: 'Open the market', text: 'Press ▶ Open market (or Space). Time runs at the selected speed; pause any time. Use +15m or "To close" to move faster.', done: (s) => s.clock.phase !== 'pre' },
  { title: 'Watch your risk', text: 'Positions above 20% of NAV, sector concentration above 40%, or excessive leverage trigger risk breaches that upset clients. Margin calls force liquidation at bad prices.' },
  { title: 'Run the business', text: 'Your management company earns fees and pays salaries and rent — keep it solvent. After the close, review the daily report, talk to clients, hire staff and pitch new investors. Good luck!' },
];

export function Tutorial() {
  const state = useGame();
  const i = state.tutorialStep;
  if (i < 0 || i >= STEPS.length || state.status !== 'active') return null;
  const step = STEPS[i];
  const complete = step.done ? step.done(state) : true;
  const next = () => controller.act((s) => { s.tutorialStep = i + 1 >= STEPS.length ? -1 : i + 1; });
  const skip = () => controller.act((s) => { s.tutorialStep = -1; });
  return (
    <div className="tutorial" role="dialog" aria-label="Tutorial">
      <div className="spread mb">
        <b>{step.title}</b>
        <span className="small dim">{i + 1} / {STEPS.length}</span>
      </div>
      <p className="muted">{step.text}</p>
      <div className="spread">
        <button className="btn ghost sm" onClick={skip}>Skip tutorial</button>
        <div className="row">
          {step.screen && <button className="btn sm" onClick={() => go(step.screen!)}>Show me</button>}
          <button className="btn primary sm" onClick={next} disabled={!complete}>{complete ? (i === STEPS.length - 1 ? 'Finish' : 'Next') : 'Waiting…'}</button>
        </div>
      </div>
    </div>
  );
}
