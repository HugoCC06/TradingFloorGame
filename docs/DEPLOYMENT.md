# Deployment (GitHub Pages)

Trading Floor is a static single-page app. Gameplay never needs a server, and routing uses `#/hash` URLs, so GitHub Pages can host it with no rewrite rules. `vite.config.ts` uses `base: './'`, so the build works at a project sub-path such as `https://<user>.github.io/TradingFloorGame/`.

## One-time setup
1. Merge this branch into `main`.
2. On GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` or run the workflow manually from the **Actions** tab. `.github/workflows/deploy.yml` installs dependencies, runs the unit tests, builds, and publishes `dist/`.
4. The site goes live at `https://hugocc06.github.io/TradingFloorGame/`. The exact URL appears in the workflow run summary.

Every later push to `main` redeploys automatically.

## Optional: accounts and cloud saves
Under **Settings → Secrets and variables → Actions → Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then rerun the workflow. The anon key is a public client key, so a repository variable is fine. Never add the Supabase service-role key. Without these variables, the game runs in guest/local-save mode.

## Local check of the production build
```bash
npm ci
npm run build
npm run preview    # http://localhost:4173
```

## Post-deploy checklist
- Open the URL, skip the intro, start a guest game, place a trade, run to the close, save, reload the page and press **Continue**.
- Check the browser console for errors.
