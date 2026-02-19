import type {
  CapabilitiesOperationBinding,
  ParsedCapabilities,
  WfsOperation
} from "../types";
import {
  collectNodesByLocalName,
  getNodeByLocalName,
  localName,
  parseXml,
  valueText
} from "./helpers";

const operationNameMap: Record<string, WfsOperation> = {
  GetCapabilities: "GetCapabilities",
  DescribeFeatureType: "DescribeFeatureType",
  GetFeature: "GetFeature",
  GetFeatureWithLock: "GetFeatureWithLock",
  GetPropertyValue: "GetPropertyValue",
  Transaction: "Transaction",
  LockFeature: "LockFeature",
  ListStoredQueries: "ListStoredQueries",
  DescribeStoredQueries: "DescribeStoredQueries",
  CreateStoredQuery: "CreateStoredQuery",
  DropStoredQuery: "DropStoredQuery"
};

export function parseCapabilities(payload: unknown): ParsedCapabilities {
  if (typeof payload !== "string") {
    return {
      operations: {},
      raw: payload
    };
  }

  const xml = parseXml(payload);
  const capabilitiesNode = getNodeByLocalName(xml, "WFS_Capabilities") ??
    getNodeByLocalName(xml, "WMT_MS_Capabilities") ??
    getNodeByLocalName(xml, "Capabilities");

  const version =
    (capabilitiesNode as Record<string, unknown> | undefined)?.["@_version"] as
      | string
      | undefined;

  const operationNodes = collectNodesByLocalName(xml, "Operation");
  const operations: ParsedCapabilities["operations"] = {};

  for (const operationNode of operationNodes) {
    const name = operationNode["@_name"] as string | undefined;
    if (!name || !(name in operationNameMap)) {
      continue;
    }

    const binding: CapabilitiesOperationBinding = {};
    const getNodes = collectNodesByLocalName(operationNode, "Get");
    const postNodes = collectNodesByLocalName(operationNode, "Post");

    const getHref =
      (getNodes[0]?.["@_xlink:href"] as string | undefined) ??
      (getNodes[0]?.["@_href"] as string | undefined);
    const postHref =
      (postNodes[0]?.["@_xlink:href"] as string | undefined) ??
      (postNodes[0]?.["@_href"] as string | undefined);

    if (getHref) {
      binding.get = getHref;
    }
    if (postHref) {
      binding.post = postHref;
    }

    operations[operationNameMap[name]] = binding;
  }

  const serviceIdentification = getNodeByLocalName(xml, "ServiceIdentification");
  const title = firstChildTextByLocalName(serviceIdentification, "Title");
  const abstract = firstChildTextByLocalName(serviceIdentification, "Abstract");

  return {
    version,
    serviceIdentification: {
      title,
      abstract
    },
    operations,
    raw: xml
  };
}

function firstChildTextByLocalName(
  node: Record<string, unknown> | undefined,
  expected: string
): string | undefined {
  if (!node) {
    return undefined;
  }

  for (const [key, value] of Object.entries(node)) {
    if (localName(key) === expected) {
      return valueText(value);
    }
  }

  return undefined;
}
