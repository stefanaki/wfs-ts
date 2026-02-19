import type { XmlOverride } from "../types";

export function escapeXml(value: unknown): string {
  const str = String(value ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function xmlAttr(name: string, value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return ` ${name}="${escapeXml(value)}"`;
}

export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function maybeTag(tag: string, value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return `<${tag}>${escapeXml(value)}</${tag}>`;
}

export function applyXmlOverrides(xml: string, overrides: XmlOverride[] | undefined): string {
  if (!overrides || overrides.length === 0) {
    return xml;
  }

  return overrides.reduce((acc, override) => {
    const startTag = `<${override.target}`;
    const openIndex = acc.indexOf(startTag);
    if (openIndex === -1) {
      return acc;
    }

    const openEnd = acc.indexOf(">", openIndex);
    if (openEnd === -1) {
      return acc;
    }

    const openingSegment = acc.slice(openIndex, openEnd + 1);
    const selfClosing = openingSegment.trimEnd().endsWith("/>");
    const closeTag = `</${override.target}>`;
    const closeIndex = selfClosing ? -1 : acc.indexOf(closeTag, openEnd + 1);
    if (!selfClosing && closeIndex === -1) {
      return acc;
    }

    const segmentEnd = selfClosing ? openEnd + 1 : closeIndex + closeTag.length;
    const position = override.position ?? "after";

    if (position === "before") {
      return `${acc.slice(0, openIndex)}${override.xml}${acc.slice(openIndex)}`;
    }

    if (position === "replace") {
      return `${acc.slice(0, openIndex)}${override.xml}${acc.slice(segmentEnd)}`;
    }

    return `${acc.slice(0, segmentEnd)}${override.xml}${acc.slice(segmentEnd)}`;
  }, xml);
}

export function pickFirst<T>(...values: Array<T | undefined | null>): T | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}
