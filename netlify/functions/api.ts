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

export default (request: Request) =>
  handleApi(request, functionEnvFrom(process.env, netlifyGet));

export const config = {
  path: ["/api/*", "/.netlify/functions/api/*"],
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip", "domain"],
    windowSize: 60,
    windowLimit: 60,
  },
};
