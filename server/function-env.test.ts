import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  functionEnvFrom,
  vitePrefixedSecretNames,
} from "./function-env.ts";

describe("function env", () => {
  it("lets Netlify.env override process.env for server-only names", () => {
    const env = functionEnvFrom(
      { TMAP_APP_KEY: "from-process", KAKAO_REST_API_KEY: "from-process" },
      (name) => (name === "TMAP_APP_KEY" ? "from-netlify" : undefined),
    );
    expect(env.TMAP_APP_KEY).toBe("from-netlify");
    expect(env.KAKAO_REST_API_KEY).toBe("from-process");
  });

  it("keeps process.env when Netlify.env is missing", () => {
    const env = functionEnvFrom({ TMAP_APP_KEY: "from-process" });
    expect(env.TMAP_APP_KEY).toBe("from-process");
  });

  it("rejects VITE_ aliases of server secrets", () => {
    expect(
      vitePrefixedSecretNames({ VITE_TMAP_APP_KEY: "leaked" }),
    ).toEqual(["VITE_TMAP_APP_KEY"]);
    expect(vitePrefixedSecretNames({ TMAP_APP_KEY: "ok" })).toEqual([]);
  });
});

describe("client source", () => {
  it("does not read server secrets through import.meta.env", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const text = readFileSync(path, "utf8");
        if (
          /import\.meta\.env\.(TMAP_|KAKAO_REST_|SEOUL_TDATA_|UTIC_|DATA_GO_)/.test(
            text,
          ) ||
          /import\.meta\.env\.VITE_(TMAP_|KAKAO_REST_|SEOUL_TDATA_|UTIC_|DATA_GO_)/.test(
            text,
          )
        )
          hits.push(path);
      }
    };
    walk("src");
    expect(hits).toEqual([]);
  });
});
