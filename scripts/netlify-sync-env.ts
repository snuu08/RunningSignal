import { spawnSync } from "node:child_process";
import { loadEnv } from "vite";

const env = {
  ...process.env,
  ...loadEnv("development", process.cwd(), ""),
  ...loadEnv("production", process.cwd(), ""),
};

const jobs: {
  name: string;
  value: string;
  secret?: boolean;
  scope?: string;
}[] = [
  {
    name: "TMAP_APP_KEY",
    value: env.TMAP_APP_KEY?.trim() ?? "",
    secret: true,
  },
  {
    name: "KAKAO_REST_API_KEY",
    value: env.KAKAO_REST_API_KEY?.trim() ?? "",
    secret: true,
  },
  {
    name: "VITE_MAPTILER_KEY",
    value: env.VITE_MAPTILER_KEY?.trim() ?? "",
    scope: "builds",
  },
  {
    name: "VITE_MAPTILER_STYLE",
    value: env.VITE_MAPTILER_STYLE?.trim() || "dataviz-dark",
    scope: "builds",
  },
  {
    name: "SIGNAL_PUBLIC_PREDICTION",
    value: "false",
    scope: "functions",
  },
];

for (const job of jobs) {
  if (!job.value) {
    console.log(JSON.stringify({ name: job.name, set: false, reason: "missing-locally" }));
    continue;
  }
  const args = [
    "--yes",
    "netlify",
    "env:set",
    job.name,
    job.value,
    "--force",
  ];
  if (job.secret) {
    args.push("--secret", "--context", "production", "--context", "deploy-preview", "--context", "branch-deploy");
  }
  if (job.scope) args.push("--scope", job.scope);
  const bin = process.platform === "win32" ? "npx.cmd" : "npx";
  const r = spawnSync(bin, args, {
    encoding: "utf8",
    windowsHide: true,
    env: process.env,
    shell: process.platform === "win32",
  });
  const raw = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error?.message ?? ""}`;
  const redacted = raw.split(job.value).join("[redacted]").replace(/\s+/g, " ").slice(0, 400);
  console.log(
    JSON.stringify({
      name: job.name,
      set: r.status === 0,
      secret: !!job.secret,
      scope: job.scope ?? "all",
      length: job.value.length,
      status: r.status,
      cli: redacted,
    }),
  );
}
