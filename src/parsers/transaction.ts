import type { ActionResult, TransactionResult } from "../types";
import { asArray } from "../utils/xml";
import {
  collectNodesByLocalName,
  getNodeByLocalName,
  parseXml,
  valueText
} from "./helpers";

export function parseTransactionResult(payload: unknown): TransactionResult {
  if (typeof payload !== "string") {
    return {
      insertResults: [],
      updateResults: [],
      replaceResults: [],
      raw: payload
    };
  }

  const parsed = parseXml(payload);
  const txNode = getNodeByLocalName(parsed, "TransactionResponse");

  if (!txNode) {
    return {
      insertResults: [],
      updateResults: [],
      replaceResults: [],
      raw: parsed
    };
  }

  const summaryNode = getNodeByLocalName(txNode, "TransactionSummary");

  return {
    totalInserted: toNumber(firstByLocalName(summaryNode, "totalInserted")),
    totalUpdated: toNumber(firstByLocalName(summaryNode, "totalUpdated")),
    totalReplaced: toNumber(firstByLocalName(summaryNode, "totalReplaced")),
    totalDeleted: toNumber(firstByLocalName(summaryNode, "totalDeleted")),
    insertResults: parseActionResults(txNode, "InsertResults"),
    updateResults: parseActionResults(txNode, "UpdateResults"),
    replaceResults: parseActionResults(txNode, "ReplaceResults"),
    raw: parsed
  };
}

function parseActionResults(
  txNode: Record<string, unknown>,
  localResultName: "InsertResults" | "UpdateResults" | "ReplaceResults"
): ActionResult[] {
  const node = getNodeByLocalName(txNode, localResultName);
  if (!node) {
    return [];
  }

  const featureNodes = collectNodesByLocalName(node, "Feature");
  return featureNodes.map((featureNode) => {
    const handle = featureNode["@_handle"] as string | undefined;
    const resourceIds = collectNodesByLocalName(featureNode, "ResourceId")
      .map((resourceIdNode) =>
        (resourceIdNode["@_rid"] as string | undefined) ??
        (resourceIdNode["@_fid"] as string | undefined)
      )
      .filter((value): value is string => !!value);

    return {
      handle,
      resourceIds
    };
  });
}

function firstByLocalName(
  node: Record<string, unknown> | undefined,
  name: string
): string | undefined {
  if (!node) {
    return undefined;
  }

  const candidate = asArray((node as Record<string, unknown>)[`wfs:${name}`])[0] ??
    asArray((node as Record<string, unknown>)[name])[0];

  return valueText(candidate);
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}
