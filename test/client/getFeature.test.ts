import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AxiosRequestConfig } from "axios";
import { WfsClient } from "../../src/client/WfsClient";

const fixtureXml = readFileSync(
  join(process.cwd(), "test/fixtures/feature-collection.xml"),
  "utf8"
);

const exceptionXml = readFileSync(
  join(process.cwd(), "test/fixtures/exception-report.xml"),
  "utf8"
);

type RequestHandler = (
  config: AxiosRequestConfig
) => Promise<unknown>;

function createMockAxios(handler: RequestHandler): { request: RequestHandler } {
  return {
    request: vi.fn(handler)
  };
}

describe("WfsClient#getFeature", () => {
  it("returns GeoJSON response directly", async () => {
    const mockAxios = createMockAxios(async (config) => {
      expect(config.method).toBe("GET");
      expect((config.params as Record<string, unknown>).request).toBe("GetFeature");
      expect((config.params as Record<string, unknown>).outputFormat).toBe("application/json");

      return {
        data: JSON.stringify({ type: "FeatureCollection", features: [] }),
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        config,
        request: {}
      };
    });

    const client = new WfsClient({
      baseUrl: "https://example.com/wfs",
      versionStrategy: "1.1.0",
      axios: mockAxios as never
    });

    const result = await client.getFeature({
      typeNames: ["topp:roads"]
    });

    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toEqual([]);
  });

  it("falls back from outputFormat error to XML parsing", async () => {
    const mockAxios = createMockAxios(async (config) => {
      const outputFormat = (config.params as Record<string, unknown>).outputFormat;

      if (outputFormat === "application/json") {
        return {
          data: exceptionXml,
          status: 400,
          statusText: "Bad Request",
          headers: { "content-type": "application/xml" },
          config,
          request: {}
        };
      }

      return {
        data: fixtureXml,
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/xml" },
        config,
        request: {}
      };
    });

    const client = new WfsClient({
      baseUrl: "https://example.com/wfs",
      versionStrategy: "2.0.2",
      axios: mockAxios as never
    });

    const result = await client.getFeature({
      typeNames: ["topp:roads"]
    });

    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.properties?.name).toBe("Main St");
  });

  it("sends geoserver vendor params", async () => {
    const mockAxios = createMockAxios(async (config) => {
      const params = config.params as Record<string, string>;
      expect(params.request).toBe("GetFeature");
      expect(params.cql_filter).toBe("POP > 10");
      expect(params.viewParams).toBe("year:2024");

      return {
        data: JSON.stringify({ type: "FeatureCollection", features: [] }),
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        config,
        request: {}
      };
    });

    const client = new WfsClient({
      baseUrl: "https://example.com/wfs",
      versionStrategy: "2.0.2",
      geoserver: {
        enabled: true
      },
      axios: mockAxios as never
    });

    await client.getFeature({
      typeNames: ["topp:roads"],
      geoserver: {
        cqlFilter: "POP > 10",
        viewParams: "year:2024"
      }
    });

    expect((mockAxios.request as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("does not throw for successful payloads containing exception text", async () => {
    const mockAxios = createMockAxios(async (config) => {
      return {
        data: JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {
                note: "exception is just a regular word here"
              },
              geometry: null
            }
          ]
        }),
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        config,
        request: {}
      };
    });

    const client = new WfsClient({
      baseUrl: "https://example.com/wfs",
      versionStrategy: "2.0.2",
      axios: mockAxios as never
    });

    const result = await client.getFeature({
      typeNames: ["topp:roads"]
    });

    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.properties?.note).toContain("exception");
  });
});

describe("WfsClient#getPropertyValue", () => {
  it("resolves namespaced valueReference in WFS 1.1 fallback mode", async () => {
    const mockAxios = createMockAxios(async (config) => {
      expect((config.params as Record<string, unknown>).request).toBe("GetFeature");

      return {
        data: JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {
                name: "Main St"
              },
              geometry: null
            }
          ]
        }),
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        config,
        request: {}
      };
    });

    const client = new WfsClient({
      baseUrl: "https://example.com/wfs",
      versionStrategy: "1.1.0",
      axios: mockAxios as never
    });

    const result = await client.getPropertyValue<string>({
      typeNames: ["topp:roads"],
      valueReference: "topp:name"
    });

    expect(result).toEqual(["Main St"]);
  });
});
