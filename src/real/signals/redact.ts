const KEY_FIELDS = [
  "apiKey",
  "apikey",
  "serviceKey",
  "ServiceKey",
  "Authorization",
  "appKey",
];

export function redactText(text: string, secrets: string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    out = out.split(secret).join("[redacted]");
  }
  for (const field of KEY_FIELDS) {
    const re = new RegExp(`(${field}=)([^&\\s"]+)`, "gi");
    out = out.replace(re, "$1[redacted]");
  }
  out = out.replace(/(KakaoAK|Bearer)\s+\S+/gi, "$1 [redacted]");
  return out;
}

export function redactValue(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, secrets));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (KEY_FIELDS.some((f) => f.toLowerCase() === k.toLowerCase()))
        out[k] = "[redacted]";
      else out[k] = redactValue(v, secrets);
    }
    return out;
  }
  return value;
}
