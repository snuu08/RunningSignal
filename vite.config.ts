import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { handleApi } from "./server/api.ts";
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: "running-api",
      configureServer(server) {
        const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };
        server.middlewares.use("/api", async (req, res) => {
          const chunks: Buffer[] = [];
          let length = 0;
          for await (const chunk of req) {
            length += chunk.length;
            if (length > 12000) {
              res.statusCode = 413;
              res.end("Request too large");
              return;
            }
            chunks.push(Buffer.from(chunk));
          }
          const response = await handleApi(
            new Request(`http://localhost/api${req.url}`, {
              method: req.method,
              ...(req.method !== "GET" && req.method !== "HEAD"
                ? { body: Buffer.concat(chunks).toString() }
                : {}),
            }),
            env,
          );
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(await response.text());
        });
      },
    },
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "server/**/*.test.ts"],
    fileParallelism: false,
  },
}));
