// Keep long authenticated machine RPCs alive beyond their 120-second deadline.
// The compiled Hub loads this explicit preload via BUN_OPTIONS.
const originalServe = Bun.serve.bind(Bun);
Bun.serve = ((options: Parameters<typeof Bun.serve>[0]) =>
    originalServe({ ...options, idleTimeout: 180 })) as typeof Bun.serve;
