# Implementation checklist

Status against the design brief's definition of done. ✅ means implemented and exercised by automated tests or a browser run. ⚠️ means implemented with a documented limitation.

## Product
- ✅ Guest play with no account: intro → main menu → New game → terminal
- ✅ Skippable intro; main menu with Continue, New game, Load, Achievements, Career, Settings, How to play and Credits (Login appears when cloud is configured)
- ✅ New-game setup: name, description, six logo marks, colours, difficulty (Easy/Normal/Hard; Expert can be added in `config/difficulty.ts`), three starting presets, tutorial, optional seed
- ✅ Difficulty changes the simulation: volatility, drift, event frequency, shock size, crises, client sensitivity and expectations, rival skill and marketing, costs, leverage, margin, collapse and insolvency thresholds, poaching (tests: "hard markets are more volatile", "difficulty sets different limits")
- ✅ Endless sandbox; quitting to the menu autosaves
- ✅ Fictional market: 216 equities, 26 ETFs, 6 commodities (248 instruments, seeded)
- ✅ All core screens work: Terminal, Markets, Instrument, Portfolio, Orders, News, Research, Risk, Clients, Rivals, Team, Business, Daily report, Settings, Saves, Achievements, Career, Help, Game over
- ✅ News system: 83 templates, multi-day chains, scheduled earnings and macro releases, Hard-only crises
- ✅ Clients respond to performance, drawdowns, breaches, mandates, rivals, reputation and relationship
- ✅ Seven rivals with distinct strategies and persistent histories
- ✅ Employees (analyst, PM, IR), office tiers and automation all have concrete effects
- ✅ Failure flow, game-over report and restart (E2E)

## Simulation
- ✅ Deterministic seeded engine; save/resume continues the identical path (tested for IndexedDB and JSON)
- ✅ Candles valid across all timeframes, which are aggregations of one history (tested)
- ✅ Market, limit and stop orders with gaps; shorting with collateral and borrow; margin and forced liquidation (tested)
- ✅ Accounting invariants (tested)
- ✅ Risk limits: warnings, client and reputation impact, risk review decision, optional pre-trade blocking, prime-broker gross limit, margin liquidation
- ✅ Fund NAV and management-company ledgers are separate (tested)
- ✅ Client flows don't create returns (tested)
- ✅ Events affect the right instruments, tested against a counterfactual world
- ✅ Pause, speeds, +15 minutes, next event, run to close, next day
- ⚠️ No partial fills (orders over 10% of ADV are rejected; square-root impact otherwise)
- ⚠️ Commodities trade equity hours as simplified per-unit exposure contracts

## Persistence
- ✅ IndexedDB saves: one autosave per game (hourly and at each close), five manual slots, metadata, timestamps
- ✅ Schema version and migration framework; validation on save and load; corrupt saves fail gracefully; backup copy restored automatically
- ✅ Export and import of JSON save files
- ✅ Career history and achievements persist across runs
- ✅ Settings persist (localStorage)
- ⚠️ Supabase cloud saves, auth, profile sync and guest-to-account transfer are implemented behind environment variables, but couldn't be verified end-to-end without a live project

## Quality
- ✅ Strict TypeScript and ESLint clean
- ✅ 64 Vitest tests and 3 Playwright E2E tests passing
- ✅ Production build succeeds
- ✅ Checked in Chromium at desktop and phone widths; no runtime errors in a multi-day 80× session
- ✅ Deployment guide (Cloudflare Pages, Vercel, Netlify, static)
- ❌ Not published to a public URL: deployment requires the owner's hosting account

## Assumptions
- Exchange time is shown as-is (no time zones). Fictional dates start in 2031 and vary with the seed.
- Reported fund returns are gross of fees (time-weighted NAV per unit). A representative net-of-fee 2/20 index is shown alongside.
- Performance fees crystallise every 21 trading days to keep game pacing reasonable (real funds usually crystallise annually).
