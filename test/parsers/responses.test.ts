import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLockResult } from "../../src/parsers/lock";
import {
  parseListStoredQueries,
  parseValueCollection
} from "../../src/parsers/storedQueries";
import { parseTransactionResult } from "../../src/parsers/transaction";

const read = (name: string): string =>
  readFileSync(join(process.cwd(), `test/fixtures/${name}`), "utf8");

describe("response parsers", () => {
  it("parses transaction response", () => {
    const result = parseTransactionResult(read("transaction-response.xml"));
    expect(result.totalInserted).toBe(1);
    expect(result.totalUpdated).toBe(2);
    expect(result.totalDeleted).toBe(3);
    expect(result.insertResults[0]?.resourceIds).toContain("roads.10");
  });

  it("parses lock response", () => {
    const result = parseLockResult(read("lock-response.xml"));
    expect(result.lockId).toBe("lock-123");
    expect(result.lockedResourceIds).toEqual(["roads.1"]);
    expect(result.notLockedResourceIds).toEqual(["roads.2"]);
  });

  it("parses lock response for WFS 1.1 format", () => {
    const result = parseLockResult(read("lock-response-110.xml"));
    expect(result.lockId).toBe("GeoServer");
    expect(result.lockedResourceIds).toEqual(["world_cities.4"]);
    expect(result.notLockedResourceIds).toEqual(["world_cities.2"]);
  });

  it("parses stored query listing", () => {
    const result = parseListStoredQueries(read("list-stored-queries.xml"));
    expect(result[0]?.id).toContain("GetFeatureById");
    expect(result[0]?.returnFeatureTypes).toEqual(["topp:roads"]);
  });

  it("parses value collection", () => {
    const values = parseValueCollection<string>(read("value-collection.xml"));
    expect(values).toEqual(["Road A", "Road B"]);
  });
});
