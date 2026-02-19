CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS integration;

DROP TABLE IF EXISTS integration.world_cities;
CREATE TABLE integration.world_cities (
  id serial PRIMARY KEY,
  name text NOT NULL,
  country text NOT NULL,
  population integer,
  geom geometry(Point, 4326) NOT NULL
);

INSERT INTO integration.world_cities (name, country, population, geom)
VALUES
  ('Athens', 'Greece', 664046, ST_SetSRID(ST_MakePoint(23.7275, 37.9838), 4326)),
  ('Thessaloniki', 'Greece', 315196, ST_SetSRID(ST_MakePoint(22.9444, 40.6401), 4326)),
  ('Paris', 'France', 2161000, ST_SetSRID(ST_MakePoint(2.3522, 48.8566), 4326)),
  ('Berlin', 'Germany', 3769000, ST_SetSRID(ST_MakePoint(13.4050, 52.5200), 4326));

CREATE INDEX IF NOT EXISTS world_cities_geom_idx
  ON integration.world_cities
  USING GIST (geom);
