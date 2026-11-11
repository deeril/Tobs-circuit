$ErrorActionPreference = 'Stop'

$dataDirectory = Join-Path $PSScriptRoot 'data'
$pbfPath = Join-Path $dataDirectory 'nigeria-latest.osm.pbf'
$image = 'ghcr.io/project-osrm/osrm-backend:v26.11.0'

if (!(Test-Path $pbfPath -PathType Leaf)) {
  throw "Download the Nigeria OpenStreetMap extract to $pbfPath before preprocessing."
}
if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker is required to preprocess the OSRM extract.'
}

New-Item -ItemType Directory -Force -Path $dataDirectory | Out-Null
$mount = "type=bind,source=$dataDirectory,target=/data"

& docker run --rm --mount $mount $image osrm-extract -p /opt/car.lua /data/nigeria-latest.osm.pbf
if ($LASTEXITCODE -ne 0) { throw 'OSRM extraction failed.' }

& docker run --rm --mount $mount $image osrm-partition /data/nigeria-latest.osrm
if ($LASTEXITCODE -ne 0) { throw 'OSRM partitioning failed.' }

& docker run --rm --mount $mount $image osrm-customize /data/nigeria-latest.osrm
if ($LASTEXITCODE -ne 0) { throw 'OSRM customization failed.' }
