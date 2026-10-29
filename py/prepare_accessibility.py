"""Build an unsimplified routing graph from local OSM roads, without modifying sources."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import sys
from pathlib import Path

import fiona
from pyproj import Transformer
from shapely.geometry import shape, LineString, mapping
from shapely.ops import transform
from shapely.prepared import prep

ROOT = Path(__file__).resolve().parents[1]
PROJECT = Transformer.from_crs(4326, 32650, always_xy=True).transform
UNPROJECT = Transformer.from_crs(32650, 4326, always_xy=True).transform


def build(source, output):
    roads = source / '01_交通网络/01_道路路网/gis_osm_roads_free_1.shp'
    admin = source / '02_行政区划与地名/01_行政区划/gis_osm_adminareas_a_free_1.shp'
    with fiona.open(admin, encoding='UTF-8') as records:
        boundaries = [shape(f.geometry) for f in records if f.properties['name'] == '武汉市' and f.properties['fclass'] == 'admin_level5']
    if len(boundaries) != 1:
        raise ValueError('Expected exactly one Wuhan administrative boundary')
    boundary = transform(PROJECT, boundaries[0])
    # Retain context outside the city so a shortest path can leave and re-enter it.
    context = boundary.buffer(5000)
    prepared = prep(context)
    bbox = transform(UNPROJECT, context).bounds
    paths, uses = [], Counter()
    with fiona.open(roads, encoding='UTF-8') as records:
        if records.crs.to_epsg() != 4326:
            raise ValueError('Roads must use EPSG:4326')
        for record in records.filter(bbox=bbox):
            line = transform(PROJECT, shape(record.geometry))
            if not prepared.intersects(line):
                continue
            # Preserve original vertices. Do not planarize geometric crossings:
            # roads crossing a bridge/tunnel are not automatically connected.
            coords = []
            for x, y in line.coords:
                point = (round(x, 3), round(y, 3))
                if not coords or point != coords[-1]:
                    coords.append(point)
            if len(coords) < 2:
                continue
            p = dict(record.properties)
            paths.append((coords, p))
            uses.update(set(coords))
    nodes, node_ids, edges = [], {}, []

    def node(point):
        if point not in node_ids:
            node_ids[point] = len(nodes)
            nodes.append(point)
        return node_ids[point]

    for coords, p in paths:
        start = 0
        for end in range(1, len(coords)):
            if end != len(coords)-1 and uses[coords[end]] < 2:
                continue
            part = coords[start:end+1]
            if LineString(part).length > .01:
                edges.append([node(part[0]), node(part[-1]), part, p['fclass'], p['oneway'], p['maxspeed'] or 0, p['bridge'] == 'T'])
            start = end
    metadata = dict(
        version=1, generatedAt=datetime.now(timezone.utc).isoformat(), crs='EPSG:32650',
        source=str(roads), sourceCrs='EPSG:4326', sourceTimestamp='2026-10-23T20:20:51Z',
        attribution='© OpenStreetMap contributors · ODbL 1.0',
        nodes=len(nodes), edges=len(edges), sourceRoads=len(paths), contextMeters=5000,
        topology='Shared original vertices (1 mm rounding); geometric crossings are not noded',
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(dict(metadata=metadata, nodes=nodes, edges=edges, boundary=mapping(boundary)), ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    public_metadata = ROOT / 'public/data/accessibility/metadata.json'
    public_metadata.parent.mkdir(parents=True, exist_ok=True)
    public_metadata.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(metadata, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('D:/GIS学习/研究方向/GISdata'))
    parser.add_argument('--output', type=Path, default=ROOT / 'server/data/road-network.json')
    args = parser.parse_args()
    build(args.source, args.output)
