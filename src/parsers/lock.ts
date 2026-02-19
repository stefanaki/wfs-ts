import type { LockResult } from "../types";
import {
  collectTextValuesByLocalName,
  collectNodesByLocalName,
  getNodeByLocalName,
  parseXml,
} from "./helpers";

export function parseLockResult(payload: unknown): LockResult {
  if (typeof payload !== "string") {
    return {
      lockId: undefined,
      lockedResourceIds: [],
      notLockedResourceIds: [],
      raw: payload
    };
  }

  const parsed = parseXml(payload);
  const lockNode = getNodeByLocalName(parsed, "LockFeatureResponse");

  if (!lockNode) {
    return {
      lockId: undefined,
      lockedResourceIds: [],
      notLockedResourceIds: [],
      raw: parsed
    };
  }

  const lockId =
    (lockNode["@_lockId"] as string | undefined) ??
    (lockNode["@_lockid"] as string | undefined) ??
    collectTextValuesByLocalName(lockNode, "LockId")[0];

  return {
    lockId,
    lockedResourceIds: collectResourceIds(lockNode, "FeaturesLocked"),
    notLockedResourceIds: collectResourceIds(lockNode, "FeaturesNotLocked"),
    raw: parsed
  };
}

function collectResourceIds(
  lockNode: Record<string, unknown>,
  localName: "FeaturesLocked" | "FeaturesNotLocked"
): string[] {
  const resultNode = getNodeByLocalName(lockNode, localName);
  if (!resultNode) {
    return [];
  }

  const resourceIds = collectNodesByLocalName(resultNode, "ResourceId")
    .map(
      (node) =>
        (node["@_rid"] as string | undefined) ??
        (node["@_fid"] as string | undefined)
    )
    .filter((value): value is string => !!value);

  const featureIds = collectNodesByLocalName(resultNode, "FeatureId")
    .map(
      (node) =>
        (node["@_fid"] as string | undefined) ??
        (node["@_id"] as string | undefined)
    )
    .filter((value): value is string => !!value);

  return [...resourceIds, ...featureIds];
}
