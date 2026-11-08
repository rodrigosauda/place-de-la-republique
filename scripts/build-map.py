"""
scripts/build-map.py
Turns the OpenStreetMap export (data/republique-osm.json) into the compact game map
client/scene/mapData.json.

Coordinates: metres, origin = the Monument à la République, rotated so the long
side of Place de la République runs along x (west = -x towards Boulevard de Magenta,
east = +x towards Boulevard du Temple / Voltaire). y is up, z is the other ground axis.

Map data © OpenStreetMap contributors (ODbL).
Run:  python3 scripts/build-map.py        (needs: pip install shapely)
"""
import json, math, random
from shapely.geometry import Polygon, LineString, Point, MultiPolygon
from shapely.ops import unary_union

SRC = 'data/republique-osm.json'
OUT = 'client/scene/mapData.json'
BOUND_X, BOUND_Z = 330, 260          # playable/visible map half sizes (m)
DETAIL_RADIUS = 240                  # façade details only near the square
random.seed(1789)

d = json.load(open(SRC))
M = lambda pts: [(x / 10, z / 10) for x, z in pts]

def q(v):                             # metres -> decimetre ints (small JSON)
    return int(round(v * 10))

def flat(coords):
    out = []
    for x, z in coords:
        out += [q(x), q(z)]
    return out

def ring_of(poly, ccw=True):
    c = list(poly.exterior.coords)[:-1]
    area = sum(c[i][0] * c[(i + 1) % len(c)][1] - c[(i + 1) % len(c)][0] * c[i][1] for i in range(len(c))) / 2
    if (area > 0) != ccw:
        c.reverse()
    return c

inside_box = lambda x, z: abs(x) < BOUND_X + 40 and abs(z) < BOUND_Z + 40

# ------------------------------------------------------------------ roads
WIDTH = {'p': 13, 's': 9, 't': 8, 'r': 6.5, 'l': 6, 'u': 6}
road_lines = []
for pts, kind, oneway in d['ra']:
    p = M(pts)
    if len(p) < 2:
        continue
    w = WIDTH.get(kind[0], 5)
    if kind == 's':              # "service" (no lanes tag): narrow
        w = 5
    if len(kind) > 1 and kind[1:].isdigit():
        w = max(w, int(kind[1:]) * 3.3)
    road_lines.append(LineString(p).buffer(w / 2, cap_style='flat', join_style='round', quad_segs=4))
roads = unary_union(road_lines).simplify(0.25)

# ------------------------------------------------------------ the square
square = Polygon(M(d['square'])).buffer(0)
monument = Polygon(M(d['mon'])).buffer(0)
peds = []
for outer, holes in d['pa']:
    try:
        poly = Polygon(M(outer), [M(h) for h in holes]).buffer(0)
        if poly.area > 20:
            peds.append(poly)
    except Exception:
        pass
pedestrian = unary_union(peds + [square]).simplify(0.2)
roads = roads.difference(pedestrian.buffer(0.01)).simplify(0.25)

def polys(geom):
    if geom.is_empty:
        return []
    return list(geom.geoms) if hasattr(geom, 'geoms') else [geom]

def pack_area(geom, min_area=4):
    out = []
    for p in polys(geom):
        if p.area < min_area or not isinstance(p, Polygon):
            continue
        b = p.bounds
        if b[2] < -BOUND_X - 40 or b[0] > BOUND_X + 40 or b[3] < -BOUND_Z - 40 or b[1] > BOUND_Z + 40:
            continue
        out.append({'o': flat(ring_of(p, True)), 'h': [flat(list(h.coords)[:-1]) for h in p.interiors if Polygon(h).area > 1]})
    return out

# -------------------------------------------------------------- buildings
street_space = unary_union([roads, pedestrian])
near_street = street_space.buffer(16)
buildings = []
foot_union = []
for pts, h in d['b']:
    p = Polygon(M(pts)).buffer(0)
    if not isinstance(p, Polygon) or p.area < 6:
        continue
    c = p.centroid
    if not inside_box(c.x, c.y) or p.intersects(square.buffer(-1)):
        continue
    p = p.simplify(0.35)
    if not isinstance(p, Polygon) or p.area < 6:
        continue
    # Height: OSM height if known, otherwise a Haussmann block (5 or 6 storeys).
    if h:
        top = max(6.0, min(36.0, float(h)))
    else:
        top = 4.6 + 2.8 + 3.2 * (5 if random.random() < 0.6 else 4)
    if top >= 8:
        foot_union.append(p)   # low verandas/kiosks don't hide the façade behind them
    ring = ring_of(p, True)
    n = len(ring)
    # Which edges face a street (get shops, windows, balconies)?
    facing = ''
    for i in range(n):
        (x1, z1), (x2, z2) = ring[i], ring[(i + 1) % n]
        L = math.hypot(x2 - x1, z2 - z1)
        if L < 3.5:
            facing += '0'
            continue
        mx, mz = (x1 + x2) / 2, (z1 + z2) / 2
        # outward normal of a counter-clockwise ring (x right, z down in math coords)
        nx, nz = (z2 - z1) / L, -(x2 - x1) / L
        test = Point(mx + nx * 3, mz + nz * 3)
        if p.contains(test):          # wrong side: flip
            nx, nz = -nx, -nz
            test = Point(mx + nx * 3, mz + nz * 3)
        visible = math.hypot(mx, mz) < DETAIL_RADIUS
        facing += '1' if (visible and test.within(near_street) and street_space.distance(test) < 15) else '0'
    buildings.append({'p': flat(ring), 't': q(top), 'f': facing, 'poly': p})

