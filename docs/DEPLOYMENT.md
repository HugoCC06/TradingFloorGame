# Deployment

Trading Floor is a static single-page app. Gameplay never needs a server. Routing uses `#/hash` URLs, so no SPA rewrite rules are required.

```bash
npm ci
npm run build      # → dist/
npm run preview    # optional local check on http://localhost:4173
```

Build settings for any host:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 20 or 22 |
| Environment (optional) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

## Cloudflare Pages
1. Create a project and connect the repository.
2. Framework preset: *Vite* (or "None"). Build command `npm run build`, output `dist`.
3. Optional: add the Supabase variables under Settings → Environment variables, then redeploy.

## Vercel
1. Import the repository. The *Vite* preset is detected automatically.
2. Optional: add the Supabase variables in Project Settings → Environment Variables.

## Netlify
The included `netlify.toml` sets the build command and publish directory. Import the repo and deploy. Add the optional variables in Site settings → Environment variables.

## Static hosting (S3, GitHub Pages, nginx…)
Upload the contents of `dist/`. The app uses relative asset paths from the site root; for a sub-path deployment set `base` in `vite.config.ts`.

## Cloud saves backend (optional)
See the README section *Optional accounts and cloud saves*. The Supabase project is independent of the static host. If its variables aren't set, the app runs in guest/local mode and hides all account UI.

## Post-deploy checklist
- Open the URL, skip the intro, start a guest game, trade, reach the close, save, reload, then **Continue**.
- Check the browser console for errors.
- With cloud enabled: create an account, save, then load on a second browser.
