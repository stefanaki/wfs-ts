import type { OwsException } from "../errors";
import {
  collectNodesByLocalName,
  collectTextValuesByLocalName,
  parseXml
} from "./helpers";

export function isLikelyOwsExceptionPayload(payload: unknown): boolean {
  if (typeof payload === "string") {
    return payload.includes("ExceptionReport") || payload.includes("exceptionCode");
  }

  if (!payload || typeof payload !== "object") {
    return false;
  }

  const record = payload as Record<string, unknown>;
  if (
    "ExceptionReport" in record ||
    "exceptionReport" in record ||
    "Exception" in record ||
    "exceptions" in record
  ) {
    return true;
  }

  const error = record.error;
  if (typeof error === "string") {
    return error.includes("Exception");
  }

  if (error && typeof error === "object") {
    const nested = error as Record<string, unknown>;
    return (
      "Exception" in nested ||
      "exceptions" in nested ||
      "exceptionCode" in nested
    );
  }

  return false;
}

export function parseOwsExceptionPayload(payload: unknown): OwsException[] {
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    return parseJsonExceptions(payload as Record<string, unknown>);
  }

  if (typeof payload !== "string") {
    return [];
  }

  const xmlObj = parseXml(payload);
  const nodes = collectNodesByLocalName(xmlObj, "Exception");
  if (nodes.length === 0) {
    return [];
  }

  return nodes.map((node) => {
    const exceptionCode = (node["@_exceptionCode"] as string | undefined) ??
      (node["@_code"] as string | undefined);
    const locator = (node["@_locator"] as string | undefined);

    const textCandidates = [
      ...collectTextValuesByLocalName(node, "ExceptionText"),
      ...collectTextValuesByLocalName(node, "exceptionText")
    ];

    return {
      exceptionCode,
      locator,
      text: textCandidates.join("\n") || "Unknown OWS exception"
    };
  });
}

function parseJsonExceptions(payload: Record<string, unknown>): OwsException[] {
  const exceptions: OwsException[] = [];

  const report =
    payload.ExceptionReport ??
    payload.exceptionReport ??
    payload.error ??
    payload;

  if (!report || typeof report !== "object") {
    return exceptions;
  }

  const reportRecord = report as Record<string, unknown>;
  const hasExplicitExceptionContainer =
    "Exception" in reportRecord || "exceptions" in reportRecord;
  const hasInlineExceptionShape =
    "exceptionCode" in reportRecord ||
    "exceptionText" in reportRecord ||
    "locator" in reportRecord ||
    "code" in reportRecord ||
    "text" in reportRecord;

  if (!hasExplicitExceptionContainer && !hasInlineExceptionShape) {
    return exceptions;
  }

  const candidateExceptions =
    reportRecord.Exception ??
    reportRecord.exceptions ??
    report;

  const array = Array.isArray(candidateExceptions)
    ? candidateExceptions
    : [candidateExceptions];

  for (const item of array) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const exceptionText =
      (record.exceptionText as string | undefined) ??
      (record.text as string | undefined);
    const exceptionCode =
      (record.exceptionCode as string | undefined) ??
      (record.code as string | undefined);

    if (!exceptionText && !exceptionCode && !(record.locator as string | undefined)) {
      continue;
    }

    exceptions.push({
      exceptionCode,
      locator: record.locator as string | undefined,
      text: exceptionText ?? "Unknown OWS exception"
    });
  }

  return exceptions;
}
