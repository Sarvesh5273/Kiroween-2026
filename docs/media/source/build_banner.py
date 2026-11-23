"""Render the README cover from the bundled service assembly. Run with Python, NumPy and Pillow.

The three original meshes are separated along their service axis solely for this illustration.
For consistent typography, use Helvetica Neue/Menlo on macOS or DejaVu Sans/Mono on Linux.
"""
from pathlib import Path
import json
import math
import struct

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve()
ROOT = HERE.parents[3]
MODEL = ROOT / "apps/guide-forge/src/examples/removable-cap.glb"
DEST = HERE.parents[1] / "unboltkit-banner.png"
W, H, S = 1440, 492, 2
X, Y = np.meshgrid(np.arange(W), np.arange(H))


def glow(x, y, rx, ry):
    return np.exp(-((X - x) / rx) ** 2 - ((Y - y) / ry) ** 2)


base = np.zeros((H, W, 3)) + [15, 19, 33]
base += glow(1010, 202, 342, 264)[:, :, None] * [22, 16, 42]
base += glow(76, 0, 610, 230)[:, :, None] * [6, 6, 10]
board = Image.fromarray(base.astype('uint8')).resize((W*S, H*S), Image.Resampling.BILINEAR)
draw = ImageDraw.Draw(board)


def line(points, color, width=1):
    draw.line([(round(x*S), round(y*S)) for x, y in points], fill=color, width=max(1, round(width*S)), joint="curve")


def dot(x, y, color, r=2):
    draw.ellipse(((x-r)*S, (y-r)*S, (x+r)*S, (y+r)*S), fill=color)


