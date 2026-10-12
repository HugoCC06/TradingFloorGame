# Simulation & accounting model

Everything below is implemented in `src/game/` and tuned through `src/config/`.

## Time

- Exchange-local time; the session runs 09:30–16:00 = 390 one-minute steps (`calendar.ts`).
- Weekends and fixed-date holidays (Jan 1, Jul 4, Dec 25 — configurable in `calendar.ts`) are skipped.
- Phases: `pre` (overnight news processed, orders queue) → `open` (minute steps) → `closed` (end-of-day processing + report) → `nextDay()`.
- Real-time pacing (`app/settings.ts`): 0.5× = 3 s, 1× = 2 s (~13 real minutes per day), 4×, 20×, 80× per simulated minute.
- Commodities follow the equity session (documented simplification).

## Prices (`market.ts`)

Per minute, log-return for instrument *i*:

```
r_i = β_i·F_mkt + λ_i·F_sector + link_i·r_commodity + macroDrift_i/390
      + clamp(σ_idio·√(profile/390)·ε)  + κ·ln(fair_i / P_i)  + news absorption
```

- `F_mkt` — market factor: regime drift + sentiment + credit + difficulty bias, fat-tailed (Student-t, df 6) shock, regime- and difficulty-scaled volatility.
- `F_sector` — 18 correlated sector factors with sentiment drift.
- Commodity links: energy stocks load on crude, gold miners on gold, metal miners on copper, airlines negatively on crude, food producers negatively on wheat, silver on gold.
- `macroDrift` — each company's growth / rate / inflation sensitivities × decaying macro shock terms.
- Fair value (hidden) — drifts with the company's business trend and absorbs systematic moves daily, so only idiosyncratic mispricing mean-reverts (~1%/day pull).
- Intraday U-shaped volatility/volume profile; per-minute moves bounded (6%) except explicit news jumps.
- ETFs: weighted constituent log-returns + small tracking error.
- Commodities: macro-driven drift (real rates, inflation, geopolitics, supply, growth) + mean reversion to an inflation-drifting anchor.
- Overnight: gap = factor noise (~35% of daily vol) + 70% of any unabsorbed news impact + multi-day news drifts.
- One underlying history: every minute writes the 1-minute bar and extends the 15-minute, hourly and daily bars. 5-minute bars are aggregated on the fly. Retention: 1m 2 sessions, 15m 10 sessions, 1h 60 sessions, daily unlimited (plus ~260 days of generated pre-history).
- Regimes (`macro.ts`): Markov chain bull / neutral / bear / crisis (crisis only on Hard), with transition odds shaped by sentiment and difficulty.

Calibration (Normal): index realised vol ≈ 15–20% annualised; average single-stock daily vol ≈ 2–2.5%.

## News (`events/`)

- 83 data-driven templates (`catalog.ts`) with category, scope, frequency weight, severity, eligibility, text variants, explanation, explicit effect and follow-up branches.
- Effects are only applied through bounded mechanisms in `effects.ts`: `hit` (immediate jump fraction + decaying absorption over N minutes + optional multi-day drift + temporary vol boost), `hitSector` (by sector loading), `hitMarket` (by beta), `hitRates` (by rate sensitivity), macro shifts, fundamentals adjustments.
- Random news hazard ≈ 6 per session × difficulty frequency; a company in an active story is excluded from unrelated random stories; a 3-day cooldown per company.
- Scheduled: quarterly earnings per company (pre-market or after close), CPI, jobs (pre-market), GDP (quarterly), central-bank decisions at 14:00.
- Earnings reaction = surprise (driven by the hidden business trend) × valuation stretch asymmetry + guidance (raised/maintained/cut) + regime + noise — so a beat with a guidance cut can fall. Quarterly dividends are paid on the report date with an ex-dividend price adjustment.
- Rate decisions follow a Taylor-style rule; markets price an expected move, so only the *surprise* moves rate-sensitive assets.

## Orders (`orders.ts`)

| Type | Fill rule |
| --- | --- |
| Market (session) | immediately at price × (1 ± (half-spread + impact)) |
| Market (closed) | queued; fills on the first bar of the next session from the gapped open |
| Limit buy | when bar low × (1+half-spread) ≤ limit, at min(limit, open ask) |
| Limit sell | when bar high × (1−half-spread) ≥ limit, at max(limit, open bid) |
| Stop buy/sell | triggers when the bar trades through the stop; fills like a market order from the worse of stop and bar open (gaps fill worse) |

