# Supabase Functions

## Engine vendoring

Edge Functions run the same game engine as the client. The engine sources are
vendored into `_shared/engine_src/` with Deno-style `.ts` import extensions.

To re-sync after editing `packages/engine/src/`:

```bash
cp ../../packages/engine/src/{types,rng,geom,state,reducer,replay,bots,errors,index}.ts _shared/engine_src/
sed -i '' "s|from './types'|from './types.ts'|; s|from './rng'|from './rng.ts'|; s|from './geom'|from './geom.ts'|; s|from './state'|from './state.ts'|; s|from './reducer'|from './reducer.ts'|; s|from './replay'|from './replay.ts'|; s|from './bots'|from './bots.ts'|; s|from './errors'|from './errors.ts'|" _shared/engine_src/*.ts
```

(Linux: drop the `''` after `sed -i`.)

## Local development

```bash
supabase start
supabase functions serve --env-file ./supabase/.env.local
```

`.env.local` needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — copy
`supabase/.env.example` and print the values with `supabase status`.

## Deploy

```bash
supabase link --project-ref sifbpmpxyiycbupntobl
supabase db push
supabase functions deploy register,signin,action,game-create,game-join,game-start,game-list,game-get,game-update,tick,bot-fill
supabase secrets set CRON_SECRET=<random>
```

**GitHub integration:** this project is linked to the GitHub repo via the
Supabase dashboard — pushes to `main` apply new migrations and deploy edge
functions automatically. 0003's cron URL is already set to this project.

The cron schedule in 0003 presents `CRON_SECRET` (set with
`supabase secrets set`) as the bearer token; tick checks it against the
`app.cron_secret` database setting:

```sql
alter database postgres set app.cron_secret = '<same value as CRON_SECRET>';
```