# Remove facing flags where another building is right in front (party walls).
all_feet = unary_union(foot_union)
for b in buildings:
    ring = [(b['p'][i] / 10, b['p'][i + 1] / 10) for i in range(0, len(b['p']), 2)]
    f = list(b['f'])
    for i, ch in enumerate(f):
        if ch != '1':
            continue
        (x1, z1), (x2, z2) = ring[i], ring[(i + 1) % len(ring)]
        L = math.hypot(x2 - x1, z2 - z1)
        mx, mz = (x1 + x2) / 2, (z1 + z2) / 2
        nx, nz = (z2 - z1) / L, -(x2 - x1) / L
        if b['poly'].contains(Point(mx + nx, mz + nz)):
            nx, nz = -nx, -nz
        if all_feet.contains(Point(mx + nx * 1.5, mz + nz * 1.5)):
            f[i] = '0'
    b['f'] = ''.join(f)
    del b['poly']

# --------------------------------------------------------- points of interest
def keep(x, z, margin=0):
    return abs(x) < BOUND_X - margin and abs(z) < BOUND_Z - margin

blocked = unary_union([all_feet, roads, monument.buffer(9)])
trees = []
for x, z, h in d['t']:
    x, z = x / 10, z / 10
    if keep(x, z, 2) and not all_feet.buffer(1.5).contains(Point(x, z)) and not roads.buffer(-0.5).contains(Point(x, z)):
        trees += [q(x), q(z), int(h or 0)]
lamps = []
for x, z in d['l']:
    x, z = x / 10, z / 10
    if keep(x, z) and not all_feet.contains(Point(x, z)) and not monument.buffer(8).contains(Point(x, z)):
        lamps += [q(x), q(z)]
metro = []
for x, z in d['m']:
    x, z = x / 10, z / 10
    if keep(x, z, 5) and not all_feet.buffer(1).contains(Point(x, z)):
        metro += [q(x), q(z)]
benches, fountains, cafes = [], [], []
for x, z, kind, name in d['misc']:
    x, z = x / 10, z / 10
    if not keep(x, z, 5):
        continue
    if kind == 'bench' and not blocked.contains(Point(x, z)):
        benches += [q(x), q(z)]
    elif kind == 'fountain' and not blocked.contains(Point(x, z)):
        fountains += [q(x), q(z)]
    elif kind == 'cafe':
        # Put the terrace on the pavement in front of the nearest street-facing wall.
        best = None
        for b in buildings:
            ring = [(b['p'][i] / 10, b['p'][i + 1] / 10) for i in range(0, len(b['p']), 2)]
            for i, ch in enumerate(b['f']):
                if ch != '1':
                    continue
                (x1, z1), (x2, z2) = ring[i], ring[(i + 1) % len(ring)]
                seg = LineString([(x1, z1), (x2, z2)])
                dist = seg.distance(Point(x, z))
                if dist < 12 and (best is None or dist < best[0]):
                    best = (dist, x1, z1, x2, z2, b)
        if best:
            _, x1, z1, x2, z2, b = best
            L = math.hypot(x2 - x1, z2 - z1)
            t = max(0.15, min(0.85, ((x - x1) * (x2 - x1) + (z - z1) * (z2 - z1)) / (L * L)))
            px, pz = x1 + (x2 - x1) * t, z1 + (z2 - z1) * t
            nx, nz = (z2 - z1) / L, -(x2 - x1) / L
            poly = Polygon([(b['p'][i] / 10, b['p'][i + 1] / 10) for i in range(0, len(b['p']), 2)])
            if poly.contains(Point(px + nx, pz + nz)):
                nx, nz = -nx, -nz
            # Step out past verandas / kiosks in front of the café.
            every = unary_union([Polygon([(bb['p'][i] / 10, bb['p'][i + 1] / 10) for i in range(0, len(bb['p']), 2)]) for bb in buildings
                                 if abs(bb['p'][0] / 10 - px) < 60 and abs(bb['p'][1] / 10 - pz) < 60]).buffer(0)
            out_d = 0.3
            while out_d < 10 and every.contains(Point(px + nx * (out_d + 0.6), pz + nz * (out_d + 0.6))):
                out_d += 0.5
            cafes.append([q(px + nx * out_d), q(pz + nz * out_d), round(math.atan2(nx, nz), 3), name[:22], round(min(L * 0.8, 12), 1)])

# The ground around the square (everything not road, not square = pavement).
out = {
    'attribution': '© OpenStreetMap contributors',
    'bounds': [BOUND_X, BOUND_Z],
    'roads': pack_area(roads),
    'pedestrian': pack_area(pedestrian.difference(monument.buffer(0.5))),
    'square': flat(ring_of(square, True)),
    'buildings': buildings,
    'trees': trees, 'lamps': lamps, 'metro': metro, 'benches': benches, 'fountains': fountains, 'cafes': cafes,
}
json.dump(out, open(OUT, 'w'), separators=(',', ':'))
print('buildings', len(buildings), 'facing edges', sum(b['f'].count('1') for b in buildings),
      'roads', len(out['roads']), 'ped', len(out['pedestrian']), 'trees', len(trees) // 3, 'lamps', len(lamps) // 2,
      'metro', len(metro) // 2, 'benches', len(benches) // 2, 'cafes', len(cafes), 'bytes', len(json.dumps(out, separators=(',', ':'))))
print('square bounds', square.bounds, 'monument centroid', monument.centroid)
print([c for c in cafes if abs(c[0]) < 1500 and abs(c[1]) < 900])
