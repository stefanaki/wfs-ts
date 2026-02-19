import { XMLParser } from "fast-xml-parser";
import type { AxisOrderStrategy } from "../types";
import { asArray } from "../utils/xml";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: true,
  parseAttributeValue: true,
  allowBooleanAttributes: true
});

export function parseXml(xml: string): unknown {
  return parser.parse(xml);
}

export function localName(name: string): string {
  const index = name.indexOf(":");
  return index >= 0 ? name.slice(index + 1) : name;
}

export function getNodeByLocalName(
  root: unknown,
  expected: string
): Record<string, unknown> | undefined {
  if (!root || typeof root !== "object") {
    return undefined;
  }

  const entries = Object.entries(root as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (localName(key) === expected && value && typeof value === "object") {
      return value as Record<string, unknown>;
    }

    if (value && typeof value === "object") {
      const nested = getNodeByLocalName(value, expected);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

export function collectNodesByLocalName(
  root: unknown,
  expected: string,
  out: Array<Record<string, unknown>> = []
): Array<Record<string, unknown>> {
  if (!root || typeof root !== "object") {
    return out;
  }

  for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
    if (localName(key) === expected) {
      for (const item of asArray(value as unknown)) {
        if (item && typeof item === "object") {
          out.push(item as Record<string, unknown>);
        }
      }
    }

    if (value && typeof value === "object") {
      collectNodesByLocalName(value, expected, out);
    }
  }

  return out;
}

export function collectTextValuesByLocalName(
  root: unknown,
  expected: string,
  out: string[] = []
): string[] {
  if (!root || typeof root !== "object") {
    return out;
  }

  for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
    if (localName(key) === expected) {
      for (const item of asArray(value)) {
        const text = valueText(item);
        if (text !== undefined) {
          out.push(text);
        }
      }
    }

    if (value && typeof value === "object") {
      collectTextValuesByLocalName(value, expected, out);
    }
  }

  return out;
}

export function valueText(node: unknown): string | undefined {
  if (node === null || node === undefined) {
    return undefined;
  }

  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return String(node);
  }

  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    const direct = record["#text"];
    if (direct !== undefined && direct !== null) {
      return String(direct);
    }

    for (const [key, value] of Object.entries(record)) {
      if (key.startsWith("@_")) {
        continue;
      }
      const nested = valueText(value);
      if (nested !== undefined) {
        return nested;
      }
    }
  }

  return undefined;
}

export function parseNumbers(text: string): number[] {
  return text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((v) => Number(v));
}

export function maybeSwap(
  coords: number[],
  strategy: AxisOrderStrategy,
  srsName?: string
): number[] {
  if (coords.length < 2 || strategy === "preserve") {
    return coords;
  }

  const lower = (srsName ?? "").toLowerCase();
  const is4326 = lower.includes("4326");

  if (strategy === "forceLonLat") {
    if (!is4326) {
      return coords;
    }
    return [coords[1], coords[0], ...coords.slice(2)];
  }

  if (strategy === "forceLatLon") {
    if (is4326) {
      return coords;
    }
    return [coords[1], coords[0], ...coords.slice(2)];
  }

  return coords;
}
