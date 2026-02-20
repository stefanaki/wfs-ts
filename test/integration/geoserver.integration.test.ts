import { beforeAll, describe, expect, it } from "vitest";
import type {
  FeatureCollection,
  GeoJsonProperties,
  Geometry
} from "geojson";
import { WfsClient } from "../../src/client/WfsClient";
import { OwsExceptionError } from "../../src/errors";
import type {
  TransactionResult,
  WfsVersion
} from "../../src/types";

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

function makeUniqueCityName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

async function eventually<T>(
  operation: () => Promise<T>,
  predicate: (value: T) => boolean,
  options?: {
    attempts?: number;
    delayMs?: number;
  }
): Promise<T> {
  const attempts = options?.attempts ?? 20;
  const delayMs = options?.delayMs ?? 500;
  let lastValue: T | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await operation();
      lastValue = value;
      if (predicate(value)) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  throw new Error(
    `Condition was not met after ${attempts} attempts. Last value: ${formatForLog(
      lastValue
    )}. Last error: ${formatForLog(serializeError(lastError))}`
  );
}

function toFeatureId(id: unknown): string | undefined {
  if (typeof id === "string" || typeof id === "number") {
    return String(id);
  }

  return undefined;
}

function readProperty(
  properties: GeoJsonProperties | null | undefined,
  propertyName: string
): unknown {
  if (!properties || typeof properties !== "object") {
    return undefined;
  }

  if (propertyName in properties) {
    return properties[propertyName];
  }

  const match = Object.entries(properties).find(
    ([candidate]) =>
      candidate === propertyName || candidate.endsWith(`:${propertyName}`)
  );

  return match?.[1];
}

function readStringProperty(
  properties: GeoJsonProperties | null | undefined,
  propertyName: string
): string | undefined {
  const value = readProperty(properties, propertyName);
  return typeof value === "string" ? value : undefined;
}

