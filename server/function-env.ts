export const SECRET_ENV = [
  "TMAP_APP_KEY",
  "KAKAO_REST_API_KEY",
  "SEOUL_TDATA_API_KEY",
  "UTIC_SERVICE_KEY",
  "DATA_GO_KR_SERVICE_KEY",
  "SIGNAL_VERIFIED_JSON",
] as const;

export const FUNCTION_ENV = [
  ...SECRET_ENV,
  "SIGNAL_PREDICTION_SCOPES",
  "SIGNAL_PUBLIC_PREDICTION",
  "SIGNAL_VERIFIED_PATH",
] as const;

export type FunctionEnv = Record<string, string | undefined>;

export function functionEnvFrom(
  processEnv: FunctionEnv,
  netlifyGet?: (name: string) => string | undefined,
): FunctionEnv {
  const env: FunctionEnv = { ...processEnv };
  if (!netlifyGet) return env;
  for (const name of FUNCTION_ENV) {
    try {
      const v = netlifyGet(name);
      if (v !== undefined) env[name] = v;
    } catch {
      /* Netlify.env is only present in the Functions runtime. */
    }
  }
  return env;
}

export function vitePrefixedSecretNames(env: FunctionEnv): string[] {
  return SECRET_ENV.filter((name) => !!env[`VITE_${name}`]?.trim()).map(
    (name) => `VITE_${name}`,
  );
}
