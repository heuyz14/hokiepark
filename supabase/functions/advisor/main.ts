import { createLimiter, handle } from "./handler.ts";

// Entry point for the Supabase Edge Runtime (Deno). Everything testable lives in handler.ts.
declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown; env: { toObject(): Record<string, string> } };

const limiter = createLimiter();
Deno.serve((req) => handle(req, Deno.env.toObject(), { fetch, now: Date.now, limiter }));
