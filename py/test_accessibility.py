"""Small analytical networks verify travel times independently of Wuhan data."""
import math
import unittest

import numpy as np
from shapely.geometry import Polygon, shape, box, Point
from shapely.ops import transform
import shapely

from accessibility import Network, UNPROJECT, PROJECT, AnalysisError, edge_rules, validate

X, Y = 500000, 3380000


def edge(u, v, coords, kind='residential', direction='B', limit=0, bridge=False):
    return [u, v, [(X+x, Y+y) for x,y in coords], kind, direction, limit, bridge]


def network(edges, nodes=None, waters=None):
    return Network(dict(nodes=nodes or [[X,Y],[X+100,Y],[X+200,Y],[X+100,Y+100]], edges=edges), waters)


class AccessibilityTests(unittest.TestCase):
    def test_time_and_partial_edge_from_midpoint(self):
        n=network([edge(0,1,[(0,0),(100,0)])])
        solved=n.solve(list(UNPROJECT(X+50,Y)), 'walk', 3.6, 20)
        self.assertTrue(np.isinf(solved['distances']).all())
        parts,length=n.reachable_parts(solved,20)
        self.assertAlmostEqual(length,40,places=5)
        self.assertAlmostEqual(parts[0].bounds[0],X+30,places=5)
        self.assertAlmostEqual(parts[0].bounds[2],X+70,places=5)

    def test_shortest_path_uses_fast_alternative(self):
        # Direct edge takes 100 s at 3.6 km/h. Two residential edges have
        # a 60 m combined length and must beat it.
        n=network([edge(0,1,[(0,0),(100,0)]),edge(0,3,[(0,0),(30,0)]),edge(3,1,[(30,0),(60,0)])])
        solved=n.solve(list(UNPROJECT(X,Y)), 'walk', 3.6, 120)
        self.assertAlmostEqual(solved['distances'][1],60,places=4)

    def test_one_way_seed_cannot_reach_upstream_endpoint(self):
        n=network([edge(0,1,[(0,0),(100,0)],direction='F')])
        solved=n.solve(list(UNPROJECT(X+50,Y)), 'bike', 18, 60)
        self.assertTrue(math.isinf(solved['distances'][0]))
        self.assertAlmostEqual(solved['distances'][1],10,places=4)
        _,length=n.reachable_parts(solved,60)
        self.assertAlmostEqual(length,50,places=4)
        walk=n.solve(list(UNPROJECT(X+50,Y)), 'walk', 3.6, 60)
        self.assertAlmostEqual(walk['distances'][0],50,places=4)

    def test_reverse_one_way_and_exact_junction(self):
        n=network([edge(0,1,[(0,0),(100,0)],direction='T'),edge(1,2,[(100,0),(200,0)],direction='F')])
        solved=n.solve(list(UNPROJECT(X+100,Y)), 'bike',18,60)
        self.assertAlmostEqual(solved['distances'][0],20,places=4)
        self.assertAlmostEqual(solved['distances'][2],20,places=4)

    def test_access_time_is_included(self):
        n=network([edge(0,1,[(0,0),(100,0)])])
        solved=n.solve(list(UNPROJECT(X+50,Y+10)), 'walk',3.6,20)
        self.assertAlmostEqual(solved['access'],10,places=4)
        _,length=n.reachable_parts(solved,20)
        self.assertAlmostEqual(length,20,places=4)

    def test_water_blocks_origin_connector(self):
        n=network([edge(0,1,[(0,0),(100,0)])],waters=[box(X-100,Y+2,X+200,Y+8)])
        with self.assertRaisesRegex(AnalysisError,'连接线不能跨水域'):
            n.solve(list(UNPROJECT(X+50,Y+10)), 'walk',3.6,60)

    def test_network_gap_and_remote_origin_are_not_connected(self):
        n=network([edge(0,1,[(0,0),(100,0)]),edge(2,3,[(100.1,0),(200,0)])])
        solved=n.solve(list(UNPROJECT(X,Y)), 'walk',3.6,600)
        self.assertTrue(math.isinf(solved['distances'][2]))
        with self.assertRaises(AnalysisError):
            n.solve(list(UNPROJECT(X,Y+500)), 'walk',3.6,600)

    def test_no_motorway_walking_and_car_respects_limit(self):
        self.assertEqual(edge_rules(edge(0,1,[(0,0),(100,0)],kind='motorway'),'walk',5),(False,False,0))
        self.assertEqual(edge_rules(edge(0,1,[(0,0),(100,0)],kind='steps'),'car',35),(False,False,0))
        self.assertAlmostEqual(edge_rules(edge(0,1,[(0,0),(100,0)],limit=10),'car',60)[2],10/3.6)

    def test_no_partial_edge_double_count(self):
        n=network([edge(0,1,[(0,0),(100,0)])])
        solved=n.solve(list(UNPROJECT(X+50,Y)), 'walk',3.6,600)
        _,length=n.reachable_parts(solved,600)
        self.assertAlmostEqual(length,100,places=4)

    def test_polygons_are_valid_nested_and_end_at_requested_time(self):
        n=network([edge(0,1,[(0,0),(100,0)]),edge(1,2,[(100,0),(900,0)])])
        result=n.analyze(dict(origin=list(UNPROJECT(X,Y)),mode='walk',minutes=12,speedKmh=3.6))
        self.assertEqual([f['properties']['minutes'] for f in result['features']],[5,10,12])
        polygons=[shape(f['geometry']) for f in result['features']]
        self.assertTrue(all(p.is_valid for p in polygons))
        for inner,outer in zip(polygons,polygons[1:]):
            self.assertLess(inner.difference(outer).area,1e-10)
        self.assertAlmostEqual(result['metadata']['reachableRoadKm'],.72,places=3)

    def test_reject_bad_inputs(self):
        good=dict(origin=[114.395,30.52],mode='walk',minutes=15,speedKmh=5)
        for patch in [dict(minutes=0),dict(minutes=61),dict(minutes=True),dict(minutes=float('nan')),dict(origin=[181,30]),dict(speedKmh=0),dict(mode='transit')]:
            with self.assertRaises(AnalysisError):
                validate(good|patch)

    def test_radius_validates_independently_of_minutes(self):
        good=dict(origin=[114.395,30.52],mode='walk',constraint='radius',radiusKm=5,speedKmh=5)
        self.assertIsNone(validate(good)[2])
        for patch in [dict(radiusKm=0),dict(radiusKm=21),dict(radiusKm=True),dict(radiusKm=float('nan')),dict(radiusKm='5'),dict(constraint='distance')]:
            with self.assertRaises(AnalysisError):
                validate(good|patch)

    def test_radius_clips_roads_and_partitions_area_without_overlap(self):
        n=network([edge(0,1,[(0,0),(300,0)])])
        r=n.analyze(dict(origin=list(UNPROJECT(X,Y)),mode='walk',constraint='radius',radiusKm=.1,speedKmh=3.6))
        study=shape(r['studyArea']['features'][0]['geometry'])
        bands=[shape(f['geometry']) for f in r['timeBands']['features'] if f['geometry']]
        empty=shape(r['unclassifiedArea']['features'][0]['geometry'])
        self.assertLess(shapely.union_all(bands+[empty]).symmetric_difference(study).area,1e-10)
        for i,a in enumerate(bands):
            for b in bands[i+1:]:
                self.assertLess(a.intersection(b).area,1e-10)
        for feature in r['features']:
            if feature['geometry']:
                self.assertLess(shape(feature['geometry']).difference(study).area,1e-10)
        road=transform(PROJECT,shape(r['reachableRoads']['features'][0]['geometry']))
        self.assertLessEqual(road.bounds[2],X+100.01)
        self.assertAlmostEqual(r['metadata']['reachableRoadKm'],.1,places=3)
        self.assertAlmostEqual(r['metadata']['studyAreaKm2'],math.pi*.1**2,places=4)

    def test_radius_routes_can_leave_circle_and_take_over_sixty_minutes(self):
        # A U-shaped detour leaves the 1 km circle. Its return leg in the
        # circle is 12 km from the source along the network, not a 1 km path.
        n=network([edge(0,1,[(0,0),(6000,0)]),edge(1,2,[(6000,0),(6000,1000)]),edge(2,3,[(6000,1000),(0,1000)])])
        request=dict(origin=list(UNPROJECT(X,Y)),mode='walk',constraint='radius',radiusKm=1,speedKmh=3.6)
        r=n.analyze(request)
        self.assertGreater(r['metadata']['maxSampleMinutes'],60)
        self.assertGreater(r['features'][-1]['properties']['minutes'],60)
        self.assertTrue(r['metadata']['routesMayLeaveRadius'])
        target=Point(UNPROJECT(X+50,Y+960))
        self.assertTrue(shape(r['features'][-1]['geometry']).covers(target))
        fast=n.analyze(request|dict(speedKmh=7))
        self.assertLess(fast['metadata']['maxSampleMinutes'],r['metadata']['maxSampleMinutes'])

    def test_large_circle_export_has_no_projection_gaps(self):
        n=network([edge(0,1,[(0,0),(6000,0)])])
        r=n.analyze(dict(origin=list(UNPROJECT(X,Y)),mode='walk',constraint='radius',radiusKm=3,speedKmh=5))
        study=shape(r['studyArea']['features'][0]['geometry'])
        pieces=[shape(f['geometry']) for f in r['timeBands']['features'] if f['geometry']]
        pieces.append(shape(r['unclassifiedArea']['features'][0]['geometry']))
        self.assertLess(shapely.union_all(pieces).symmetric_difference(study).area,1e-14)


if __name__=='__main__':
    unittest.main()
