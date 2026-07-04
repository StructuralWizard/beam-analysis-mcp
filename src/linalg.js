// Small dense linear algebra helpers. Models handled by this server are small
// (hundreds of DOFs), so dense Gaussian elimination is fast enough and dependency-free.

export function solveDense(A, b) {
  const n = b.length;
  const M = A.map((row, i) => {
    const r = Array.from(row);
    r.push(b[i]);
    return r;
  });
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = Math.abs(M[i][j]);
      if (v > maxAbs) maxAbs = v;
    }
  }
  const tol = (maxAbs || 1) * 1e-13;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < tol) {
      throw new Error(
        `Stiffness matrix is singular at equation ${col}. The structure is unstable ` +
        `(a mechanism, missing supports, or a node with no stiffness in some direction).`
      );
    }
    if (piv !== col) {
      const t = M[col]; M[col] = M[piv]; M[piv] = t;
    }
    const d = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / d;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

export function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function vCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
export function vNorm(a) { return Math.hypot(a[0], a[1], a[2]); }
export function vUnit(a) {
  const n = vNorm(a);
  if (n < 1e-12) throw new Error('Cannot normalize zero-length vector');
  return vScale(a, 1 / n);
}

// Multiply 3x3 matrix (array of 3 row-arrays) by vector.
export function m3v(R, v) {
  return [
    R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
    R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
    R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
  ];
}
// Multiply transpose of 3x3 matrix by vector.
export function m3tv(R, v) {
  return [
    R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2],
    R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2],
    R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2],
  ];
}

export function zeros(n, m) {
  const A = new Array(n);
  for (let i = 0; i < n; i++) A[i] = new Float64Array(m);
  return A;
}
