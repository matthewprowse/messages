// A small QR code encoder for the WhatsApp linking code, shared by the terminal command and the web page.
// Byte mode only, error correction level M, any version 1 to 40. Follows ISO/IEC 18004, in the shape of
// Project Nayuki's reference implementation. No dependencies, no DOM.

/** Codewords of error correction per block, by version (index 0 unused). Level M. */
const ECC_PER_BLOCK = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28,
];
/** Error correction blocks, by version (index 0 unused). Level M. */
const BLOCKS = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38,
  40, 43, 45, 47, 49,
];
/** Format information bits for level M. */
const LEVEL_BITS = 0;

/** Dark modules are true. The matrix is square, without the quiet zone around it. */
export type QrMatrix = boolean[][];

export function encodeQr(text: string): QrMatrix {
  const data = new TextEncoder().encode(text);
  let version = 1;
  for (; ; version++) {
    if (version > 40) throw new Error("Text too long for a QR code.");
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + data.length * 8 <= dataCodewords(version) * 8) break;
  }

  // Mode, length, data, terminator, then padding to fill the capacity.
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  const capacity = dataCodewords(version) * 8;
  push(0b0100, 4);
  push(data.length, version <= 9 ? 8 : 16);
  for (const b of data) push(b, 8);
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));

  const qr = new Grid(version);
  qr.drawFunctionPatterns();
  qr.drawCodewords(addEccAndInterleave(codewords, version));

  // Every mask gives a valid code. The one with the lowest penalty scans most reliably.
  let best = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    qr.applyMask(mask);
    qr.drawFormatBits(mask);
    const penalty = qr.penalty();
    if (penalty < bestPenalty) {
      best = mask;
      bestPenalty = penalty;
    }
    qr.applyMask(mask); // XOR again to undo
  }
  qr.applyMask(best);
  qr.drawFormatBits(best);
  return qr.modules;
}

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version];
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function reedSolomonDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMultiply(coef, factor)));
  }
  return result;
}

function addEccAndInterleave(data: number[], version: number): number[] {
  const numBlocks = BLOCKS[version];
  const eccLen = ECC_PER_BLOCK[version];
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  const divisor = reedSolomonDivisor(eccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - eccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = reedSolomonRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      // Short blocks carry a placeholder where long blocks have one more data codeword.
      if (i !== shortBlockLen - eccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

class Grid {
  readonly size: number;
  readonly modules: boolean[][];
  private readonly isFunction: boolean[][];

  constructor(private readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  private set(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  drawFunctionPatterns() {
    for (let i = 0; i < this.size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);

    const positions = this.alignmentPositions();
    const n = positions.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) this.set(positions[i] + dx, positions[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }

    this.drawFormatBits(0); // reserves the area; overwritten once the mask is chosen
    if (this.version >= 7) {
      let rem = this.version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (this.version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) !== 0;
        const a = this.size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.set(a, b, dark);
        this.set(b, a, dark);
      }
    }
  }

  private drawFinder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.set(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }

  private alignmentPositions(): number[] {
    if (this.version === 1) return [];
    const count = Math.floor(this.version / 7) + 2;
    const step = this.version === 32 ? 26 : Math.ceil((this.version * 4 + 4) / (count * 2 - 2)) * 2;
    const result = [6];
    for (let pos = this.size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  drawFormatBits(mask: number) {
    const data = (LEVEL_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;

    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));

    for (let i = 0; i < 8; i++) this.set(this.size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, this.size - 15 + i, bit(i));
    this.set(8, this.size - 8, true); // always dark
  }

  drawCodewords(data: number[]) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the vertical timing column
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue;
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  /** The standard's penalty score: long runs, 2x2 blocks, finder-like patterns and imbalance. */
  penalty(): number {
    const n = this.size;
    const at = (x: number, y: number, vertical: boolean) => (vertical ? this.modules[x][y] : this.modules[y][x]);
    let result = 0;

    for (const vertical of [false, true]) {
      for (let y = 0; y < n; y++) {
        let run = 1;
        for (let x = 1; x <= n; x++) {
          if (x < n && at(x, y, vertical) === at(x - 1, y, vertical)) {
            run++;
            continue;
          }
          if (run >= 5) result += 3 + (run - 5);
          run = 1;
        }
        const finder = [true, false, true, true, true, false, true];
        for (let x = 0; x + 7 <= n; x++) {
          if (!finder.every((dark, k) => at(x + k, y, vertical) === dark)) continue;
          const lightBefore = x >= 4 && [1, 2, 3, 4].every((k) => !at(x - k, y, vertical));
          const lightAfter = x + 11 <= n && [7, 8, 9, 10].every((k) => !at(x + k, y, vertical));
          if (lightBefore || lightAfter) result += 40;
        }
      }
    }

    let dark = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (this.modules[y][x]) dark++;
        if (x < n - 1 && y < n - 1) {
          const c = this.modules[y][x];
          if (c === this.modules[y][x + 1] && c === this.modules[y + 1][x] && c === this.modules[y + 1][x + 1]) result += 3;
        }
      }
    }
    const total = n * n;
    result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return result;
  }
}

/** The code as text for a terminal: two rows per line with half blocks, dark on light, with a quiet zone. */
export function qrToTerminal(matrix: QrMatrix, quiet = 2): string {
  const n = matrix.length;
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && matrix[y][x];
  const lines: string[] = [];
  // Explicit colours so it scans in light and dark terminal themes alike.
  const color = (top: boolean, bottom: boolean) => `\x1b[${top ? 30 : 97}m\x1b[${bottom ? 40 : 107}m▀`;
  for (let y = -quiet; y < n + quiet; y += 2) {
    let line = "";
    for (let x = -quiet; x < n + quiet; x++) line += color(dark(x, y), dark(x, y + 1));
    lines.push(line + "\x1b[0m");
  }
  return lines.join("\n");
}

/** An SVG path covering the dark modules, one unit per module. Draw it in a viewBox of size + 2 * quiet. */
export function qrToSvgPath(matrix: QrMatrix, quiet = 2): string {
  let d = "";
  matrix.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  }));
  return d;
}
