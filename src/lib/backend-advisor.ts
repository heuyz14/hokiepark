import type { Answerer } from "./assistant.ts";
import type { AdvisorAnswer, AdvisorToolEvent } from "./advisor.ts";
import type { AdvisorConfig } from "./advisor-config.ts";
import type { AdvisorContext } from "./advisor-spec.ts";

/** One request per question. Data retrieval, tool execution and model calls happen on the server. */
export function createBackendAnswerer(options: {
  config: AdvisorConfig;
  getContext: () => AdvisorContext;
  fallback: Answerer;
  fetch?: typeof fetch;
  onToolEvent?: (event: AdvisorToolEvent) => void;
}): Answerer {
  let history: { role: "user" | "model"; text: string }[] = [];
  return async (question) => {
    const context = options.getContext();
    let answer: AdvisorAnswer;
    try {
      const response = await (options.fetch ?? fetch)(options.config.url, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: options.config.anonKey, ...(options.config.anonKey.startsWith("eyJ") ? { authorization: `Bearer ${options.config.anonKey}` } : {}) },
        // Never send client clock, occupancy or tool results. Location is sent only for an explicit location question after browser permission.
        body: JSON.stringify({ question, history, context: { permits: context.permits, ada: context.ada, ...(/my location|where i am|from here|near me|current location/i.test(question) && context.currentLocation ? {currentLocation:context.currentLocation} : {}) } }),
        signal: AbortSignal.timeout(35_000),
      });
      if (!response.ok) throw new Error("backend unavailable");
      const body = await response.json() as {answer?: AdvisorAnswer; provenance?: {execution?: string; simulated?: boolean}};
      if (!body.answer || !Array.isArray(body.answer.lines) || !body.answer.lines.length || !body.answer.lines.every((line) => typeof line === "string" && line.length <= 5000) || !Array.isArray(body.answer.refs) || !["ai","basic"].includes(body.answer.source ?? "") || body.provenance?.execution !== "server" || body.provenance.simulated !== true) throw new Error("invalid backend answer");
      answer = body.answer;
      for (const [i, tool] of (answer.tools ?? []).entries()) options.onToolEvent?.({id:`backend-${i}`,name:tool.name,label:`Backend: ${tool.name.replaceAll("_"," ")}`,status:tool.ok?"success":"error"});
    } catch {
      answer = { ...await options.fallback(question), source: "basic", reason: "transport" };
      answer.lines.push("Local fallback: the parking backend was unavailable.");
    }
    history = [...history,{role:"user" as const,text:question.slice(0,300)},{role:"model" as const,text:answer.lines.join("\n").slice(0,2000)}].slice(-6);
    return answer;
  };
}
