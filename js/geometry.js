/* Second Screen · geometry
   Projective (homography) helpers behind the corner-pin warp.
   Quads are always ordered TL, TR, BL, BR. Polygons (screens) are cyclic. */
(function (SS) {
  "use strict";

  // 3x3 matrix helpers, row-major arrays of 9
  function adj(m) {
    return [m[4]*m[8]-m[5]*m[7], m[2]*m[7]-m[1]*m[8], m[1]*m[5]-m[2]*m[4],
            m[5]*m[6]-m[3]*m[8], m[0]*m[8]-m[2]*m[6], m[2]*m[3]-m[0]*m[5],
            m[3]*m[7]-m[4]*m[6], m[1]*m[6]-m[0]*m[7], m[0]*m[4]-m[1]*m[3]];
  }
  function mm(a, b) {
    const c = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[3*i+k] * b[3*k+j];
      c[3*i+j] = s;
    }
    return c;
  }
  function mv(m, v) {
    return [m[0]*v[0]+m[1]*v[1]+m[2]*v[2],
            m[3]*v[0]+m[4]*v[1]+m[5]*v[2],
            m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];
  }
  function basis(p) {
    const m = [p[0], p[2], p[4], p[1], p[3], p[5], 1, 1, 1];
    const v = mv(adj(m), [p[6], p[7], 1]);
    return mm(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
  }
  // homography taking 4 source points onto 4 destination points (flat arrays of 8)
  function projection(s, d) { return mm(basis(d), adj(basis(s))); }

  function flat(q) { return [q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], q[3][0], q[3][1]]; }

  // rectangle (0,0)-(w,h) onto quad
  function rectToQuad(w, h, q) { return projection([0, 0, w, 0, 0, h, w, h], flat(q)); }
  function quadToUnit(q) { return projection(flat(q), [0, 0, 1, 0, 0, 1, 1, 1]); }

  function apply(H, x, y) {
    const X = H[0]*x + H[1]*y + H[2];
    const Y = H[3]*x + H[4]*y + H[5];
    const W = H[6]*x + H[7]*y + H[8];
    return [X / W, Y / W];
  }

  // CSS matrix3d for a homography (column-major, z untouched)
  function matrix3d(t) {
    const n = t.map(v => v / t[8]);
    return "matrix3d(" + [n[0], n[3], 0, n[6], n[1], n[4], 0, n[7], 0, 0, 1, 0, n[2], n[5], 0, n[8]]
      .map(v => (Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(10))).join(",") + ")";
  }

  // point -> (u,v) in a quad's unit space
  function uv(q, x, y) { return apply(quadToUnit(q), x, y); }

  // sub-rectangle of a quad, in its own unit space
  function uvRect(q, u0, u1, v0, v1) {
    const H = rectToQuad(1, 1, q);
    return [apply(H, u0, v0), apply(H, u1, v0), apply(H, u0, v1), apply(H, u1, v1)];
  }

  function centroid(pts) {
    let x = 0, y = 0;
    pts.forEach(p => { x += p[0]; y += p[1]; });
    return [x / pts.length, y / pts.length];
  }
  function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(p => {
      if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1];
      if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1];
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // average edge lengths of a TL,TR,BL,BR quad
  function quadDims(q) {
    return { w: (dist(q[0], q[1]) + dist(q[2], q[3])) / 2,
             h: (dist(q[0], q[2]) + dist(q[1], q[3])) / 2 };
  }
  // TL,TR,BL,BR -> cyclic TL,TR,BR,BL
  function cyc(q) { return [q[0], q[1], q[3], q[2]]; }

  // put four loose points into TL, TR, BL, BR order
  function orderQuad(pts) {
    const c = centroid(pts);
    const ring = pts.slice().sort((a, b) =>
      Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
    let k = 0, best = Infinity;
    ring.forEach((p, i) => { const s = p[0] + p[1]; if (s < best) { best = s; k = i; } });
    const r = [0, 1, 2, 3].map(i => ring[(k + i) % 4]);
    const cross = (r[1][0] - r[0][0]) * (r[2][1] - r[0][1]) - (r[1][1] - r[0][1]) * (r[2][0] - r[0][0]);
    const cw = cross > 0 ? r : [r[0], r[3], r[2], r[1]];
    return [cw[0], cw[1], cw[3], cw[2]];
  }

  // a TL,TR,BL,BR quad is safe to warp only while it stays convex
  function isConvex(q) {
    const p = cyc(q);
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
      const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(z) < 1e-6) return false;
      const s = z > 0 ? 1 : -1;
      if (!sign) sign = s; else if (s !== sign) return false;
    }
    return true;
  }

  function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (((a[1] > pt[1]) !== (b[1] > pt[1])) &&
          (pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0])) inside = !inside;
    }
    return inside;
  }

  function rectQuad(x, y, w, h) { return [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]; }
  function scaleQuad(q, sx, sy) { return q.map(p => [p[0] * sx, p[1] * sy]); }
  function clone(pts) { return pts.map(p => [p[0], p[1]]); }

  SS.geo = { projection, rectToQuad, quadToUnit, apply, matrix3d, uv, uvRect, centroid, bbox,
             dist, quadDims, cyc, orderQuad, isConvex, pointInPoly, rectQuad, scaleQuad, clone };
})(window.SS = window.SS || {});