def font(pt, weight="regular"):
    system = Path("/System/Library/Fonts")
    linux = Path("/usr/share/fonts/truetype/dejavu")
    if weight == "mono":
        candidates = [(system / "Menlo.ttc", 0), (linux / "DejaVuSansMono.ttf", 0)]
    else:
        bold = weight == "bold"
        candidates = [(system / "HelveticaNeue.ttc", 1 if bold else 0),
                      (linux / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"), 0)]
    return next(ImageFont.truetype(str(p), pt*S, index=i) for p, i in candidates if p.exists())


def word(x, y, text, size, color, weight="regular", tracking=0):
    f = font(size, weight)
    if not tracking:
        draw.text((round(x*S), round(y*S)), text, font=f, fill=color, anchor="ls")
        return
    for char in text:
        draw.text((round(x*S), round(y*S)), char, font=f, fill=color, anchor="ls")
        x += f.getlength(char)/S + tracking


# Drawing field: discrete registration marks and a vertical datum through the assembly.
for y in range(56, 443, 38):
    for x in range(748, 1387, 38):
        dot(x, y, (63, 64, 83), .75)
for x, y in [(758, 45), (1390, 45), (758, 446), (1390, 446)]:
    line([(x-5, y), (x+5, y)], "#716881")
    line([(x, y-5), (x, y+5)], "#716881")
for y in range(40, 454, 10):
    line([(1014, y), (1014, y+4)], "#9081AE", 1)


def unit(a):
    return a / np.maximum(1e-8, np.linalg.norm(a, axis=-1, keepdims=True))


def mesh_data():
    glb = MODEL.read_bytes()
    sz = struct.unpack_from("<I", glb, 12)[0]
    gltf, raw = json.loads(glb[20:20+sz]), glb[28+sz:]
    def acc(i):
        a = gltf["accessors"][i]
        v = gltf["bufferViews"][a["bufferView"]]
        dim = {"VEC3":3, "SCALAR":1}[a["type"]]
        dtype = {5126:"<f4", 5125:"<u4", 5123:"<u2", 5121:"u1"}[a["componentType"]]
        return np.frombuffer(raw, dtype, count=dim*a["count"], offset=v.get("byteOffset",0)+a.get("byteOffset",0)).reshape((-1,dim))
    for node in gltf["nodes"]:
        if "mesh" not in node:
            continue
        prim = gltf["meshes"][node["mesh"]]["primitives"][0]
        yield node["name"], acc(prim["attributes"]["POSITION"]), acc(prim["attributes"]["NORMAL"]), acc(prim["indices"]).reshape(-1,3)


# Orthographic mesh rasterizer. Face-depth testing preserves the ring hole and the real shoulders.
az, el = map(math.radians, [30, 17])
right = np.array([math.cos(az), 0, -math.sin(az)])
eye = np.array([math.sin(az)*math.cos(el), math.sin(el), math.cos(az)*math.cos(el)])
up = np.cross(eye, right)
panel_left, panel_w = 782, 467
tile = np.zeros((H*S, panel_w*S, 4), np.uint8)
depth = np.full(tile.shape[:2], -np.inf)
lights = [unit(np.array(l)) for l in [(-.79,1,.65), (.7,.6,-.5), (-.18,.70,1), (.95,.12,.22)]]
half = [unit(l+eye) for l in lights]
styles = {
    "service_cap": (9.9, [218, 155, 56]),
    "service_ring": (0.0, [206, 53, 93]),
    "spindle": (-10.6, [158, 176, 203]),
}
for name, vertices, normals, faces in mesh_data():
    shift, pigment = styles[name]
    verts = vertices.astype(float).copy()
    verts[:,1] += shift
    scale = 8.05
    sx = (1014-panel_left + scale*(verts@right))*S
    sy = (229 - scale*(verts@up))*S
    z = verts @ eye
    for ix in faces:
        tx, ty = sx[ix], sy[ix]
        x0, x1 = max(0, int(np.floor(min(tx)))), min(panel_w*S, int(np.ceil(max(tx)))+1)
        y0, y1 = max(0, int(np.floor(min(ty)))), min(H*S, int(np.ceil(max(ty)))+1)
        if x0>=x1 or y0>=y1: continue
        denominator = (ty[1]-ty[2])*(tx[0]-tx[2])+(tx[2]-tx[1])*(ty[0]-ty[2])
        if abs(denominator)<1e-8: continue
        xx, yy = np.meshgrid(np.arange(x0,x1)+.5, np.arange(y0,y1)+.5)
        u = ((ty[1]-ty[2])*(xx-tx[2])+(tx[2]-tx[1])*(yy-ty[2]))/denominator
        v = ((ty[2]-ty[0])*(xx-tx[2])+(tx[0]-tx[2])*(yy-ty[2]))/denominator
        w = 1-u-v
        zz = u*z[ix[0]]+v*z[ix[1]]+w*z[ix[2]]
        dep = depth[y0:y1, x0:x1]
        keep = (np.minimum(np.minimum(u,v),w)>=-1e-7)&(zz>dep)
        if not np.any(keep): continue
        dep[keep] = zz[keep]
        n = unit(u[keep,None]*normals[ix[0]] + v[keep,None]*normals[ix[1]] + w[keep,None]*normals[ix[2]])
        diffuse = .40 + .54*np.maximum(0,n@lights[0]) + .13*np.maximum(0,n@lights[1])
        coat = .49*np.maximum(0,n@half[0])**13 + .30*np.maximum(0,n@half[2])**48
        coat += .36*np.maximum(0,n@half[3])**32 + .17*(1-np.clip(n@eye,0,1))**3
        # A broad softbox reflection gives the top plate its shape as well as its colour.
        spread = .17*np.exp(-((xx[keep]/S-175)/72)**2) * np.clip(n[:,1],0,1)
        rgb = np.array(pigment)[None,:] * (diffuse+spread)[:,None] + np.array([243,235,230])[None,:]*coat[:,None]
        tile[y0:y1,x0:x1][keep] = np.c_[np.clip(rgb,0,255),np.full(len(rgb),255)].astype('uint8')
model = Image.fromarray(tile)
board.paste(model,(panel_left*S,0),model)

# Original mark: a spindle passing through two separated isometric rings.
ink, subdued, accent = "#F1F1EB", "#B7B8C8", "#C4ACFF"
def ring_mark(x,y):
    for j, c in [(0,accent),(9,"#9580CC")]:
        line([(x-16,y+j), (x,y-7+j), (x+16,y+j), (x,y+7+j), (x-16,y+j)], c, 2)
    line([(x,y-15),(x,y-8)], accent, 2)
    line([(x,y+16),(x,y+22)], accent, 2)
ring_mark(91,75)
word(129,79,"BUILT WITH KIRO",15,ink,"mono",1.1)
line([(313,64),(313,82)], "#625D76")
word(332,79,"KIROWEEN 2026",15,subdued,"mono",1)
word(68,248,"UnboltKit",142,ink,"bold",-5.6)
word(76,317,"See what comes off next.",40,"#D2D0DC")
line([(78,388),(659,388)], "#444358")
line([(78,388),(121,388)],accent,2)
word(77,424,"01",15,accent,"mono")
word(112,424,"GUIDE FORGE",18,ink,"mono",.9)
word(306,424,"02",15,accent,"mono")
word(341,424,"UNBOLT BLITZ",18,ink,"mono",.9)

# Leaders terminate at the outer edges; they do not obscure the open centre.
for (x,y),(ex,ey),tag,name in [
    ((1150,83),(1196,65),"01","CAP"),
    ((1126,229),(1196,211),"02","SERVICE RING"),
    ((1150,395),(1196,375),"03","SPINDLE"),
]:
    line([(x,y),(x+12,y),(ex,ey),(ex+18,ey)],"#8F879F")
    dot(x,y,ink,2)
    word(1224,ey+5,tag,12,accent,"mono")
    word(1250,ey+5,name,14,ink,"mono",.25)
word(1161,453,"FIG. 01  /  EXPLODED VIEW",13,subdued,"mono",.2)
board.resize((W,H),Image.Resampling.LANCZOS).save(DEST,optimize=True)
