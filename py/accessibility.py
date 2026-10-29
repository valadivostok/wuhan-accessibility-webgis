"""Network travel times with a time budget or a radius-limited time field.

The graph solver is exact for the configured edge costs. The area is a sampled
approximation with at most 90 m of walking access to reachable roads. This is an
adaptation of the supplied papers, not their Baidu API or convex-hull algorithms.
"""
import heapq
import json
import math
from pathlib import Path
import sys
import time

import numpy as np
from pyproj import Transformer
import shapely
from shapely.geometry import LineString, Point, shape, mapping
from shapely.ops import transform, substring
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
PROJECT = Transformer.from_crs(4326, 32650, always_xy=True).transform
UNPROJECT = Transformer.from_crs(32650, 4326, always_xy=True).transform
MODES = {'walk': (3, 7), 'bike': (8, 25), 'car': (15, 60)}
NON_MOTOR = {'motorway', 'motorway_link', 'trunk', 'trunk_link'}
NO_CAR = {'footway', 'pedestrian', 'steps', 'path', 'cycleway', 'bridleway'}
CAR_SPEED = {'motorway': 80, 'motorway_link': 40, 'trunk': 60, 'trunk_link': 35,
             'primary': 50, 'primary_link': 30, 'secondary': 40, 'secondary_link': 25,
             'tertiary': 30, 'tertiary_link': 20, 'residential': 25, 'living_street': 10,
             'service': 15, 'unclassified': 25, 'track': 10}


