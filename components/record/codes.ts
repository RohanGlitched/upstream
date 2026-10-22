// Real barcodes from a real NDC: a UPC-A for the carton face and a GS1 DataMatrix (ECC 200) for the
// shelf label and the carton. Pure functions, so they render on the server as plain SVG paths.

/* ---------- Data Matrix ECC 200 ---------- */

const GF = (() => {
  const exp = new Array<number>(512);
  const log = new Array<number>(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x12d;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  return { exp, mul: (a: number, b: number) => (a && b ? exp[log[a] + log[b]] : 0) };
})();

function rsEcc(data: number[], n: number): number[] {
  let g = [1];
  for (let i = 1; i <= n; i++) {
    const ng = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      ng[j] ^= g[j];
      ng[j + 1] ^= GF.mul(g[j], GF.exp[i]);
    }
    g = ng;
  }
  const ecc = new Array<number>(n).fill(0);
  for (const d of data) {
    const f = d ^ ecc[0];
    ecc.shift();
    ecc.push(0);
    for (let j = 0; j < n; j++) ecc[j] ^= GF.mul(g[j + 1], f);
  }
  return ecc;
}

// [symbol size, data codewords, error codewords] for the single-region square symbols.
const DM_SIZES: [number, number, number][] = [
  [10, 3, 5], [12, 5, 7], [14, 8, 10], [16, 12, 12], [18, 18, 14], [20, 22, 18], [22, 30, 20], [24, 36, 24], [26, 44, 28],
];

function dmEncodeAscii(str: string, fnc1: boolean): number[] {
  const cw: number[] = [];
  if (fnc1) cw.push(232);
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const d = str[i + 1];
    if (/\d/.test(c) && d !== undefined && /\d/.test(d)) {
      cw.push(130 + parseInt(c + d, 10));
      i++;
    } else cw.push(str.charCodeAt(i) + 1);
  }
  return cw;
}

export interface Matrix {
  size: number;
  path: string; // one module per unit, for an SVG with viewBox "-1 -1 size+2 size+2"
}

export function dataMatrix(str: string, opts: { fnc1?: boolean; minSize?: number } = {}): Matrix {
  const { fnc1 = false, minSize = 10 } = opts;
  const cw = dmEncodeAscii(str, fnc1);
  const spec = DM_SIZES.find((s) => s[1] >= cw.length && s[0] >= minSize) ?? DM_SIZES[DM_SIZES.length - 1];
  const [size, nd, ne] = spec;
  const data = cw.slice(0, nd);
  if (data.length < nd) {
    data.push(129);
    while (data.length < nd) {
      const p = data.length + 1;
      let v = 129 + ((149 * p) % 253) + 1;
      if (v > 254) v -= 254;
      data.push(v);
    }
  }
  const all = data.concat(rsEcc(data, ne));
  const nrow = size - 2;
  const ncol = size - 2;
  const arr = new Array<number>(nrow * ncol).fill(0);
  const place = (r: number, c: number, ch: number, bit: number) => {
    if (r < 0) {
      r += nrow;
      c += 4 - ((nrow + 4) % 8);
    }
    if (c < 0) {
      c += ncol;
      r += 4 - ((ncol + 4) % 8);
    }
    arr[r * ncol + c] = 10 * ch + bit;
  };
  const utah = (r: number, c: number, ch: number) => {
    place(r - 2, c - 2, ch, 1); place(r - 2, c - 1, ch, 2); place(r - 1, c - 2, ch, 3); place(r - 1, c - 1, ch, 4);
    place(r - 1, c, ch, 5); place(r, c - 2, ch, 6); place(r, c - 1, ch, 7); place(r, c, ch, 8);
  };
  const corner1 = (ch: number) => {
    place(nrow - 1, 0, ch, 1); place(nrow - 1, 1, ch, 2); place(nrow - 1, 2, ch, 3); place(0, ncol - 2, ch, 4);
    place(0, ncol - 1, ch, 5); place(1, ncol - 1, ch, 6); place(2, ncol - 1, ch, 7); place(3, ncol - 1, ch, 8);
  };
  const corner2 = (ch: number) => {
    place(nrow - 3, 0, ch, 1); place(nrow - 2, 0, ch, 2); place(nrow - 1, 0, ch, 3); place(0, ncol - 4, ch, 4);
    place(0, ncol - 3, ch, 5); place(0, ncol - 2, ch, 6); place(0, ncol - 1, ch, 7); place(1, ncol - 1, ch, 8);
  };
  const corner3 = (ch: number) => {
    place(nrow - 3, 0, ch, 1); place(nrow - 2, 0, ch, 2); place(nrow - 1, 0, ch, 3); place(0, ncol - 2, ch, 4);
    place(0, ncol - 1, ch, 5); place(1, ncol - 1, ch, 6); place(2, ncol - 1, ch, 7); place(3, ncol - 1, ch, 8);
  };
  const corner4 = (ch: number) => {
    place(nrow - 1, 0, ch, 1); place(nrow - 1, ncol - 1, ch, 2); place(0, ncol - 3, ch, 3); place(0, ncol - 2, ch, 4);
    place(0, ncol - 1, ch, 5); place(1, ncol - 3, ch, 6); place(1, ncol - 2, ch, 7); place(1, ncol - 1, ch, 8);
  };
  let ch = 1;
  let r = 4;
  let c = 0;
  do {
    if (r === nrow && c === 0) corner1(ch++);
    if (r === nrow - 2 && c === 0 && ncol % 4) corner2(ch++);
    if (r === nrow - 2 && c === 0 && ncol % 8 === 4) corner3(ch++);
    if (r === nrow + 4 && c === 2 && !(ncol % 8)) corner4(ch++);
    do {
      if (r < nrow && c >= 0 && !arr[r * ncol + c]) utah(r, c, ch++);
      r -= 2;
      c += 2;
    } while (r >= 0 && c < ncol);
    r += 1;
    c += 3;
    do {
      if (r >= 0 && c < ncol && !arr[r * ncol + c]) utah(r, c, ch++);
      r += 2;
      c -= 2;
    } while (r < nrow && c >= 0);
    r += 3;
    c += 1;
  } while (r < nrow || c < ncol);
  if (!arr[nrow * ncol - 1]) arr[nrow * ncol - 1] = arr[nrow * ncol - ncol - 2] = 1;
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let on: boolean;
      if (x === 0 || y === size - 1) on = true;
      else if (y === 0) on = x % 2 === 0;
      else if (x === size - 1) on = y % 2 === 1;
      else {
        const v = arr[(y - 1) * ncol + (x - 1)];
        on = v === 1 ? true : v > 1 ? ((all[Math.floor(v / 10) - 1] >> (8 - (v % 10))) & 1) === 1 : false;
      }
      if (on) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size, path };
}

