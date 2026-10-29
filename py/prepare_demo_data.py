"""Export Wuhan demo vectors without changing the source GIS dataset.

Usage: python py/prepare_demo_data.py --source D:/GIS学习/研究方向/GISdata
Requires: fiona, shapely, pyproj (see requirements-demo.txt).
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import re

import fiona
from pyproj import Geod
from shapely import make_valid
from shapely.geometry import mapping, shape
from shapely.ops import orient
from shapely.prepared import prep


GEOD = Geod(ellps="WGS84")
CATEGORIES = [
    dict(name="轨道车站", short="轨道", icon="train", unit="处", color="#00c9f5", classes=["railway_station", "railway_halt", "tram_stop"]),
    dict(name="公交站", short="公交", icon="bus", unit="处", color="#27c1ff", classes=["bus_stop", "bus_station"]),
    dict(name="商业设施", short="商业", icon="building", unit="处", color="#ffbd55", classes=["mall", "supermarket", "department_store", "marketplace", "convenience"]),
    dict(name="学校", short="学校", icon="school", unit="处", color="#309aff", classes=["school", "university", "college", "kindergarten"]),
    dict(name="医疗设施", short="医疗", icon="hospital", unit="处", color="#ff5770", classes=["hospital", "clinic", "doctors", "dentist"]),
    dict(name="公园绿地", short="公园", icon="tree", unit="处", color="#2bdaaa", classes=["park"]),
    dict(name="餐饮美食", short="餐饮", icon="food", unit="处", color="#efaa48", classes=["restaurant", "fast_food", "cafe", "food_court", "bar", "pub"]),
    dict(name="住宿酒店", short="酒店", icon="building", unit="处", color="#8584ff", classes=["hotel", "guesthouse", "hostel", "motel", "chalet"]),
]
CLASS_CATEGORY = {c: item["name"] for item in CATEGORIES for c in item["classes"]}
LAND_GROUPS = [
    ("居住", "#5ddccb", {"residential"}),
    ("农用", "#b7c878", {"farmland", "farmyard", "orchard", "allotments"}),
    ("林草", "#83bda3", {"forest", "grass", "scrub", "meadow", "heath"}),
    ("工业", "#8999b0", {"industrial"}),
    ("商业", "#728cb5", {"commercial", "retail"}),
    ("其他", "#bdc8c7", set()),
]


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, (tuple, list)):
        return [rounded(v) for v in value]
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    return value


def write_json(path, data):
    path.write_text(json.dumps(rounded(data), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("D:/GIS学习/研究方向/GISdata"))
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "public/data/demo")
    args = parser.parse_args()
    sources = {p.stem: p for p in args.source.rglob("*.shp")}
    args.output.mkdir(parents=True, exist_ok=True)
    provenance = []
    source_readme = (args.source / "99_数据说明/README_OSM来源.txt").read_text(encoding="utf-8-sig")
    timestamp_match = re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", source_readme)
    if not timestamp_match:
        raise ValueError("Cannot find OSM source timestamp in README_OSM来源.txt")

    def read(layer, bbox=None):
        path = sources[f"gis_osm_{layer}_1"]
        provenance.append(str(path.relative_to(args.source)).replace("\\", "/"))
        with fiona.open(path, encoding="UTF-8") as collection:
            if collection.crs.to_epsg() != 4326:
                raise ValueError(f"Expected EPSG:4326: {path}")
            yield from collection.filter(bbox=bbox) if bbox else collection

    boundary_records = [f for f in read("adminareas_a_free") if f.properties["name"] == "武汉市" and f.properties["fclass"] == "admin_level5"]
    if len(boundary_records) != 1:
        raise ValueError(f"Expected one Wuhan boundary, found {len(boundary_records)}")
    boundary = make_valid(shape(boundary_records[0].geometry))
    prepared = prep(boundary)
    bbox = boundary.bounds
    counts = {}

    def export(name, features):
        counts[name] = len(features)
        write_json(args.output / f"{name}.geojson", dict(type="FeatureCollection", features=features))
        print(f"{name}: {len(features)}", flush=True)

    def feature(geom, props):
        return dict(type="Feature", geometry=mapping(geom), properties=props)

    export("boundary", [feature(boundary.simplify(.0001, preserve_topology=True), dict(boundary_records[0].properties))])
    land_areas = defaultdict(float)
    for output, layer, tolerance in [("roads", "roads_free", .00004), ("water", "water_a_free", .00004), ("landuse", "landuse_a_free", .00004), ("buildings", "buildings_a_free", .00001)]:
        features = []
        for record in read(layer, bbox):
            geom = shape(record.geometry)
            if not geom.is_valid:
                geom = make_valid(geom)
            if not prepared.intersects(geom):
                continue
            clipped = geom if prepared.covers(geom) else geom.intersection(boundary)
            if clipped.is_empty:
                continue
            props = dict(record.properties)
            if output == "landuse":
                group = next((name for name, _, classes in LAND_GROUPS if props["fclass"] in classes), "其他")
                # Record-area shares: overlaps are explicitly disclosed in the manifest.
                land_areas[group] += abs(GEOD.geometry_area_perimeter(orient(clipped))[0]) / 1e6
            features.append(feature(clipped.simplify(tolerance, preserve_topology=True), props))
        export(output, features)

    pois = []
    seen = set()
    for layer in ["transport_free", "transport_a_free", "pois_free", "pois_a_free"]:
        for record in read(layer, bbox):
            props = dict(record.properties)
            category = CLASS_CATEGORY.get(props["fclass"])
            if not category:
                continue
            geom = make_valid(shape(record.geometry))
            if not prepared.intersects(geom):
                continue
            # OSM node and way identifiers have separate namespaces.
            kind = "way" if "_a_" in layer else "node"
            key = (kind, props["osm_id"], category)
            if key in seen:
                continue
            seen.add(key)
            point = geom.intersection(boundary).representative_point()
            props.update(category=category, source_layer=layer, osm_type=kind, point_method="original" if kind == "node" else "representative_point")
            pois.append(feature(point, props))
    export("pois", pois)
    category_counts = Counter(f["properties"]["category"] for f in pois)
    total_area = sum(land_areas.values())
    metadata = dict(
        title="武汉市本地 GIS 演示数据", source_root=str(args.source.resolve()),
        generated_at=datetime.now(timezone.utc).isoformat(), crs="EPSG:4326",
        source="OpenStreetMap / Geofabrik 湖北省", source_timestamp=timestamp_match.group(),
        attribution="© OpenStreetMap contributors · ODbL 1.0", license="https://opendatacommons.org/licenses/odbl/1-0/",
        extent=list(bbox), boundary_osm_id=boundary_records[0].properties["osm_id"],
        boundaryAreaKm2=round(abs(GEOD.geometry_area_perimeter(orient(boundary))[0])/1e6, 2),
        counts=counts, facilities=[{**item, "count": category_counts[item["name"]]} for item in CATEGORIES],
        landUse=[dict(name=f"{name}用地", color=color, value=round(land_areas[name] / total_area * 100, 1), areaKm2=round(land_areas[name], 3)) for name, color, _ in LAND_GROUPS],
        landRecordAreaKm2=round(total_area, 1), files=provenance,
        notes=["以 OSM 武汉市行政边界裁剪；展示几何经简化，非测绘精度。", "设施数为所选分类的 OSM 点和面记录数；面取内部代表点；按 OSM 类型和 ID 去重，不保证同一实体的点面去重或完整覆盖。", "轨道车站包括铁路车站及有轨电车站，不能解释为地铁站总数。", "土地利用比例按 OSM 面记录椭球面积之和计算，记录可能重叠，不代表完整土地覆盖；未使用 CLCD 栅格或人口数据。", "等时圈由独立的本地路网服务求解，圈面是点阵近似；附近设施时间仍为直线距离估算，未接入人口数据。"],
    )
    write_json(args.output / "manifest.json", metadata)
    (args.output / "SOURCE.txt").write_text(source_readme + "\nExport details and limitations: manifest.json\n", encoding="utf-8")


if __name__ == "__main__":
    main()