- Half-spread from instrument (size/quality), × difficulty × regime × vol boost, reduced by PM execution skill.
- Impact = 0.6 × daily vol × √(qty / ADV). Max order 10% of ADV. Commission 1.5 bp (min $1).
- Sides: buy/sell (longs), short/cover (shorts). A position can't flip sign in one order.
- Validation: quantity, prices (±50% band, stop direction), position availability incl. pending orders, shortability, buying power (initial margin ≤ equity), prime-broker gross limit, optional pre-trade risk limits (Risk page toggle / Risk-monitor automation), margin-call state.
- Buying power is re-checked at execution time for triggered orders.

## Accounting (`accounting.ts`)

- All cash in integer cents. Positions: signed quantity + average entry price.
- **NAV = cash + Σ qty × price** (shorts negative). Short proceeds sit in cash but are restricted collateral: **free cash = cash − Σ|short qty| × entry price**; negative free cash is a margin loan.
- Realised P&L on closing trades is gross of commission; commissions are charged to cash once and tracked separately. Spread/impact is embedded in fill prices (reported as information).
- Daily carry: borrow fee on short market value; financing on negative free cash at policy rate + 1.5%; interest on positive free cash at 60% of policy rate.
- Margin: initial/maintenance by asset class (equities 50/30%, shorts 50/35%, ETFs 40/25%, commodities 20/15%), scaled up for very volatile stocks and by difficulty. Utilisation = maintenance requirement / NAV. Risk monitor trims at 90%; prime broker force-liquidates at 100% (penalty costs, reputation and client confidence hit).

## Fund units, flows, fees & performance

- The fund issues units. Subscriptions buy and redemptions cancel units at the closing NAV per unit → AUM changes, **NAV per unit doesn't**.
- Reported investment return = NAV per unit (time-weighted, **gross of fees**, net of trading costs).
- Management fees (per client rate, daily accrual) and performance fees (per client rate, crystallised every 21 trading days above the client's own high-water mark) are charged by cancelling that client's units and transferring cash to the management company. NAV per unit is unaffected; client account values are net of fees.
- `netIndex` tracks the net-of-fee experience of a representative 2/20 investor for display.
- Redemptions are paid from free cash; shortfalls are raised by pro-rata sales of longs (recorded fills, with costs borne by the fund).

## Management company (`company.ts`)

Separate ledger: revenue = fees; expenses = salaries, rent (office tier), technology/overheads (+ per head), marketing budget, automation subscriptions, credit-line interest (12%). Credit line limit = max($250k, 50% of fee run-rate); auto-drawn on shortfalls. Insolvency (negative cash after the line) counts toward a difficulty-dependent grace period.

## Clients (`clients.ts`)

Daily confidence update (transparent "concerns"): blended 20/60-day annualised return vs expectation, drawdown beyond tolerance, mandate breaches (gross, drawdown, share of fund), risk breaches, rivals outperforming, reputation, relationship, PM risk oversight, mean reversion, noise. Negative drivers scale with withdrawal sensitivity × difficulty. Redemption hazard rises below confidence 40; top-ups possible above 72 with good performance. Prospects arrive based on reputation, IR power, office appeal, marketing and recent performance; pitch odds list every factor and hard blockers (track record, minimum AUM, concentration).

## Rivals (`rivals.ts`)

Seven strategies (conservative, growth, value, macro, tech, momentum, market-neutral quant). Each rebalances a real basket from observable data; daily return = Σ weight × actual instrument return + cash yield − fee drag − leverage financing − turnover costs. Difficulty changes selection noise, de-risking competence and marketing strength — never results directly. AUM flows follow 60-day performance relative to the peer median (including the player).

## Failure (`failure.ts`)

Immediate: NAV ≤ 0. After the close: drawdown ≥ collapse threshold (70/55/45% by difficulty); company insolvent ≥ grace days (20/12/7); fund < $1M for 10 days; average client confidence < 15 for 10 days; > 90% of units under redemption notice. Recoverable conditions show countdown banners.
