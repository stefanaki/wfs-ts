import { describe, expect, it } from "vitest";
import { buildCapabilitiesKvp, buildGetFeatureKvp } from "../../src/operations/kvp";

describe("KVP builders", () => {
  it("builds GetCapabilities KVP with explicit version and acceptVersions", () => {
    const kvp = buildCapabilitiesKvp({}, "2.0.2");

    expect(kvp.service).toBe("WFS");
    expect(kvp.request).toBe("GetCapabilities");
    expect(kvp.version).toBe("2.0.2");
    expect(kvp.acceptVersions).toBe("2.0.2");
  });

  it("keeps comma-separated type names in KVP requests", () => {
    const kvp = buildGetFeatureKvp(
      {
        typeNames: ["topp:roads", "infra:bridges"]
      },
      "2.0.2"
    );

    expect(kvp.typeNames).toBe("topp:roads,infra:bridges");
  });

  it("adds namespace declarations to KVP filter XML", () => {
    const kvp = buildGetFeatureKvp(
      {
        typeNames: ["topp:roads"],
        filter: {
          op: "gte",
          property: "cat",
          value: 89
        }
      },
      "2.0.2"
    );

    expect(kvp.filter).toContain('<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0"');
    expect(kvp.filter).toContain("<fes:PropertyIsGreaterThanOrEqualTo>");
    expect(kvp.filter).toContain("<fes:ValueReference>cat</fes:ValueReference>");
  });
});