function readNumberProperty(
  properties: GeoJsonProperties | null | undefined,
  propertyName: string
): number | undefined {
  const value = readProperty(properties, propertyName);
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function assertOwsFailure(error: unknown): OwsExceptionError {
  expect(error).toBeInstanceOf(OwsExceptionError);
  const owsError = error as OwsExceptionError;
  expect(owsError.exceptions.length).toBeGreaterThan(0);
  return owsError;
}

async function getFeaturesByName(
  client: WfsClient,
  version: WfsVersion,
  name: string
): Promise<FeatureCollection<Geometry, GeoJsonProperties>> {
  return client.getFeature({
    version,
    requestStyle: "POST",
    typeNames: [typeName],
    filter: {
      op: "eq",
      property: "name",
      value: name
    }
  });
}

async function deleteById(
  client: WfsClient,
  version: WfsVersion,
  id: string
): Promise<TransactionResult> {
  return client.transaction({
    version,
    requestStyle: "POST",
    actions: [
      {
        kind: "delete",
        typeName,
        filter: {
          op: "id",
          ids: [id]
        }
      }
    ]
  });
}

async function insertCityAndResolveId(
  client: WfsClient,
  version: WfsVersion,
  name: string,
  country: string,
  population: number,
  coordinates: [number, number]
): Promise<{ featureId: string; transaction: TransactionResult }> {
  const transaction = await client.transaction({
    version,
    requestStyle: "POST",
    actions: [
      {
        kind: "insert",
        typeName,
        geometryPropertyName: "geom",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates
            },
            properties: {
              name,
              country,
              population
            }
          }
        ]
      }
    ]
  });

  const featureId = transaction.insertResults
    .flatMap((result) => result.resourceIds)
    .map((id) => toFeatureId(id))
    .find((id): id is string => !!id);

  if (featureId) {
    return {
      featureId,
      transaction
    };
  }

  const byName = await eventually(
    () => getFeaturesByName(client, version, name),
    (fc) => fc.features.length > 0
  );
  const fallbackId = toFeatureId(byName.features[0]?.id);

  if (!fallbackId) {
    throw new Error(`Could not resolve inserted feature id for city "${name}"`);
  }

  return {
    featureId: fallbackId,
    transaction
  };
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

    describe("Transaction action matrix", () => {
      it("insert action", async () => {
        const cityName = makeUniqueCityName("tx20-insert");
        let insertedId: string | undefined;

        try {
          const inserted = await runLogged(
            "WFS 2.0.2 transaction matrix insert",
            () =>
              insertCityAndResolveId(
                client20,
                "2.0.2",
                cityName,
                "Testland",
                100_001,
                [11.111, 44.444]
              )
          );

          insertedId = inserted.featureId;
          expect(inserted.transaction.totalInserted ?? 0).toBeGreaterThanOrEqual(1);

          const fetched = await runLogged(
            "WFS 2.0.2 transaction matrix insert verify",
            () =>
              eventually(
                () => getFeaturesByName(client20, "2.0.2", cityName),
                (fc) => fc.features.length > 0
              )
          );

          expect(fetched.features.length).toBeGreaterThanOrEqual(1);
        } finally {
          const cleanupId = insertedId;
          if (cleanupId) {
            await runLogged("WFS 2.0.2 transaction matrix insert cleanup", () =>
              deleteById(client20, "2.0.2", cleanupId)
            );
          }
        }
      });

      it("update action with comparison filter", async () => {
        const cityName = makeUniqueCityName("tx20-update");
        const nextPopulation = 510_000 + (Date.now() % 1000);
        let insertedId: string | undefined;

        try {
          const inserted = await runLogged(
            "WFS 2.0.2 transaction matrix update setup insert",
            () =>
              insertCityAndResolveId(
                client20,
                "2.0.2",
                cityName,
                "Testland",
                101_001,
                [11.112, 44.445]
              )
          );
          insertedId = inserted.featureId;

          const updated = await runLogged(
            "WFS 2.0.2 transaction matrix update",
            () =>
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
                        value: nextPopulation
                      }
                    ],
                    filter: {
                      op: "eq",
                      property: "name",
                      value: cityName
                    }
                  }
                ]
              })
          );

          expect(updated.totalUpdated ?? 0).toBeGreaterThanOrEqual(1);

          const fetched = await runLogged(
            "WFS 2.0.2 transaction matrix update verify",
            () =>
              eventually(
                () => getFeaturesByName(client20, "2.0.2", cityName),
                (fc) =>
                  fc.features.some(
                    (feature) =>
                      readNumberProperty(feature.properties, "population") ===
                      nextPopulation
                  )
              )
          );

          const populations = fetched.features
            .map((feature) => readNumberProperty(feature.properties, "population"))
            .filter((value): value is number => value !== undefined);
          expect(populations).toContain(nextPopulation);
        } finally {
          const cleanupId = insertedId;
          if (cleanupId) {
            await runLogged("WFS 2.0.2 transaction matrix update cleanup", () =>
              deleteById(client20, "2.0.2", cleanupId)
            );
          }
        }
      });

      it("delete action with comparison filter", async () => {
        const cityName = makeUniqueCityName("tx20-delete");
        let insertedId: string | undefined;

        try {
          const inserted = await runLogged(
            "WFS 2.0.2 transaction matrix delete setup insert",
            () =>
              insertCityAndResolveId(
                client20,
                "2.0.2",
                cityName,
                "Testland",
                102_001,
                [11.113, 44.446]
              )
          );
          insertedId = inserted.featureId;

          const deleted = await runLogged(
            "WFS 2.0.2 transaction matrix delete",
            () =>
              client20.transaction({
                version: "2.0.2",
                requestStyle: "POST",
                actions: [
                  {
                    kind: "delete",
                    typeName,
                    filter: {
                      op: "eq",
                      property: "name",
                      value: cityName
                    }
                  }
                ]
              })
          );

          expect(deleted.totalDeleted ?? 0).toBeGreaterThanOrEqual(1);

          const remaining = await runLogged(
            "WFS 2.0.2 transaction matrix delete verify",
            () =>
              eventually(
                () => getFeaturesByName(client20, "2.0.2", cityName),
                (fc) => fc.features.length === 0
              )
          );

          expect(remaining.features.length).toBe(0);
        } finally {
          const cleanupId = insertedId;
          if (cleanupId) {
            await runLogged("WFS 2.0.2 transaction matrix delete cleanup", () =>
              deleteById(client20, "2.0.2", cleanupId)
            );
          }
        }
      }, 15_000);

      it("native action succeeds when safeToIgnore=true", async () => {
        const tx = await runLogged(
          "WFS 2.0.2 transaction matrix native safe",
          () =>
            client20.transaction({
              version: "2.0.2",
              requestStyle: "POST",
              actions: [
                {
                  kind: "native",
                  vendorId: "codex-unknown-vendor",
                  safeToIgnore: true,
                  value: "noop"
                }
              ]
            })
        );

        expect(tx).toBeDefined();
      });

      it("native action fails when safeToIgnore=false", async () => {
        let thrown: unknown;

        try {
          await runLogged("WFS 2.0.2 transaction matrix native strict", () =>
            client20.transaction({
              version: "2.0.2",
              requestStyle: "POST",
              actions: [
                {
                  kind: "native",
                  vendorId: "codex-unknown-vendor",
                  safeToIgnore: false,
                  value: "noop"
                }
              ]
            })
          );
        } catch (error) {
          thrown = error;
        }

        const owsError = assertOwsFailure(thrown);
        expect(
          owsError.exceptions.some(
            (exception) =>
              (exception.exceptionCode ?? "").length > 0 ||
              exception.text.length > 0
          )
        ).toBe(true);
      });
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

    describe("Transaction action matrix", () => {
      it("insert action", async () => {
        const cityName = makeUniqueCityName("tx11-insert");
        let insertedId: string | undefined;

        try {
          const inserted = await runLogged(
            "WFS 1.1.0 transaction matrix insert",
            () =>
              insertCityAndResolveId(
                client11,
                "1.1.0",
                cityName,
                "Testland",
                200_001,
                [12.111, 43.444]
              )
          );

          insertedId = inserted.featureId;
          expect(inserted.transaction.totalInserted ?? 0).toBeGreaterThanOrEqual(1);

          const fetched = await runLogged(
            "WFS 1.1.0 transaction matrix insert verify",
            () =>
              eventually(
                () => getFeaturesByName(client11, "1.1.0", cityName),
                (fc) => fc.features.length > 0
              )
          );

          expect(fetched.features.length).toBeGreaterThanOrEqual(1);
        } finally {
          const cleanupId = insertedId;
          if (cleanupId) {
            await runLogged("WFS 1.1.0 transaction matrix insert cleanup", () =>
              deleteById(client11, "1.1.0", cleanupId)
            );
          }
        }
      });

      it("update action with comparison filter", async () => {
        const cityName = makeUniqueCityName("tx11-update");
        const nextPopulation = 610_000 + (Date.now() % 1000);
        let insertedId: string | undefined;

        try {
          const inserted = await runLogged(
            "WFS 1.1.0 transaction matrix update setup insert",
            () =>
              insertCityAndResolveId(
                client11,
                "1.1.0",
                cityName,
                "Testland",
                201_001,
                [12.112, 43.445]
              )
          );
          insertedId = inserted.featureId;

          const updated = await runLogged(
            "WFS 1.1.0 transaction matrix update",
            () =>
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
                        value: nextPopulation
                      }
                    ],
                    filter: {
                      op: "eq",
                      property: "name",
                      value: cityName
                    }
                  }
                ]
              })
          );

          expect(updated.totalUpdated ?? 0).toBeGreaterThanOrEqual(1);

          const fetched = await runLogged(
            "WFS 1.1.0 transaction matrix update verify",
            () =>
              eventually(
                () => getFeaturesByName(client11, "1.1.0", cityName),
                (fc) =>
                  fc.features.some(
                    (feature) =>
                      readNumberProperty(feature.properties, "population") ===
                      nextPopulation
                  )
              )
          );

          const populations = fetched.features
            .map((feature) => readNumberProperty(feature.properties, "population"))
            .filter((value): value is number => value !== undefined);
          expect(populations).toContain(nextPopulation);
        } finally {
          const cleanupId = insertedId;
          if (cleanupId) {
            await runLogged("WFS 1.1.0 transaction matrix update cleanup", () =>
              deleteById(client11, "1.1.0", cleanupId)
            );
          }
        }
      });

      it("delete action with comparison filter", async () => {
        const cityName = makeUniqueCityName("tx11-delete");
        let insertedId: string | undefined;

        try {
          const inserted = await runLogged(
            "WFS 1.1.0 transaction matrix delete setup insert",
            () =>
              insertCityAndResolveId(
                client11,
                "1.1.0",
                cityName,
                "Testland",
                202_001,
                [12.113, 43.446]
              )
          );
          insertedId = inserted.featureId;

          const deleted = await runLogged(
            "WFS 1.1.0 transaction matrix delete",
            () =>
              client11.transaction({
                version: "1.1.0",
                requestStyle: "POST",
                actions: [
                  {
                    kind: "delete",
                    typeName,
                    filter: {
                      op: "eq",
                      property: "name",
                      value: cityName
                    }
                  }
                ]
              })
          );

          expect(deleted.totalDeleted ?? 0).toBeGreaterThanOrEqual(1);

          const remaining = await runLogged(
            "WFS 1.1.0 transaction matrix delete verify",
            () =>
              eventually(
                () => getFeaturesByName(client11, "1.1.0", cityName),
                (fc) => fc.features.length === 0
              )
          );

          expect(remaining.features.length).toBe(0);
        } finally {
          const cleanupId = insertedId;
          if (cleanupId) {
            await runLogged("WFS 1.1.0 transaction matrix delete cleanup", () =>
              deleteById(client11, "1.1.0", cleanupId)
            );
          }
        }
      }, 15_000);

      it("native action succeeds when safeToIgnore=true", async () => {
        const tx = await runLogged(
          "WFS 1.1.0 transaction matrix native safe",
          () =>
            client11.transaction({
              version: "1.1.0",
              requestStyle: "POST",
              actions: [
                {
                  kind: "native",
                  vendorId: "codex-unknown-vendor",
                  safeToIgnore: true,
                  value: "noop"
                }
              ]
            })
        );

        expect(tx).toBeDefined();
      });

      it("native action fails when safeToIgnore=false", async () => {
        let thrown: unknown;

        try {
          await runLogged("WFS 1.1.0 transaction matrix native strict", () =>
            client11.transaction({
              version: "1.1.0",
              requestStyle: "POST",
              actions: [
                {
                  kind: "native",
                  vendorId: "codex-unknown-vendor",
                  safeToIgnore: false,
                  value: "noop"
                }
              ]
            })
          );
        } catch (error) {
          thrown = error;
        }

        const owsError = assertOwsFailure(thrown);
        expect(
          owsError.exceptions.some(
            (exception) =>
              (exception.exceptionCode ?? "").length > 0 ||
              exception.text.length > 0
          )
        ).toBe(true);
      });
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

  describe("Filter coverage", () => {
    it("cql_filter narrows query results", async () => {
      const includeName = makeUniqueCityName("cql-include");
      const excludeName = makeUniqueCityName("cql-exclude");
      let includeId: string | undefined;
      let excludeId: string | undefined;

      try {
        const insertedInclude = await runLogged(
          "Filter coverage cql setup include",
          () =>
            insertCityAndResolveId(
              client20,
              "2.0.2",
              includeName,
              "Filterland",
              301_001,
              [20.101, 45.101]
            )
        );
        includeId = insertedInclude.featureId;

        const insertedExclude = await runLogged(
          "Filter coverage cql setup exclude",
          () =>
            insertCityAndResolveId(
              client20,
              "2.0.2",
              excludeName,
              "Otherland",
              302_001,
              [20.102, 45.102]
            )
        );
        excludeId = insertedExclude.featureId;

        const fc = await runLogged("Filter coverage cql_filter", () =>
          client20.getFeature({
            version: "2.0.2",
            requestStyle: "GET",
            typeNames: [typeName],
            geoserver: {
              cqlFilter: `name = '${includeName}'`
            }
          })
        );

        const names = fc.features
          .map((feature) => readStringProperty(feature.properties, "name"))
          .filter((name): name is string => !!name);

        expect(names.length).toBeGreaterThan(0);
        expect(names).toContain(includeName);
        expect(names).not.toContain(excludeName);
      } finally {
        const cleanupIds = [includeId, excludeId].filter(
          (id): id is string => !!id
        );
        for (const cleanupId of cleanupIds) {
          await runLogged("Filter coverage cql cleanup", () =>
            deleteById(client20, "2.0.2", cleanupId)
          );
        }
      }
    });

    it("fes 2.0 filter works on WFS 2.0.2", async () => {
      const includeName = makeUniqueCityName("fes20-include-a");
      const excludeName = makeUniqueCityName("fes20-exclude-b");
      let includeId: string | undefined;
      let excludeId: string | undefined;

      try {
        const insertedInclude = await runLogged(
          "Filter coverage fes 2.0 setup include",
          () =>
            insertCityAndResolveId(
              client20,
              "2.0.2",
              includeName,
              "Dialectland",
              401_001,
              [21.101, 46.101]
            )
        );
        includeId = insertedInclude.featureId;

        const insertedExclude = await runLogged(
          "Filter coverage fes 2.0 setup exclude",
          () =>
            insertCityAndResolveId(
              client20,
              "2.0.2",
              excludeName,
              "Dialectland",
              402_001,
              [21.102, 46.102]
            )
        );
        excludeId = insertedExclude.featureId;

        const fc = await runLogged("Filter coverage fes 2.0", () =>
          client20.getFeature({
            version: "2.0.2",
            requestStyle: "POST",
            typeNames: [typeName],
            filter: {
              op: "and",
              filters: [
                {
                  op: "eq",
                  property: "country",
                  value: "Dialectland"
                },
                {
                  op: "like",
                  property: "name",
                  value: "fes20-include-*"
                }
              ]
            }
          })
        );

        const names = fc.features
          .map((feature) => readStringProperty(feature.properties, "name"))
          .filter((name): name is string => !!name);

        expect(names.length).toBeGreaterThan(0);
        expect(names).toContain(includeName);
        expect(names).not.toContain(excludeName);

        for (const feature of fc.features) {
          expect(readStringProperty(feature.properties, "country")).toBe("Dialectland");
          expect(
            readStringProperty(feature.properties, "name")?.startsWith("fes20-include-")
          ).toBe(true);
        }
      } finally {
        const cleanupIds = [includeId, excludeId].filter(
          (id): id is string => !!id
        );
        for (const cleanupId of cleanupIds) {
          await runLogged("Filter coverage fes 2.0 cleanup", () =>
            deleteById(client20, "2.0.2", cleanupId)
          );
        }
      }
    });

    it("ogc filter 1.1 works on WFS 1.1.0", async () => {
      const includeName = makeUniqueCityName("ogc11-include-a");
      const excludeName = makeUniqueCityName("ogc11-exclude-b");
      let includeId: string | undefined;
      let excludeId: string | undefined;

      try {
        const insertedInclude = await runLogged(
          "Filter coverage ogc 1.1 setup include",
          () =>
            insertCityAndResolveId(
              client11,
              "1.1.0",
              includeName,
              "Dialectland11",
              501_001,
              [22.101, 47.101]
            )
        );
        includeId = insertedInclude.featureId;

        const insertedExclude = await runLogged(
          "Filter coverage ogc 1.1 setup exclude",
          () =>
            insertCityAndResolveId(
              client11,
              "1.1.0",
              excludeName,
              "Dialectland11",
              502_001,
              [22.102, 47.102]
            )
        );
        excludeId = insertedExclude.featureId;

        const fc = await runLogged("Filter coverage ogc 1.1", () =>
          client11.getFeature({
            version: "1.1.0",
            requestStyle: "POST",
            typeNames: [typeName],
            filter: {
              op: "and",
              filters: [
                {
                  op: "eq",
                  property: "country",
                  value: "Dialectland11"
                },
                {
                  op: "like",
                  property: "name",
                  value: "ogc11-include-*"
                }
              ]
            }
          })
        );

        const names = fc.features
          .map((feature) => readStringProperty(feature.properties, "name"))
          .filter((name): name is string => !!name);

        expect(names.length).toBeGreaterThan(0);
        expect(names).toContain(includeName);
        expect(names).not.toContain(excludeName);

        for (const feature of fc.features) {
          expect(readStringProperty(feature.properties, "country")).toBe("Dialectland11");
          expect(
            readStringProperty(feature.properties, "name")?.startsWith("ogc11-include-")
          ).toBe(true);
        }
      } finally {
        const cleanupIds = [includeId, excludeId].filter(
          (id): id is string => !!id
        );
        for (const cleanupId of cleanupIds) {
          await runLogged("Filter coverage ogc 1.1 cleanup", () =>
            deleteById(client11, "1.1.0", cleanupId)
          );
        }
      }
    });
  });
});
