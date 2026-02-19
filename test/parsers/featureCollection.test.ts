import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFeatureCollection } from "../../src/parsers/featureCollection";

const fixture = readFileSync(
  join(process.cwd(), "test/fixtures/feature-collection.xml"),
  "utf8"
);

describe("parseFeatureCollection", () => {
  it("parses XML feature collection", () => {
    const result = parseFeatureCollection(fixture, {
      axisOrderStrategy: "preserve"
    });

    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(1);
    expect(result.lockId).toBe("lock-1");

    const feature = result.features[0];
    expect(feature?.properties?.name).toBe("Main St");
    expect(feature?.geometry?.type).toBe("Point");
    expect(feature?.geometry && "coordinates" in feature.geometry
      ? feature.geometry.coordinates
      : undefined).toEqual([40, 20]);
  });

  it("applies axis strategy for EPSG:4326", () => {
    const result = parseFeatureCollection(fixture, {
      axisOrderStrategy: "forceLonLat"
    });

    const feature = result.features[0];
    expect(feature?.geometry && "coordinates" in feature.geometry
      ? feature.geometry.coordinates
      : undefined).toEqual([20, 40]);
  });

  it("passes through GeoJSON feature collection", () => {
    const payload = {
      type: "FeatureCollection",
      features: []
    };

    const result = parseFeatureCollection(payload, {
      axisOrderStrategy: "preserve"
    });

    expect(result).toEqual(payload);
  });

  it("parses collections using featureMembers container", () => {
    const xml = `<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:topp="http://www.openplans.org/topp"><gml:featureMembers><topp:roads gml:id="roads.1"><topp:name>Main St</topp:name><topp:geometry><gml:Point srsName="EPSG:4326"><gml:pos>40 20</gml:pos></gml:Point></topp:geometry></topp:roads><topp:roads gml:id="roads.2"><topp:name>Second St</topp:name><topp:geometry><gml:Point srsName="EPSG:4326"><gml:pos>41 21</gml:pos></gml:Point></topp:geometry></topp:roads></gml:featureMembers></wfs:FeatureCollection>`;

    const result = parseFeatureCollection(xml, {
      axisOrderStrategy: "preserve"
    });

    expect(result.features).toHaveLength(2);
    expect(result.features[0]?.properties?.name).toBe("Main St");
    expect(result.features[1]?.properties?.name).toBe("Second St");
  });
});
