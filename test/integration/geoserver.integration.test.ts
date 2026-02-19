import { beforeAll, describe, expect, it } from "vitest";
import { WfsClient } from "../../src/client/WfsClient";
import { OwsExceptionError } from "../../src/errors";
import type { WfsVersion } from "../../src/types";

const run = process.env.RUN_GEOSERVER_TESTS === "1";
const maybeDescribe = run ? describe : describe.skip;
const baseUrl = process.env.GEOSERVER_WFS_URL ?? "http://localhost:8080/geoserver/wfs";
const typeName = process.env.GEOSERVER_TYPENAME ?? "integration:world_cities";
const adminUser = process.env.GEOSERVER_ADMIN_USER ?? "admin";
const adminPassword = process.env.GEOSERVER_ADMIN_PASSWORD ?? "geoserver";

function createClient(version: WfsVersion): WfsClient {
  return new WfsClient({
    baseUrl,
    versionStrategy: version,
    auth: {
      username: adminUser,
      password: adminPassword
    },
    namespaces: {
      integration: "http://integration",
      xs: "http://www.w3.org/2001/XMLSchema"
    },
    geoserver: {
      enabled: true
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatForLog(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function serializeError(error: unknown): unknown {
  if (error instanceof OwsExceptionError) {
    return {
      name: error.name,
      message: error.message,
      context: error.context,
      exceptions: error.exceptions
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return error;
}

async function runLogged<T>(
  testName: string,
  operation: () => Promise<T>
): Promise<T> {
  try {
    const response = await operation();
    console.log(`[integration] ${testName} response\n${formatForLog(response)}`);
    return response;
  } catch (error) {
    console.log(
      `[integration] ${testName} error\n${formatForLog(serializeError(error))}`
    );
    throw error;
  }
}

async function waitForLayerReady(client: WfsClient, layerTypeName: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 120; attempt += 1) {
    try {
      const fc = await client.getFeature({
        typeNames: [layerTypeName],
        count: 1,
        version: "2.0.2",
        requestStyle: "GET"
      });

      if (fc.features.length > 0) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(2_000);
  }

  throw new Error(
    `Layer ${layerTypeName} was not ready after retries. Last error: ${String(
      (lastError as Error | undefined)?.message ?? lastError ?? "unknown"
    )}`
  );
}

async function expectOperationNotSupported(
  testName: string,
  operation: () => Promise<unknown>
): Promise<void> {
  let thrown: unknown;

  try {
    await operation();
  } catch (error) {
    thrown = error;
  }

  console.log(
    `[integration] ${testName} expected error\n${formatForLog(
      serializeError(thrown)
    )}`
  );

  expect(thrown).toBeInstanceOf(OwsExceptionError);
  const owsError = thrown as OwsExceptionError;
  expect(
    owsError.exceptions.some(
      (exception) =>
        (exception.exceptionCode ?? "").toLowerCase() === "operationnotsupported"
    )
  ).toBe(true);
}

maybeDescribe("GeoServer integration", () => {
  const client20 = createClient("2.0.2");
  const client11 = createClient("1.1.0");
  let featureIds: string[] = [];

  const pickFeatureId = (index: number): string => {
    const id = featureIds[index % featureIds.length];
    if (!id) {
      throw new Error("Expected seeded data to include feature ids");
    }
    return id;
  };

  beforeAll(async () => {
    await waitForLayerReady(client20, typeName);
    const fc = await client20.getFeature({
      typeNames: [typeName],
      count: 10,
      version: "2.0.2",
      requestStyle: "GET"
    });

    featureIds = fc.features
      .map((feature) => feature.id)
      .filter((id): id is string | number => id !== undefined && id !== null)
      .map((id) => String(id));

    expect(featureIds.length).toBeGreaterThan(0);
  }, 240_000);

  describe("WFS 2.0.2", () => {
    it("getCapabilities", async () => {
      const capabilities = await runLogged("WFS 2.0.2 getCapabilities", () =>
        client20.getCapabilities({
          version: "2.0.2",
          requestStyle: "GET"
        })
      );

      expect(capabilities.operations.GetCapabilities).toBeDefined();
      expect(capabilities.operations.DescribeFeatureType).toBeDefined();
      expect(capabilities.operations.GetFeature).toBeDefined();
      expect(capabilities.operations.GetFeatureWithLock).toBeDefined();
      expect(capabilities.operations.GetPropertyValue).toBeDefined();
      expect(capabilities.operations.Transaction).toBeDefined();
      expect(capabilities.operations.LockFeature).toBeDefined();
      expect(capabilities.operations.ListStoredQueries).toBeDefined();
      expect(capabilities.operations.DescribeStoredQueries).toBeDefined();
      expect(capabilities.operations.CreateStoredQuery).toBeDefined();
      expect(capabilities.operations.DropStoredQuery).toBeDefined();
    });

    it("describeFeatureType", async () => {
      const described = await runLogged("WFS 2.0.2 describeFeatureType", () =>
        client20.describeFeatureType({
          version: "2.0.2",
          requestStyle: "GET",
          typeNames: [typeName]
        })
      );

      expect(typeof described).toBe("string");
      expect(String(described)).toContain("world_cities");
      expect(String(described)).toContain("xsd:schema");
    });

    it("getFeature", async () => {
      const fc = await runLogged("WFS 2.0.2 getFeature", () =>
        client20.getFeature({
          version: "2.0.2",
          requestStyle: "GET",
          typeNames: [typeName],
          count: 2
        })
      );

      expect(fc.type).toBe("FeatureCollection");
      expect(fc.features.length).toBeGreaterThan(0);
    });

    it("getPropertyValue", async () => {
      const values = await runLogged("WFS 2.0.2 getPropertyValue", () =>
        client20.getPropertyValue<string>({
          version: "2.0.2",
          requestStyle: "GET",
          typeNames: [typeName],
          valueReference: "name",
          count: 2
        })
      );

      expect(values.length).toBeGreaterThan(0);
      expect(typeof values[0]).toBe("string");
    });

    it("transaction", async () => {
      const tx = await runLogged("WFS 2.0.2 transaction", () =>
        client20.transaction({
          version: "2.0.2",
          requestStyle: "POST",
          actions: [
            {
              kind: "update",
              typeName,
              properties: [
                {
                  name: "population",
                  value: 900000 + (Date.now() % 1000)
                }
              ],
              filter: {
                op: "id",
                ids: [pickFeatureId(0)]
              }
            }
          ]
        })
      );

      expect(tx.totalUpdated ?? 0).toBeGreaterThanOrEqual(1);
    });

    it("listStoredQueries", async () => {
      const queries = await runLogged("WFS 2.0.2 listStoredQueries", () =>
        client20.listStoredQueries({
          version: "2.0.2",
          requestStyle: "POST"
        })
      );

      expect(queries.length).toBeGreaterThan(0);
      expect(
        queries.some((query) => query.id.includes("GetFeatureById"))
      ).toBe(true);
    });

    it("describeStoredQueries", async () => {
      const descriptions = await runLogged("WFS 2.0.2 describeStoredQueries", () =>
        client20.describeStoredQueries({
          version: "2.0.2",
          requestStyle: "POST",
          storedQueryIds: ["urn:ogc:def:query:OGC-WFS::GetFeatureById"]
        })
      );

      expect(
        descriptions.some(
          (description) =>
            description.id === "urn:ogc:def:query:OGC-WFS::GetFeatureById"
        )
      ).toBe(true);
    });

    it("createStoredQuery + dropStoredQuery", async () => {
      const storedQueryId = `urn:example:storedquery:cities-by-country-${Date.now()}`;

      const create = await runLogged("WFS 2.0.2 createStoredQuery", () =>
        client20.createStoredQuery({
          version: "2.0.2",
          requestStyle: "POST",
          definitions: [
            {
              id: storedQueryId,
              title: "Cities by country",
              abstract: "Returns cities filtered by country",
              parameters: [
                {
                  name: "country",
                  type: "xs:string"
                }
              ],
              queryExpressionTexts: [
                {
                  returnFeatureTypes: [typeName],
                  language: "urn:ogc:def:queryLanguage:OGC-WFS::WFSQueryExpression",
                  xml:
                    '<wfs:Query xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:integration="http://integration" typeNames="integration:world_cities"><fes:Filter><fes:PropertyIsEqualTo><fes:ValueReference>country</fes:ValueReference><fes:Literal>${country}</fes:Literal></fes:PropertyIsEqualTo></fes:Filter></wfs:Query>'
                }
              ]
            }
          ]
        })
      );
      expect(create.status.toUpperCase()).toContain("OK");

      const described = await runLogged(
        "WFS 2.0.2 describeStoredQueries(created query)",
        () =>
          client20.describeStoredQueries({
            version: "2.0.2",
            requestStyle: "POST",
            storedQueryIds: [storedQueryId]
          })
      );
      expect(described.some((query) => query.id === storedQueryId)).toBe(true);

      const drop = await runLogged("WFS 2.0.2 dropStoredQuery", () =>
        client20.dropStoredQuery({
          version: "2.0.2",
          requestStyle: "POST",
          id: storedQueryId
        })
      );
      expect(drop.status.toUpperCase()).toContain("OK");
    });

    it("getFeatureWithLock", async () => {
      const targetId = pickFeatureId(2);
      const result = await runLogged("WFS 2.0.2 getFeatureWithLock", () =>
        client20.getFeatureWithLock({
          version: "2.0.2",
          requestStyle: "POST",
          typeNames: [typeName],
          filter: {
            op: "id",
            ids: [targetId]
          },
          expiry: 1,
          lockAction: "SOME"
        })
      );

      expect(result.type).toBe("FeatureCollection");
      expect(Array.isArray(result.features)).toBe(true);
    });

    it("lockFeature", async () => {
      const targetId = pickFeatureId(3);
      const lock = await runLogged("WFS 2.0.2 lockFeature", () =>
        client20.lockFeature({
          version: "2.0.2",
          requestStyle: "POST",
          typeNames: [typeName],
          filter: {
            op: "id",
            ids: [targetId]
          },
          expiry: 1,
          lockAction: "SOME"
        })
      );

      expect(lock.lockId).toBeDefined();
      expect([
        ...lock.lockedResourceIds,
        ...lock.notLockedResourceIds
      ]).toContain(targetId);
    });
  });

  describe("WFS 1.1.0", () => {
    it("getCapabilities", async () => {
      const capabilities = await runLogged("WFS 1.1.0 getCapabilities", () =>
        client11.getCapabilities({
          version: "1.1.0",
          requestStyle: "GET"
        })
      );

      expect(capabilities.operations.GetCapabilities).toBeDefined();
      expect(capabilities.operations.DescribeFeatureType).toBeDefined();
      expect(capabilities.operations.GetFeature).toBeDefined();
      expect(capabilities.operations.GetFeatureWithLock).toBeDefined();
      expect(capabilities.operations.Transaction).toBeDefined();
      expect(capabilities.operations.LockFeature).toBeDefined();
      expect(capabilities.operations.ListStoredQueries).toBeUndefined();
      expect(capabilities.operations.DescribeStoredQueries).toBeUndefined();
      expect(capabilities.operations.CreateStoredQuery).toBeUndefined();
      expect(capabilities.operations.DropStoredQuery).toBeUndefined();
    });

    it("describeFeatureType", async () => {
      const described = await runLogged("WFS 1.1.0 describeFeatureType", () =>
        client11.describeFeatureType({
          version: "1.1.0",
          requestStyle: "GET",
          typeNames: [typeName]
        })
      );

      expect(typeof described).toBe("string");
      expect(String(described)).toContain("world_cities");
      expect(String(described)).toContain("xsd:schema");
    });

    it("getFeature", async () => {
      const fc = await runLogged("WFS 1.1.0 getFeature", () =>
        client11.getFeature({
          version: "1.1.0",
          requestStyle: "GET",
          typeNames: [typeName],
          count: 2
        })
      );

      expect(fc.type).toBe("FeatureCollection");
      expect(fc.features.length).toBeGreaterThan(0);
    });

    it("getPropertyValue", async () => {
      const values = await runLogged("WFS 1.1.0 getPropertyValue", () =>
        client11.getPropertyValue<string>({
          version: "1.1.0",
          requestStyle: "GET",
          typeNames: [typeName],
          valueReference: "name",
          count: 2
        })
      );

      expect(values.length).toBeGreaterThan(0);
      expect(typeof values[0]).toBe("string");
    });

    it("transaction", async () => {
      const tx = await runLogged("WFS 1.1.0 transaction", () =>
        client11.transaction({
          version: "1.1.0",
          requestStyle: "POST",
          actions: [
            {
              kind: "update",
              typeName,
              properties: [
                {
                  name: "population",
                  value: 700000 + (Date.now() % 1000)
                }
              ],
              filter: {
                op: "id",
                ids: [pickFeatureId(1)]
              }
            }
          ]
        })
      );

      expect(tx.totalUpdated ?? 0).toBeGreaterThanOrEqual(1);
    });

    it("getFeatureWithLock", async () => {
      const targetId = pickFeatureId(0);
      const result = await runLogged("WFS 1.1.0 getFeatureWithLock", () =>
        client11.getFeatureWithLock({
          version: "1.1.0",
          requestStyle: "POST",
          typeNames: [typeName],
          filter: {
            op: "id",
            ids: [targetId]
          },
          expiry: 1,
          lockAction: "SOME"
        })
      );

      expect(result.features.length).toBeGreaterThanOrEqual(1);
    });

    it("lockFeature", async () => {
      const targetId = pickFeatureId(1);
      const lock = await runLogged("WFS 1.1.0 lockFeature", () =>
        client11.lockFeature({
          version: "1.1.0",
          requestStyle: "POST",
          typeNames: [typeName],
          filter: {
            op: "id",
            ids: [targetId]
          },
          expiry: 1,
          lockAction: "SOME"
        })
      );

      expect(lock.lockId).toBeDefined();
      expect(lock.lockedResourceIds).toContain(targetId);
    });

    it("listStoredQueries returns OperationNotSupported", async () => {
      await expectOperationNotSupported("WFS 1.1.0 listStoredQueries", () =>
        client11.listStoredQueries({
          version: "1.1.0",
          requestStyle: "POST"
        })
      );
    });

    it("describeStoredQueries returns OperationNotSupported", async () => {
      await expectOperationNotSupported("WFS 1.1.0 describeStoredQueries", () =>
        client11.describeStoredQueries({
          version: "1.1.0",
          requestStyle: "POST",
          storedQueryIds: ["urn:ogc:def:query:OGC-WFS::GetFeatureById"]
        })
      );
    });

    it("createStoredQuery returns OperationNotSupported", async () => {
      await expectOperationNotSupported("WFS 1.1.0 createStoredQuery", () =>
        client11.createStoredQuery({
          version: "1.1.0",
          requestStyle: "POST",
          definitions: [
            {
              id: `urn:example:storedquery:not-supported-${Date.now()}`,
              queryExpressionTexts: [
                {
                  returnFeatureTypes: [typeName],
                  language: "urn:ogc:def:queryLanguage:OGC-WFS::WFSQueryExpression",
                  xml:
                    '<wfs:Query xmlns:wfs="http://www.opengis.net/wfs" typeName="integration:world_cities" />'
                }
              ]
            }
          ]
        })
      );
    });

    it("dropStoredQuery returns OperationNotSupported", async () => {
      await expectOperationNotSupported("WFS 1.1.0 dropStoredQuery", () =>
        client11.dropStoredQuery({
          version: "1.1.0",
          requestStyle: "POST",
          id: "urn:example:storedquery:not-supported"
        })
      );
    });
  });
});
