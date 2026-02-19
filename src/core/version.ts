import { DEFAULT_WFS_VERSION, SUPPORTED_VERSIONS } from "./constants";
import type { WfsClientConfig, WfsVersion } from "../types";

export function resolveInitialVersion(config: WfsClientConfig): WfsVersion {
  if (!config.versionStrategy || config.versionStrategy === "auto") {
    return DEFAULT_WFS_VERSION;
  }
  return config.versionStrategy;
}

export function getVersionFallbackChain(
  preferred: WfsVersion,
  versionStrategy?: WfsClientConfig["versionStrategy"]
): WfsVersion[] {
  if (versionStrategy && versionStrategy !== "auto") {
    return [versionStrategy];
  }

  const chain: WfsVersion[] = [preferred];
  for (const version of SUPPORTED_VERSIONS) {
    if (!chain.includes(version)) {
      chain.push(version);
    }
  }
  return chain;
}
