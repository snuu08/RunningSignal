import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { loadEnv, type Plugin } from "vite";
import { handleApi } from "./server/api.ts";
import {
  SECRET_ENV,
  vitePrefixedSecretNames,
} from "./server/function-env.ts";

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collectFiles(path, acc);
    else acc.push(path);
  }
  return acc;
}

function rejectClientSecretLeak(mode: string): Plugin {
  return {
    name: "reject-client-secret-leak",
    configResolved() {
      const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };
      const leaked = vitePrefixedSecretNames(env);
      if (leaked.length)
        throw new Error(
          `${leaked.join(", ")} must not be set. Server keys stay unprefixed.`,
        );
    },
    closeBundle() {
      const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };
      const dist = join(process.cwd(), "dist");
      try {
        statSync(dist);
      } catch {
        return;
      }
      const files = collectFiles(dist);
      for (const name of SECRET_ENV) {
        const value = env[name]?.trim();
        if (!value || value.length < 8) continue;
        for (const file of files) {
          if (!/\.(js|css|html|json|map|txt|svg)$/i.test(file)) continue;
          const text = readFileSync(file, "utf8");
          if (text.includes(value))
            throw new Error(`${name} leaked into the browser bundle.`);
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  envPrefix: "VITE_",
  plugins: [
    react(),
    rejectClientSecretLeak(mode),
    {
      name: "running-api",
      configureServer(server) {
        server.middlewares.use("/api", async (req, res) => {
          const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };
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
    fileParallelism: false,
    pool: "forks",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "server/**/*.test.ts"],
          isolate: true,
          testTimeout: 20000,
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          isolate: false,
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
    ],
  },
}));
