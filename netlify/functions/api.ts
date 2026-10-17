import { handleApi } from "../../server/api.ts";
import { functionEnvFrom } from "../../server/function-env.ts";

declare const Netlify: {
  env: { get: (name: string) => string | undefined };
};

function netlifyGet(name: string): string | undefined {
  try {
    return Netlify.env.get(name);
  } catch {
    return undefined;
  }
}

export default (request: Request, context: { deploy?: { context?: string; published?: boolean } }) =>
  handleApi(request, {
    ...functionEnvFrom(process.env, netlifyGet),
    // Runtime deploy metadata is authoritative; CONTEXT is otherwise build-only.
    SIGNAL_CALL_COORDINATION: "required",
    CONTEXT: context.deploy?.context ?? "unknown",
    SIGNAL_DEPLOY_PUBLISHED: context.deploy?.published === true ? "true" : "false",
  });

export const config = {
  path: ["/api/*", "/.netlify/functions/api/*"],
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip", "domain"],
    windowSize: 60,
    windowLimit: 60,
  },
};
