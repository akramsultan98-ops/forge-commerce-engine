export async function register() {
  // Only boot inside the Node.js server runtime, never during `next build`.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { bootServer } = await import("./server/boot");
  const { env } = await import("./server/env");
  await bootServer({ startRunner: env().JOB_RUNNER === "embedded" });
}

/** Error-tracking hook for every server-side request error (routes, pages, actions). */
export async function onRequestError(error: unknown, request: { path: string; method: string }, context: { routePath?: string; routeType?: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureException } = await import("./server/errors");
  captureException(error, { path: request.path, method: request.method, route: context.routePath, routeType: context.routeType });
}
