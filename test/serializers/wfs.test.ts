import { describe, expect, it } from "vitest";
import {
  buildGetCapabilitiesXml,
  buildGetFeatureXml,
  buildLockFeatureXml,
  buildListStoredQueriesXml,
  buildTransactionXml
} from "../../src/serializers/wfs";

describe("WFS serializers", () => {
  it("applies XML overrides and geoserver hints", () => {
    const xml = buildGetFeatureXml(
      {
        typeNames: ["topp:roads"],
        geoserver: {
          xmlHints: ["<gs:Hint xmlns:gs=\"http://geoserver.org\">on</gs:Hint>"]
        },
        raw: {
          xmlOverrides: [
            {
              target: "wfs:GetFeature",
              position: "after",
              xml: "<!--custom-->"
            }
          ]
        }
      },
      {
        version: "2.0.2",
        namespaces: {
          topp: "http://www.openplans.org/topp"
        }
      }
    );

    expect(xml).toContain("<gs:Hint");
    expect(xml).toContain("<!--custom-->");
    expect(xml).toContain("typeNames=\"topp:roads\"");
    expect(xml).toContain("xmlns:topp=\"http://www.openplans.org/topp\"");
  });

  it("uses maxFeatures and whitespace-separated type names for WFS 1.1", () => {
    const xml = buildGetFeatureXml(
      {
        typeNames: ["topp:roads", "infra:bridges"],
        count: 5
      },
      {
        version: "1.1.0",
        namespaces: {
          topp: "http://www.openplans.org/topp",
          infra: "https://example.com/infra"
        }
      }
    );

    expect(xml).toContain("typeName=\"topp:roads infra:bridges\"");
    expect(xml).toContain("maxFeatures=\"5\"");
    expect(xml).not.toContain(" count=\"5\"");
  });

  it("uses wfs:Lock with typeName for WFS 1.1 lockFeature", () => {
    const xml = buildLockFeatureXml(
      {
        typeNames: ["topp:roads"],
        filter: {
          op: "id",
          ids: ["roads.1"]
        }
      },
      {
        version: "1.1.0",
        namespaces: {
          topp: "http://www.openplans.org/topp"
        }
      }
    );

    expect(xml).toContain("<wfs:Lock ");
    expect(xml).toContain("typeName=\"topp:roads\"");
    expect(xml).toContain("<ogc:FeatureId fid=\"roads.1\"/>");
    expect(xml).not.toContain("<wfs:Query ");
  });

  it("throws when a referenced QName prefix has no namespace mapping", () => {
    expect(() =>
      buildGetFeatureXml(
        {
          typeNames: ["topp:roads"]
        },
        {
          version: "2.0.2"
        }
      )
    ).toThrow(/Missing namespace mapping for prefix "topp"/);
  });

  it("keeps explicit property prefixes in transaction inserts", () => {
    const xml = buildTransactionXml(
      {
        actions: [
          {
            kind: "insert",
            typeName: "topp:roads",
            features: [
              {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [20, 40]
                },
                properties: {
                  "ns:name": "Main St",
                  name: "Secondary Name"
                }
              }
            ]
          }
        ]
      },
      {
        version: "2.0.2",
        namespaces: {
          topp: "http://www.openplans.org/topp",
          ns: "https://example.com/ns"
        }
      }
    );

    expect(xml).toContain("<ns:name>Main St</ns:name>");
    expect(xml).toContain("<topp:name>Secondary Name</topp:name>");
    expect(xml).not.toContain("<topp:ns:name>");
  });

  it("supports XML overrides for self-closing operation roots", () => {
    const xml = buildListStoredQueriesXml(
      {
        raw: {
          xmlOverrides: [
            {
              target: "wfs:ListStoredQueries",
              position: "replace",
              xml: "<custom:List xmlns:custom=\"https://example.com/custom\"/>"
            }
          ]
        }
      },
      {
        version: "2.0.2"
      }
    );

    expect(xml).toBe("<custom:List xmlns:custom=\"https://example.com/custom\"/>");
  });

  it("builds GetCapabilities XML with explicit version and AcceptVersions", () => {
    const xml = buildGetCapabilitiesXml(
      {
        acceptVersions: ["2.0.2", "1.1.0"]
      },
      {
        version: "2.0.2"
      }
    );

    expect(xml).toContain("<wfs:GetCapabilities");
    expect(xml).toContain("version=\"2.0.2\"");
    expect(xml).toContain("<ows:AcceptVersions>");
    expect(xml).toContain("<ows:Version>2.0.2</ows:Version>");
    expect(xml).toContain("<ows:Version>1.1.0</ows:Version>");
  });
});
