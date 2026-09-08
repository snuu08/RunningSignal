import { handleApi } from "../../server/api.ts";

export default (request: Request) => handleApi(request, process.env);

export const config = {
  path: "/api/*",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip", "domain"],
    windowSize: 60,
    windowLimit: 60,
  },
};