/* ---------- UPC-A from an NDC ---------- */

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];

function upcCheck(d11: string): number {
  let s = 0;
  for (let i = 0; i < 11; i++) s += Number(d11[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (s % 10)) % 10;
}

export interface Upc {
  digits: string; // 12 digits
  gtin: string; // 14 digits
  bars: string; // path for the bars, viewBox "0 0 113 40"
  width: number;
}

/** The NDC as printed on the package (10 digits, any hyphenation) becomes the UPC-A "3" + NDC + check. */
export function upcFromNdc(packageNdc: string): Upc | null {
  const ten = ndc10(packageNdc);
  if (!ten) return null;
  const u11 = "3" + ten;
  const digits = u11 + upcCheck(u11);
  let bits = "101";
  for (let i = 0; i < 6; i++) bits += L[Number(digits[i])];
  bits += "01010";
  for (let i = 6; i < 12; i++) bits += L[Number(digits[i])].replace(/./g, (b) => (b === "1" ? "0" : "1"));
  bits += "101";
  const quiet = 9;
  const guard = (i: number) => i < 10 || (i >= 45 && i < 50) || i >= 85;
  let bars = "";
  for (let i = 0; i < bits.length; i++) if (bits[i] === "1") bars += `M${quiet + i} 0h1v${guard(i) ? 36 : 31}h-1z`;
  return { digits, gtin: "00" + digits, bars, width: bits.length + quiet * 2 };
}

/** A 10-digit NDC from a package NDC in 4-4-2, 5-3-2 or 5-4-1 form, or an 11-digit billing NDC. */
export function ndc10(ndc: string): string | null {
  const parts = ndc.split("-");
  if (parts.length === 3) {
    const d = parts.join("");
    if (d.length === 10) return d;
  }
  const d = ndc.replace(/\D/g, "");
  if (d.length === 10) return d;
  if (d.length === 11) {
    // 5-4-2 billing form: drop the padding zero of whichever segment carries it.
    if (d[0] === "0") return d.slice(1);
    if (d[5] === "0") return d.slice(0, 5) + d.slice(6);
    if (d[9] === "0") return d.slice(0, 9) + d.slice(10);
  }
  return null;
}