class AnalysisError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def validate(data):
    if not isinstance(data, dict):
        raise AnalysisError('INVALID_INPUT', '请求必须是 JSON 对象')
    origin, mode = data.get('origin'), data.get('mode', 'walk')
    def finite(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    if not isinstance(origin, list) or len(origin) != 2 or not all(finite(v) for v in origin) or not (-180 <= origin[0] <= 180 and -90 <= origin[1] <= 90):
        raise AnalysisError('INVALID_INPUT', '起点必须是 WGS84 经度、纬度')
    if mode not in MODES:
        raise AnalysisError('INVALID_INPUT', '请选择步行、骑行或驾车')
    constraint = data.get('constraint', 'time')
    if constraint not in {'time', 'radius'}:
        raise AnalysisError('INVALID_INPUT', '请选择时间约束或半径范围内时间分区')
    minutes, speed = data.get('minutes'), data.get('speedKmh')
    if constraint == 'time':
        if not finite(minutes) or not 1 <= minutes <= 60:
            raise AnalysisError('INVALID_INPUT', '时间须为 1–60 分钟')
    else:
        radius = data.get('radiusKm')
        if not finite(radius) or not .1 <= radius <= 20:
            raise AnalysisError('INVALID_INPUT', '分析半径须为 0.1–20 km')
        minutes = None
    lo, hi = MODES[mode]
    if not finite(speed) or not lo <= speed <= hi:
        raise AnalysisError('INVALID_INPUT', f'当前方式速度须为 {lo}–{hi} km/h')
    return origin, mode, float(minutes) if minutes is not None else None, float(speed)


def edge_rules(edge, mode, speed):
    """Return forward/backward permission and speed in metres per second."""
    kind, direction, limit = edge[3:6]
    if kind in {'construction', 'proposed', 'abandoned', 'raceway'}:
        return False, False, 0
    if mode != 'car' and kind in NON_MOTOR:
        return False, False, 0
    if mode == 'bike' and kind == 'steps' or mode == 'car' and kind in NO_CAR:
        return False, False, 0
    if mode == 'walk':
        return True, True, speed / 3.6 * (.65 if kind == 'steps' else 1)
    if mode == 'bike':
        velocity = speed * (.65 if kind in {'track', 'path', 'bridleway'} else 1)
    else:
        velocity = CAR_SPEED.get(kind, 20) * speed / 35
        if limit > 0:
            velocity = min(velocity, limit)
    return direction != 'T', direction != 'F', velocity / 3.6


class Network:
    def __init__(self, data, waters=None):
        self.metadata = data.get('metadata', {})
        self.nodes, self.edges = data['nodes'], data['edges']
        self.edge_nodes = np.array([e[:2] for e in self.edges], dtype=np.int64)
        self.lines = np.array([LineString(e[2]) for e in self.edges], dtype=object)
        self.lengths = shapely.length(self.lines)
        self.boundary = shape(data['boundary']) if data.get('boundary') else None
        self.mode_cache = {}
        self.water = np.array(waters or [], dtype=object)
        shapely.prepare(self.water)
        self.water_tree = STRtree(self.water)

    @classmethod
    def load(cls, path=ROOT / 'server/data/road-network.json'):
        if not path.exists():
            raise AnalysisError('NETWORK_MISSING', '路网未准备，请运行 npm run prepare:network')
        data = json.loads(path.read_text(encoding='utf-8'))
        water_path = ROOT / 'public/data/demo/water.geojson'
        waters = []
        if water_path.exists():
            waters = [transform(PROJECT, shape(f['geometry'])) for f in json.loads(water_path.read_text(encoding='utf-8'))['features']]
        return cls(data, waters)

    def mode_graph(self, mode, speed):
        key = (mode, speed)
        if key in self.mode_cache:
            return self.mode_cache[key]
        adjacency = [[] for _ in self.nodes]
        rules = np.array([edge_rules(e, mode, speed) for e in self.edges])
        eligible = np.flatnonzero(rules[:, 2] > 0)
        for i in eligible:
            u, v = self.edges[i][:2]
            forward, backward, velocity = rules[i]
            cost = self.lengths[i] / velocity
            if forward:
                adjacency[u].append((v, cost))
            if backward:
                adjacency[v].append((u, cost))
        result = adjacency, rules, eligible, STRtree(self.lines[eligible])
        # Bound caches when the speed slider is used repeatedly.
        if len(self.mode_cache) >= 3:
            self.mode_cache.pop(next(iter(self.mode_cache)))
        self.mode_cache[key] = result
        return result

    def crosses_water(self, connectors):
        blocked = np.zeros(len(connectors), dtype=bool)
        if len(self.water):
            # Query bounding boxes first, then use prepared water polygons as
            # the FIRST operand. Preparing millions of tiny access lines is
            # much slower than reusing the prepared complex lake boundaries.
            pairs = self.water_tree.query(connectors)
            hits = shapely.intersects(self.water[pairs[1]], np.asarray(connectors, dtype=object)[pairs[0]])
            blocked[pairs[0][hits]] = True
        return blocked

    def solve(self, origin, mode, speed, budget):
        point = Point(PROJECT(*origin))
        if self.boundary is not None and not self.boundary.covers(point):
            raise AnalysisError('OUTSIDE_STUDY_AREA', '起点不在武汉市分析范围内，请重新选择')
        adjacency, rules, eligible, tree = self.mode_graph(mode, speed)
        if not len(eligible):
            raise AnalysisError('NO_ROAD', '没有符合当前方式的道路')
        # Try nearby legal connectors; do not snap across a lake or river.
        options = tree.query(point.buffer(200), predicate='intersects')
        options = sorted((int(eligible[i]) for i in options), key=lambda i: point.distance(self.lines[i]))
        snapped = None
        for index in options:
            offset = self.lines[index].project(point)
            location = self.lines[index].interpolate(offset)
            distance = point.distance(location)
            if distance > 200:
                continue
            if distance > .05 and self.crosses_water([LineString([point, location])])[0]:
                continue
            snapped = index, offset, location, distance
            break
        if snapped is None:
            raise AnalysisError('NO_ROAD', '起点 200 米内没有可连接道路，请将起点移到道路附近；连接线不能跨水域')
        index, offset, location, distance = snapped
        # The initial access leg is walking, including for bike/car starts.
        access = distance / (min(speed, 5) / 3.6)
        if access >= budget:
            raise AnalysisError('TIME_TOO_SHORT', '时间不足以从起点接入路网，请增大时间或靠近道路')
        forward, backward, velocity = rules[index]
        u, v = self.edges[index][:2]
        distances = np.full(len(self.nodes), np.inf)
        queue = []
        for node, cost, allowed in [(u, offset / velocity, backward), (v, (self.lengths[index]-offset) / velocity, forward)]:
            # At an exact junction all adjoining roads are available, regardless
            # of the direction of the edge selected for snapping.
            if allowed or cost < 1e-6:
                value = access + cost
                if value < distances[node] and value <= budget:
                    distances[node] = value
                    heapq.heappush(queue, (value, node))
        while queue:
            cost, node = heapq.heappop(queue)
            if cost > distances[node]:
                continue
            for neighbor, travel in adjacency[node]:
                value = cost + travel
                if value <= budget and value < distances[neighbor]:
                    distances[neighbor] = value
                    heapq.heappush(queue, (value, neighbor))
        ends = self.edge_nodes[eligible]
        active = ((distances[ends[:, 0]] < budget) & (rules[eligible, 0] > 0)) | ((distances[ends[:, 1]] < budget) & (rules[eligible, 1] > 0)) | (eligible == index)
        return dict(point=point, index=index, offset=offset, location=location, distance=distance,
                    access=access, distances=distances, rules=rules, eligible=eligible, activeEdges=eligible[active])

    def arrivals(self, solved, indices, offsets):
        rules, times = solved['rules'][indices], solved['distances']
        nodes = self.edge_nodes[indices]
        forward = np.where(rules[:, 0] > 0, times[nodes[:, 0]] + offsets / rules[:, 2], np.inf)
        backward = np.where(rules[:, 1] > 0, times[nodes[:, 1]] + (self.lengths[indices]-offsets) / rules[:, 2], np.inf)
        arrival = np.minimum(forward, backward)
        at_source = indices == solved['index']
        delta = offsets - solved['offset']
        direct = np.where(((delta >= 0) & (rules[:, 0] > 0)) | ((delta <= 0) & (rules[:, 1] > 0)),
                          solved['access'] + np.abs(delta) / rules[:, 2], np.inf)
        return np.where(at_source, np.minimum(arrival, direct), arrival)

    def reachable_parts(self, solved, budget):
        """Clip each directed edge at its exact time boundary; merge overlaps."""
        parts, total = [], 0.0
        times, rules = solved['distances'], solved['rules']
        for i in solved['activeEdges']:
            u, v = self.edges[i][:2]
            forward, backward, speed = rules[i]
            length, intervals = self.lengths[i], []
            if forward and times[u] < budget:
                intervals.append((0, min(length, (budget-times[u])*speed)))
            if backward and times[v] < budget:
                intervals.append((max(0, length-(budget-times[v])*speed), length))
            if i == solved['index']:
                reach = (budget-solved['access'])*speed
                intervals.append((max(0, solved['offset']-reach) if backward else solved['offset'],
                                  min(length, solved['offset']+reach) if forward else solved['offset']))
            merged = []
            for lo, hi in sorted(intervals):
                if hi-lo <= 1e-6:
                    continue
                if merged and lo <= merged[-1][1]:
                    merged[-1] = (merged[-1][0], max(hi, merged[-1][1]))
                else:
                    merged.append((lo, hi))
            for lo, hi in merged:
                line = substring(self.lines[i], lo, hi)
                if solved.get('clipArea') is not None:
                    clipped = line.intersection(solved['clipArea'])
                    for part in shapely.get_parts(clipped):
                        if part.geom_type == 'LineString' and part.length > 0:
                            total += part.length
                            parts.append(part)
                else:
                    total += hi-lo
                    parts.append(line)
        return parts, total

    def analyze(self, request):
        origin, mode, minutes, speed = validate(request)
        started = time.perf_counter()
        constraint = request.get('constraint', 'time')
        radius_mode = constraint == 'radius'
        budget = math.inf if radius_mode else minutes*60
        solved = self.solve(origin, mode, speed, budget)
        study_circle = study_area = None
        if radius_mode:
            radius_meters = float(request['radiusKm'])*1000
            study_circle = solved['point'].buffer(radius_meters, quad_segs=128)
            study_area = study_circle.intersection(self.boundary) if self.boundary is not None else study_circle
            # Radius clips the destinations, not the shortest path. Routes may
            # leave and re-enter the circle; no 60-minute cutoff is applied.
            indices = solved['activeEdges']
            solved['activeEdges'] = indices[shapely.intersects(self.lines[indices], study_area.buffer(90))]
            solved['clipArea'] = study_area
        parts, total_length = ([], 0.0) if radius_mode else self.reachable_parts(solved, budget)
        bounds = study_area.bounds if radius_mode else shapely.total_bounds(parts)
        access_limit = 90.0
        width, height = bounds[2]-bounds[0]+2*access_limit, bounds[3]-bounds[1]+2*access_limit
        # 30 m for local walking analyses; adaptive coarsening for large extents.
        grid = max(30, math.ceil(math.sqrt(width*height/300000)/10)*10)
        if grid > 120:
            action = '缩小分析半径' if radius_mode else '缩短时间或降低速度'
            raise AnalysisError('AREA_TOO_LARGE', f'计算范围过大，当前模式支持最高 120 米采样精度，请{action}后重试')
        xmin, ymin = math.floor((bounds[0]-access_limit)/grid)*grid, math.floor((bounds[1]-access_limit)/grid)*grid
        nx, ny = math.ceil((bounds[2]+access_limit-xmin)/grid), math.ceil((bounds[3]+access_limit-ymin)/grid)
        field = np.full((ny, nx), np.inf)
        candidates = solved['activeEdges']
        tree = STRtree(self.lines[candidates])
        access_speed = min(speed, 5) / 3.6
        for row in range(0, ny, 24):
            rows = min(24, ny-row)
            xx, yy = np.meshgrid(xmin+(np.arange(nx)+.5)*grid, ymin+(np.arange(row,row+rows)+.5)*grid)
            points = shapely.points(xx.ravel(), yy.ravel())
            point_ids, local_ids = tree.query(points, predicate='dwithin', distance=access_limit)
            if not len(point_ids):
                continue
            edge_ids = candidates[local_ids]
            offsets = shapely.line_locate_point(self.lines[edge_ids], points[point_ids])
            projected = shapely.line_interpolate_point(self.lines[edge_ids], offsets)
            distance = shapely.distance(points[point_ids], projected)
            arrival = self.arrivals(solved, edge_ids, offsets) + distance / access_speed
            within = np.isfinite(arrival) & (arrival <= budget)
            if radius_mode:
                within &= shapely.intersects(study_area, points[point_ids])
            point_ids, edge_ids, projected, distance, arrival = [v[within] for v in (point_ids, edge_ids, projected, distance, arrival)]
            if not len(point_ids):
                continue
            # Prevent off-road access paths from crossing mapped water. A cell
            # directly on a bridge may still represent the bridge corridor.
            connectors = shapely.linestrings(np.stack([shapely.get_coordinates(points[point_ids]), shapely.get_coordinates(projected)], axis=1))
            blocked = self.crosses_water(connectors)
            bridge = np.array([self.edges[int(i)][6] for i in edge_ids]) & (distance <= min(8, grid/2))
            arrival[blocked & ~bridge] = np.inf
            target = np.full(len(points), np.inf)
            np.minimum.at(target, point_ids, arrival)
            field[row:row+rows] = target.reshape(rows, nx)
        if radius_mode:
            finite_times = field[np.isfinite(field)]
            maximum = float(np.max(finite_times)/60) if len(finite_times) else 0
            final_level = max(30, math.ceil(maximum/15)*15)
            levels = [t for t in [5, 15, 30, 60, 90] if t < final_level] + [final_level]
        else:
            levels = [t for t in [5, 10, 15, 20, 30, 60] if t < minutes] + [minutes]
        features = []
        bands = []
        previous_polygon = shapely.Polygon()
        previous_geographic = shapely.Polygon()
        geographic_study = transform(UNPROJECT, shapely.segmentize(study_area, grid)) if radius_mode else None
        previous_level = 0
        for level in levels:
            mask = field <= level*60
            rectangles = []
            for row, values in enumerate(mask):
                transitions = np.diff(np.r_[False, values, False].astype(np.int8))
                starts, ends = np.flatnonzero(transitions == 1), np.flatnonzero(transitions == -1)
                if len(starts):
                    rectangles.extend(shapely.box(xmin+starts*grid, ymin+row*grid, xmin+ends*grid, ymin+(row+1)*grid))
            if rectangles:
                polygon = shapely.union_all(rectangles)
            else:
                polygon = shapely.Polygon()
            level_parts, length = self.reachable_parts(solved, level*60) if radius_mode or level != minutes else (parts, total_length)
            if radius_mode and level == levels[-1]:
                parts, total_length = level_parts, length
            if polygon.is_empty and level_parts:
                # Very short trips can have no sampled cell. Preserve a thin
                # corridor in that case; larger results use the common field.
                polygon = shapely.union_all(shapely.buffer(level_parts, 2, quad_segs=2))
            if not previous_polygon.is_empty:
                polygon = polygon.union(previous_polygon)
            if self.boundary is not None:
                polygon = polygon.intersection(self.boundary)
            if radius_mode:
                polygon = polygon.intersection(study_area)
            if polygon.is_empty:
                # Lower thresholds may not yet have reached the snapped road.
                features.append(dict(type='Feature', geometry=None, properties=dict(minutes=level, areaKm2=0, reachableRoadKm=0)))
                if radius_mode:
                    bands.append(dict(type='Feature', geometry=None, properties=dict(minMinutes=previous_level, minutes=level, areaKm2=0)))
                previous_level = level
                continue
            polygon = shapely.make_valid(polygon)
            geographic = transform(UNPROJECT, shapely.segmentize(polygon, grid))
            if radius_mode:
                # Partition in the exported CRS too. Independently projecting
                # split circle arcs otherwise leaves tiny geographic slivers.
                geographic = geographic.union(previous_geographic).intersection(geographic_study)
                band = geographic.difference(previous_geographic)
                bands.append(dict(type='Feature', geometry=mapping(band) if not band.is_empty else None,
                                  properties=dict(minMinutes=previous_level, minutes=level, areaKm2=round(transform(PROJECT, band).area/1e6, 4))))
                previous_geographic = geographic
            previous_polygon = polygon
            previous_level = level
            # Shared raster edges get the same projected vertices before
            # conversion; this avoids expensive unions of geographic slivers.
            area = polygon.area / 1e6
            # Do not smooth each threshold independently: preserving the common
            # cell boundaries guarantees nested polygons.
            features.append(dict(type='Feature', geometry=mapping(geographic),
                                 properties=dict(minutes=level, areaKm2=round(area, 4), reachableRoadKm=round(length/1000, 3))))
        result = dict(type='FeatureCollection', features=features, metadata=dict(
            algorithm='network-radius-time-field-v1' if radius_mode else 'network-time-field-v1',
            constraint=constraint, mode=mode, minutes=minutes, speedKmh=speed,
            origin=origin, snappedOrigin=list(UNPROJECT(solved['location'].x, solved['location'].y)),
            snapDistanceMeters=round(solved['distance'], 2), accessSeconds=round(solved['access'], 2),
            gridMeters=grid, maxRoadAccessMeters=access_limit, reachableRoadKm=round(total_length/1000, 3),
            visitedNodes=int(np.isfinite(solved['distances']).sum()), elapsedMs=round((time.perf_counter()-started)*1000),
            source=self.metadata, waterMask=bool(len(self.water)),
            areaMethod='栅格时间场近似面域；路外接驳≤90米；无格心可达时以2米路段走廊表示',
        ), reachableRoads=dict(type='FeatureCollection', features=[dict(type='Feature',
            properties=dict(minutes=minutes, mode=mode), geometry=dict(type='MultiLineString',
            coordinates=[list(transform(UNPROJECT, line.simplify(1)).coords) for line in parts]))]))
        if radius_mode:
            def feature(geometry, properties):
                return dict(type='Feature', geometry=mapping(transform(UNPROJECT, geometry)) if not geometry.is_empty else None, properties=properties)
            unclassified = study_area.difference(previous_polygon)
            result['timeBands'] = dict(type='FeatureCollection', features=bands)
            result['studyArea'] = dict(type='FeatureCollection', features=[dict(type='Feature', geometry=mapping(geographic_study), properties=dict(radiusKm=request['radiusKm']))])
            result['radiusBoundary'] = dict(type='FeatureCollection', features=[feature(study_circle, dict(radiusKm=request['radiusKm']))])
            unclassified_geographic = geographic_study.difference(previous_geographic)
            result['unclassifiedArea'] = dict(type='FeatureCollection', features=[dict(type='Feature', geometry=mapping(unclassified_geographic) if not unclassified_geographic.is_empty else None, properties=dict(status='no_network_time'))])
            result['metadata'].update(radiusKm=float(request['radiusKm']), studyAreaKm2=round(study_area.area/1e6, 4),
                                      unclassifiedAreaKm2=round(unclassified.area/1e6, 4), maxSampleMinutes=round(maximum, 2),
                                      timeLevels=levels, routesMayLeaveRadius=True,
                                      reachableRoadKm=features[-1]['properties']['reachableRoadKm'])
            result['reachableRoads']['features'][0]['properties']['minutes'] = levels[-1]
        return result


def worker():
    network = None
    for line in sys.stdin:
        request_id = None
        try:
            payload = json.loads(line)
            request_id = payload['id']
            validate(payload['request'])
            if network is None:
                network = Network.load()
            result = dict(id=request_id, result=network.analyze(payload['request']))
        except AnalysisError as error:
            result = dict(id=request_id, error=dict(code=error.code, message=str(error)))
        except Exception as error:
            print(f'{type(error).__name__}: {error}', file=sys.stderr, flush=True)
            result = dict(id=request_id, error=dict(code='COMPUTE_ERROR', message='路网计算失败，请检查服务日志'))
        print(json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False), flush=True)


if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    worker()
