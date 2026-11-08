// Re-export shim: engine sources are vendored into ./engine_src with
// Deno-compatible .ts import extensions. A sync script keeps them in sync
// with packages/engine/src (see supabase/functions/README.md).
export * from './engine_src/index.ts';
