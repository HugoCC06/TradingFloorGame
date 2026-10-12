import { Panel } from '../../ui/components';

export function Help() {
  return (
    <div style={{ maxWidth: 980 }}>
      <div className="page-h"><div><h1>How to play</h1><div className="sub">Build a lasting investment firm in a fictional market. There is no fixed ending — play until you retire the fund or it fails.</div></div></div>
      <div className="grid g2">
        <Panel title="The daily loop">
          <ol className="small" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
            <li>Pre-market: read overnight news, check the calendar and your book.</li>
            <li>Queue orders, then press <b>Open market</b> (Space). The session runs 09:30–16:00.</li>
            <li>React to news: prices respond to earnings, macro data and corporate stories.</li>
            <li>Watch the Risk page — breaches upset clients, margin calls force liquidation.</li>
            <li>At 16:00 review the daily report: P&L, movers, client flows, rivals.</li>
            <li>After hours: talk to clients, pitch prospects, hire, manage costs.</li>
            <li>Press <b>Next day</b> (Shift+Enter) and repeat.</li>
          </ol>
        </Panel>
        <Panel title="Orders">
          <div className="small" style={{ lineHeight: 1.6 }}>
            <p><b>Market</b> orders fill immediately at the current price plus half the bid/ask spread and market impact (bigger orders move the price more). Outside hours they fill at the next open — which may gap.</p>
            <p><b>Limit</b> orders fill only at your price or better. <b>Stop</b> orders become market orders once the price trades through the stop; gaps can fill you worse than the stop.</p>
            <p><b>Buy/Sell</b> manage long positions. <b>Short/Cover</b> manage short positions: you borrow and sell, profit if the price falls, and pay a daily borrow fee. Short proceeds stay as collateral.</p>
          </div>
        </Panel>
        <Panel title="Two separate businesses">
          <div className="small" style={{ lineHeight: 1.6 }}>
            <p><b>The fund</b> belongs to investors. Its NAV is cash plus long positions minus short liabilities. Returns are measured per unit, so new money or withdrawals never count as profit or loss.</p>
            <p><b>The management company</b> is yours. It earns ~2% management fees and ~20% performance fees above each client's high-water mark, and pays salaries, rent and running costs. If it runs out of cash for too long, it goes bankrupt — even if the fund is doing well.</p>
          </div>
        </Panel>
        <Panel title="Risk limits">
          <ul className="small" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
            <li>Single position ≤ 20% of NAV (broad-market ETFs exempt)</li>
            <li>Single sector ≤ 40% of NAV (gross)</li>
            <li>Gross exposure ≤ prime-broker limit (250% / 200% / 160% by difficulty)</li>
            <li>Margin utilisation ≤ 80%; at 100% positions are force-sold at penalty prices</li>
            <li>Large drawdowns erode client confidence; a catastrophic drawdown ends the fund</li>
          </ul>
        </Panel>
        <Panel title="Clients & growth">
          <div className="small" style={{ lineHeight: 1.6 }}>
            <p>Each client has return expectations, drawdown tolerance and sometimes mandate restrictions. Confidence below 40 risks redemptions (with notice periods). Calls, dinners, letters and fee concessions help — at a cost.</p>
            <p>Prospects arrive based on reputation, performance, IR staff, office and marketing. Pitching costs money; the win chance and its drivers are shown before you commit.</p>
          </div>
        </Panel>
        <Panel title="Failure">
          <div className="small" style={{ lineHeight: 1.6 }}>
            <p>A single bad day never ends the game. The fund fails if NAV is wiped out, the drawdown exceeds the difficulty's collapse threshold, the company stays insolvent past its grace period, the fund stays below $1M or client confidence stays near zero for 10 days, or nearly all clients redeem. Countdown banners warn you first.</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
