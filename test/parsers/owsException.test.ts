import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isLikelyOwsExceptionPayload,
  parseOwsExceptionPayload
} from "../../src/parsers/owsException";

const xml = readFileSync(
  join(process.cwd(), "test/fixtures/exception-report.xml"),
  "utf8"
);

describe("OWS exception parser", () => {
  it("parses XML exception reports", () => {
    const exceptions = parseOwsExceptionPayload(xml);
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]?.exceptionCode).toBe("InvalidParameterValue");
    expect(exceptions[0]?.locator).toBe("outputFormat");
    expect(exceptions[0]?.text).toContain("Unknown output format");
  });

  it("detects likely exception payloads", () => {
    expect(isLikelyOwsExceptionPayload(xml)).toBe(true);
    expect(isLikelyOwsExceptionPayload({ error: "ExceptionReport" })).toBe(true);
    expect(isLikelyOwsExceptionPayload({ ok: true })).toBe(false);
  });
});
