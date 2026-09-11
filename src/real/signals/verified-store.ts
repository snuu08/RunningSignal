import { readFileSync } from "node:fs";
import {
  EMPTY_VERIFIED_BUNDLE,
  parseVerifiedBundle,
  type VerifiedBundle,
} from "./provider.ts";

export function loadVerifiedBundle(env: Record<string, string | undefined> = process.env): VerifiedBundle {
  const inline = env.SIGNAL_VERIFIED_JSON?.trim();
  if (inline) {
    try {
      return parseVerifiedBundle(JSON.parse(inline));
    } catch {
      return EMPTY_VERIFIED_BUNDLE;
    }
  }
  const path = env.SIGNAL_VERIFIED_PATH?.trim() || "data/signals/verified/bundle.json";
  try {
    return parseVerifiedBundle(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return EMPTY_VERIFIED_BUNDLE;
  }
}
