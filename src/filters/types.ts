import type { Geometry } from "geojson";

export type WfsFilter =
  | LogicalFilter
  | ComparisonFilter
  | LikeFilter
  | BetweenFilter
  | NullFilter
  | IdFilter
  | SpatialFilter;

export interface LogicalFilter {
  op: "and" | "or" | "not";
  filters: WfsFilter[];
}

export interface ComparisonFilter {
  op:
    | "eq"
    | "neq"
    | "lt"
    | "lte"
    | "gt"
    | "gte";
  property: string;
  value: unknown;
  matchCase?: boolean;
}

export interface LikeFilter {
  op: "like";
  property: string;
  value: string;
  wildCard?: string;
  singleChar?: string;
  escapeChar?: string;
  matchCase?: boolean;
}

export interface BetweenFilter {
  op: "between";
  property: string;
  lower: unknown;
  upper: unknown;
}

export interface NullFilter {
  op: "isNull";
  property: string;
}

export interface IdFilter {
  op: "id";
  ids: string[];
}

export interface SpatialFilter {
  op:
    | "bbox"
    | "intersects"
    | "within"
    | "contains"
    | "disjoint"
    | "touches"
    | "overlaps"
    | "crosses";
  property: string;
  geometry: Geometry;
  srsName?: string;
}
