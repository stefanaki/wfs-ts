# wfs-ts

High-level TypeScript SDK for OGC WFS services (WFS `2.0.x` and `1.1.0`) with a GeoJSON-first API.

## Features

- Class-based API: `WfsClient`
- WFS operations:
  - `getCapabilities`
  - `describeFeatureType`
  - `getFeature`
  - `getFeatureWithLock`
  - `getPropertyValue`
  - `transaction`
  - `lockFeature`
  - `listStoredQueries`
  - `describeStoredQueries`
  - `createStoredQuery`
  - `dropStoredQuery`
- GET query params and POST XML bindings
- GeoJSON-first responses with XML/GML fallback parser
- Typed OWS exceptions (`OwsExceptionError`)
- GeoServer vendor support (`cql_filter`, `viewParams`, `format_options`) + XML hints
- Filter AST + compiler for FES 2.0 and OGC Filter 1.1

## Install

`axios` is a peer dependency.

```bash
pnpm add @stefanaki/wfs-ts axios
```

## Quick Start

```ts
import { WfsClient } from "@stefanaki/wfs-ts";

const client = new WfsClient({
  baseUrl: "https://example.com/geoserver/wfs",
  versionStrategy: "auto",
  geoserver: { enabled: true }
});

const roads = await client.getFeature({
  typeNames: ["topp:roads"],
  count: 100,
  geoserver: {
    cqlFilter: "POPULATION > 1000"
  }
});
```

## Typed Feature Generics

```ts
import type { Point, GeoJsonProperties } from "geojson";

type CityProps = GeoJsonProperties & {
  name: string;
  population: number;
};

const cities = await client.getFeature<Point, CityProps>({
  typeNames: ["topp:cities"]
});
```

## Scripts

```bash
pnpm build
pnpm test
pnpm schemas:sync
pnpm schemas:validate
pnpm types:validate
```

## Release

Publishing is automated by GitHub Actions when a version tag is pushed.


## Schema Assets

- Seed schema files live in `namespaces/`.
- Downloaded complete dependency trees are stored under:
  - `namespaces/wfs20/`
  - `namespaces/wfs11/`

Sync and validation scripts are in `scripts/`.

## Integration Testing (GeoServer)

The integration stack starts:

- PostGIS seeded with real vector data in `integration.world_cities`
- GeoServer
- A one-shot setup container that configures workspace/datastore/layer publishing

1. Start integration services:

```bash
docker compose -f test/integration/docker-compose.yml up -d
```

2. Run integration tests:

```bash
RUN_GEOSERVER_TESTS=1 \
GEOSERVER_WFS_URL=http://localhost:8080/geoserver/wfs \
GEOSERVER_ADMIN_USER=admin \
GEOSERVER_ADMIN_PASSWORD=geoserver \
GEOSERVER_TYPENAME=integration:world_cities \
pnpm test:integration
```

Environment variables:

- `RUN_GEOSERVER_TESTS=1` enables integration tests
- `GEOSERVER_WFS_URL` defaults to `http://localhost:8080/geoserver/wfs`
- `GEOSERVER_ADMIN_USER` defaults to `admin`
- `GEOSERVER_ADMIN_PASSWORD` defaults to `geoserver`
- `GEOSERVER_TYPENAME` defaults to `integration:world_cities`

Notes:

- The WFS `2.0.2` client path is tested against GeoServer, but GeoServer capabilities may report `2.0.0`; tests should not assert an exact capabilities version string.
- WFS `1.1.0` intentionally tests stored-query methods (`listStoredQueries`, `describeStoredQueries`, `createStoredQuery`, `dropStoredQuery`) as expected `OperationNotSupported` errors, since these are not part of WFS `1.1.0`.
