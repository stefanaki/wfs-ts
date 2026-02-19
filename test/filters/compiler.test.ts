import { describe, expect, it } from "vitest";
import { compileFilterXml } from "../../src/filters/compiler";

describe("compileFilterXml", () => {
  it("compiles FES 2.0 filters", () => {
    const xml = compileFilterXml(
      {
        op: "and",
        filters: [
          { op: "eq", property: "name", value: "Main" },
          { op: "gte", property: "lanes", value: 2 }
        ]
      },
      { version: "2.0.2" }
    );

    expect(xml).toContain("<fes:Filter>");
    expect(xml).toContain("<fes:And>");
    expect(xml).toContain("<fes:ValueReference>name</fes:ValueReference>");
    expect(xml).toContain("<fes:PropertyIsGreaterThanOrEqualTo>");
  });

  it("compiles OGC 1.1 filters", () => {
    const xml = compileFilterXml(
      {
        op: "id",
        ids: ["roads.1", "roads.2"]
      },
      { version: "1.1.0" }
    );

    expect(xml).toContain("<ogc:Filter>");
    expect(xml).toContain("<ogc:FeatureId fid=\"roads.1\"/>");
    expect(xml).toContain("<ogc:FeatureId fid=\"roads.2\"/>");
  });
});
