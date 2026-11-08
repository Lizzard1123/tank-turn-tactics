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
supabase link --project-ref <project-ref>
supabase db push
supabase functions deploy register,signin,action,game-create,game-join,game-start,game-list,game-get,tick,bot-fill
supabase secrets set CRON_SECRET=<random>
```

After linking, update the `<project-ref>` placeholder in
`supabase/migrations/0003_cron.sql` to your real project ref and re-run
`supabase db push` (or run the cron.schedule statement manually in the SQL
editor).
