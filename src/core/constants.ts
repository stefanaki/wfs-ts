import type { WfsVersion } from "../types";

export const DEFAULT_WFS_VERSION: WfsVersion = "2.0.2";

export const SUPPORTED_VERSIONS: WfsVersion[] = ["2.0.2", "2.0.0", "1.1.0"];

export const DEFAULT_NAMESPACES: Record<string, string> = {
  wfs20: "http://www.opengis.net/wfs/2.0",
  wfs11: "http://www.opengis.net/wfs",
  gml32: "http://www.opengis.net/gml/3.2",
  gml31: "http://www.opengis.net/gml",
  fes20: "http://www.opengis.net/fes/2.0",
  ogc11: "http://www.opengis.net/ogc",
  ows11: "http://www.opengis.net/ows/1.1",
  xlink: "http://www.w3.org/1999/xlink"
};

export const GEOJSON_OUTPUT_FORMATS = [
  "application/json",
  "application/geo+json",
  "json"
];

export const COMMON_XML_CONTENT_TYPES = [
  "text/xml",
  "application/xml",
  "application/gml+xml"
];
