#!/bin/sh
set -eu

GEOSERVER_URL="${GEOSERVER_URL:-http://geoserver:8080/geoserver}"
GEOSERVER_ADMIN_USER="${GEOSERVER_ADMIN_USER:-admin}"
GEOSERVER_ADMIN_PASSWORD="${GEOSERVER_ADMIN_PASSWORD:-geoserver}"

POSTGIS_HOST="${POSTGIS_HOST:-postgis}"
POSTGIS_PORT="${POSTGIS_PORT:-5432}"
POSTGIS_DB="${POSTGIS_DB:-geodata}"
POSTGIS_SCHEMA="${POSTGIS_SCHEMA:-integration}"
POSTGIS_USER="${POSTGIS_USER:-geoserver}"
POSTGIS_PASSWORD="${POSTGIS_PASSWORD:-geoserver}"

WFS_WORKSPACE="${WFS_WORKSPACE:-integration}"
WFS_DATASTORE="${WFS_DATASTORE:-integration_pg}"
WFS_FEATURETYPE="${WFS_FEATURETYPE:-world_cities}"
WFS_SRS="${WFS_SRS:-EPSG:4326}"

AUTH="-u ${GEOSERVER_ADMIN_USER}:${GEOSERVER_ADMIN_PASSWORD}"
REST_BASE="${GEOSERVER_URL}/rest"

echo "Waiting for GeoServer REST API..."
attempt=1
while [ "${attempt}" -le 90 ]; do
  if curl -fsS ${AUTH} "${REST_BASE}/about/version.xml" >/dev/null 2>&1; then
    echo "GeoServer REST is ready."
    break
  fi
  attempt=$((attempt + 1))
  sleep 2
done

if [ "${attempt}" -gt 90 ]; then
  echo "GeoServer REST did not become ready in time."
  exit 1
fi

workspace_endpoint="${REST_BASE}/workspaces/${WFS_WORKSPACE}.xml"
if ! curl -fsS ${AUTH} "${workspace_endpoint}" >/dev/null 2>&1; then
  echo "Creating workspace ${WFS_WORKSPACE}..."
  curl -fsS ${AUTH} \
    -H "Content-Type: text/xml" \
    -X POST \
    "${REST_BASE}/workspaces" \
    -d "<workspace><name>${WFS_WORKSPACE}</name></workspace>" >/dev/null
else
  echo "Workspace ${WFS_WORKSPACE} already exists."
fi

store_endpoint="${REST_BASE}/workspaces/${WFS_WORKSPACE}/datastores/${WFS_DATASTORE}.xml"
if ! curl -fsS ${AUTH} "${store_endpoint}" >/dev/null 2>&1; then
  echo "Creating datastore ${WFS_WORKSPACE}:${WFS_DATASTORE}..."
  cat <<EOF >/tmp/datastore.xml
<dataStore>
  <name>${WFS_DATASTORE}</name>
  <enabled>true</enabled>
  <connectionParameters>
    <entry key="dbtype">postgis</entry>
    <entry key="host">${POSTGIS_HOST}</entry>
    <entry key="port">${POSTGIS_PORT}</entry>
    <entry key="database">${POSTGIS_DB}</entry>
    <entry key="schema">${POSTGIS_SCHEMA}</entry>
    <entry key="user">${POSTGIS_USER}</entry>
    <entry key="passwd">${POSTGIS_PASSWORD}</entry>
    <entry key="Expose primary keys">true</entry>
  </connectionParameters>
</dataStore>
EOF
  curl -fsS ${AUTH} \
    -H "Content-Type: text/xml" \
    -X POST \
    "${REST_BASE}/workspaces/${WFS_WORKSPACE}/datastores" \
    --data-binary "@/tmp/datastore.xml" >/dev/null
else
  echo "Datastore ${WFS_WORKSPACE}:${WFS_DATASTORE} already exists."
fi

feature_type_endpoint="${REST_BASE}/workspaces/${WFS_WORKSPACE}/datastores/${WFS_DATASTORE}/featuretypes/${WFS_FEATURETYPE}.xml"
if ! curl -fsS ${AUTH} "${feature_type_endpoint}" >/dev/null 2>&1; then
  echo "Publishing feature type ${WFS_WORKSPACE}:${WFS_FEATURETYPE}..."
  cat <<EOF >/tmp/featuretype.xml
<featureType>
  <name>${WFS_FEATURETYPE}</name>
  <nativeName>${WFS_FEATURETYPE}</nativeName>
  <title>World Cities (PostGIS)</title>
  <srs>${WFS_SRS}</srs>
  <enabled>true</enabled>
</featureType>
EOF
  curl -fsS ${AUTH} \
    -H "Content-Type: text/xml" \
    -X POST \
    "${REST_BASE}/workspaces/${WFS_WORKSPACE}/datastores/${WFS_DATASTORE}/featuretypes" \
    --data-binary "@/tmp/featuretype.xml" >/dev/null
else
  echo "Feature type ${WFS_WORKSPACE}:${WFS_FEATURETYPE} already exists."
fi

echo "GeoServer WFS setup complete."
