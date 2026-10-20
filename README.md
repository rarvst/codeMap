# codeMap

"Where is CODE?" — a 3D globe of Babson CODE members. Members sign in with Google and add themselves.

## Run locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Supabase setup (one time)

1. **Database:** Supabase dashboard → SQL Editor → New query → paste `supabase/schema.sql` → Run.
2. **Google sign-in:**
   - Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application).
   - Authorized redirect URI: `https://ddnmsopebsifmibjpnwp.supabase.co/auth/v1/callback`
   - Supabase → Authentication → Sign In / Providers → Google → enable, paste the client ID and secret.
3. **Allowed redirect URLs:** Supabase → Authentication → URL Configuration
   - Site URL: where the site is hosted (e.g. `https://<you>.github.io/codeMap/`)
   - Redirect URLs: add `http://localhost:8000/` and the hosted URL.

`config.js` holds the project URL and the **publishable** key, which are safe to publish. Never put the secret key in this repo.
