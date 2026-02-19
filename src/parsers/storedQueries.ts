import type {
  CreateStoredQueryResult,
  DropStoredQueryResult,
  StoredQueryDescription,
  StoredQueryListItem
} from "../types";
import { asArray } from "../utils/xml";
import {
  collectNodesByLocalName,
  collectTextValuesByLocalName,
  getNodeByLocalName,
  parseXml,
  valueText
} from "./helpers";

export function parseListStoredQueries(payload: unknown): StoredQueryListItem[] {
  if (typeof payload !== "string") {
    return [];
  }

  const parsed = parseXml(payload);
  const listNode = getNodeByLocalName(parsed, "ListStoredQueriesResponse");
  if (!listNode) {
    return [];
  }

  const storedQueries = collectNodesByLocalName(listNode, "StoredQuery");
  return storedQueries.map((node) => {
    const id = (node["@_id"] as string | undefined) ?? "";
    const titles = collectTextValuesByLocalName(node, "Title");
    const returnFeatureTypes = collectTextValuesByLocalName(
      node,
      "ReturnFeatureType"
    );

    return {
      id,
      titles,
      returnFeatureTypes
    };
  });
}

export function parseDescribeStoredQueries(payload: unknown): StoredQueryDescription[] {
  if (typeof payload !== "string") {
    return [];
  }

  const parsed = parseXml(payload);
  const describeNode = getNodeByLocalName(parsed, "DescribeStoredQueriesResponse");
  if (!describeNode) {
    return [];
  }

  const descriptions = collectNodesByLocalName(describeNode, "StoredQueryDescription");
  return descriptions.map((node) => ({
    id: (node["@_id"] as string | undefined) ?? "",
    titles: collectTextValuesByLocalName(node, "Title"),
    abstracts: collectTextValuesByLocalName(node, "Abstract"),
    parameters: collectNodesByLocalName(node, "Parameter").map((parameterNode) => ({
      name: (parameterNode["@_name"] as string | undefined) ?? "",
      type: (parameterNode["@_type"] as string | undefined) ?? "xsd:string"
    }))
  }));
}

export function parseCreateStoredQuery(payload: unknown): CreateStoredQueryResult {
  if (typeof payload !== "string") {
    return {
      status: "UNKNOWN",
      raw: payload
    };
  }

  const parsed = parseXml(payload);
  const executionStatus = getNodeByLocalName(parsed, "CreateStoredQueryResponse") ??
    getNodeByLocalName(parsed, "ExecutionStatus");

  return {
    status:
      (executionStatus?.["@_status"] as string | undefined) ??
      (valueText(executionStatus) ?? "OK"),
    raw: parsed
  };
}

export function parseDropStoredQuery(payload: unknown): DropStoredQueryResult {
  if (typeof payload !== "string") {
    return {
      status: "UNKNOWN",
      raw: payload
    };
  }

  const parsed = parseXml(payload);
  const dropNode = getNodeByLocalName(parsed, "DropStoredQueryResponse");

  const status =
    (dropNode?.["@_status"] as string | undefined) ??
    (valueText(dropNode) ?? "OK");

  return {
    status,
    raw: parsed
  };
}

export function parseValueCollection<T = unknown>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (typeof payload !== "string") {
    return [];
  }

  const parsed = parseXml(payload);
  const valueCollectionNode = getNodeByLocalName(parsed, "ValueCollection");
  if (!valueCollectionNode) {
    return [];
  }

  const members = asArray(valueCollectionNode["wfs:member"] ?? valueCollectionNode.member);
  return members
    .map((member) => {
      const tuple = getNodeByLocalName(member, "Tuple");
      if (tuple) {
        return tuple as T;
      }

      if (member && typeof member === "object") {
        const values = Object.entries(member as Record<string, unknown>)
          .filter(([key]) => !key.startsWith("@_"))
          .map(([, value]) => value);
        return values.length === 1 ? (values[0] as T) : (values as T);
      }

      return member as T;
    })
    .filter((value) => value !== undefined) as T[];
}
