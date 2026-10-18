// QR image for a check-in URL. The picture is only modules; the URL is not drawn as text.

const G15 = 0b10100110111;
const G15_MASK = 0b101010000010010;
const G18 = 0b1111100100101;

type Version = { data: number; ecc: number; blocks: number; align: number[]; remainder: number };

const VERSIONS: (Version | null)[] = [
  null,
  { data: 19, ecc: 7, blocks: 1, align: [], remainder: 0 },
  { data: 34, ecc: 10, blocks: 1, align: [6, 18], remainder: 7 },
  { data: 55, ecc: 15, blocks: 1, align: [6, 22], remainder: 7 },
  { data: 80, ecc: 20, blocks: 1, align: [6, 26], remainder: 7 },
  { data: 108, ecc: 26, blocks: 1, align: [6, 30], remainder: 7 },
  { data: 136, ecc: 18, blocks: 2, align: [6, 34], remainder: 7 },
  { data: 156, ecc: 20, blocks: 2, align: [6, 22, 38], remainder: 0 },
];

function bchDigit(data: number) {
  let digit = 0;
  let value = data;
  while (value !== 0) {
    digit += 1;
    value >>>= 1;
  }
  return digit;
}

function bchRemainder(data: number, poly: number) {
  let digit = data << (bchDigit(poly) - 1);
  while (bchDigit(digit) - bchDigit(poly) >= 0) digit ^= poly << (bchDigit(digit) - bchDigit(poly));
  return digit;
}

// Error correction level L is 01. Mask 0 with level L is the published vector 0x77c4.
export function formatInfoBits(mask: number) {
  const data = (1 << 3) | (mask & 7);
  return ((data << 10) | bchRemainder(data, G15)) ^ G15_MASK;
}

export function versionInfoBits(version: number) {
  return (version << 12) | bchRemainder(version, G18);
}

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

function mul(a: number, b: number) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsRemainder(data: number[], degree: number) {
  let gen = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j += 1) {
      next[j] ^= gen[j];
      next[j + 1] ^= mul(gen[j], EXP[i]);
    }
    gen = next;
  }
  const out = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ out[0];
    out.copyWithin(0, 1);
    out[degree - 1] = 0;
    if (factor === 0) continue;
    for (let i = 0; i < degree; i += 1) out[i] ^= mul(gen[i + 1], factor);
  }
  return out;
}

function chooseVersion(payload: Uint8Array) {
  for (let version = 1; version < VERSIONS.length; version += 1) {
    const spec = VERSIONS[version];
    if (!spec) continue;
    const bits = 4 + 8 + payload.length * 8;
    if (Math.ceil(bits / 8) <= spec.data) return version;
  }
  throw new Error("Check-in link is too long to encode.");
}

function dataCodewords(payload: Uint8Array, spec: Version) {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(payload.length, 8);
  for (const byte of payload) push(byte, 8);
  const capacity = spec.data * 8;
  const terminator = Math.min(4, capacity - bits.length);
  for (let i = 0; i < terminator; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) byte = (byte << 1) | bits[i + b];
    bytes.push(byte);
  }
  for (let pad = 0; bytes.length < spec.data; pad += 1) bytes.push(pad % 2 === 0 ? 0xec : 0x11);
  return bytes;
}

function interleave(data: number[], spec: Version) {
  const per = data.length / spec.blocks;
  const blocks: number[][] = [];
  const ecc: number[][] = [];
  for (let i = 0; i < spec.blocks; i += 1) {
    const slice = data.slice(i * per, (i + 1) * per);
    blocks.push(slice);
    ecc.push(rsRemainder(slice, spec.ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < per; i += 1) for (const block of blocks) out.push(block[i]);
  for (let i = 0; i < spec.ecc; i += 1) for (const block of ecc) out.push(block[i]);
  return out;
}

function blank(size: number) {
  return Array.from({ length: size }, () => Array<boolean>(size).fill(false));
}

function reservedGrid(size: number) {
  return Array.from({ length: size }, () => Array<boolean>(size).fill(false));
}

function drawFinder(modules: boolean[][], reserved: boolean[][], row: number, col: number) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || x < 0 || y >= modules.length || x >= modules.length) continue;
      const inside = r >= 0 && c >= 0 && r <= 6 && c <= 6;
      const edge = r === 0 || c === 0 || r === 6 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      modules[y][x] = inside && (edge || core);
      reserved[y][x] = true;
    }
  }
}

function drawAlign(modules: boolean[][], reserved: boolean[][], cx: number, cy: number) {
  if (reserved[cy][cx]) return;
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      modules[cy + r][cx + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      reserved[cy + r][cx + c] = true;
    }
  }
}

function maskBit(mask: number, row: number, col: number) {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function placeData(modules: boolean[][], isData: boolean[][], reserved: boolean[][], codewords: number[]) {
  const size = modules.length;
  let byteIndex = 0;
  let bitIndex = 7;
  let row = size - 1;
  let step = -1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (;;) {
      for (let c = 0; c < 2; c += 1) {
        const x = col - c;
        if (reserved[row][x]) continue;
        const dark = byteIndex < codewords.length && ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
        modules[row][x] = dark;
        isData[row][x] = true;
        bitIndex -= 1;
        if (bitIndex < 0) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }
      row += step;
      if (row < 0 || row >= size) {
        row -= step;
        step = -step;
        break;
      }
    }
  }
}

function drawFormat(modules: boolean[][], mask: number) {
  const bits = formatInfoBits(mask);
  const size = modules.length;
  for (let i = 0; i < 15; i += 1) {
    const mod = ((bits >> i) & 1) === 1;
    if (i < 6) modules[i][8] = mod;
    else if (i < 8) modules[i + 1][8] = mod;
    else modules[size - 15 + i][8] = mod;
    if (i < 8) modules[8][size - i - 1] = mod;
    else if (i < 9) modules[8][15 - i] = mod;
    else modules[8][15 - i - 1] = mod;
  }
  modules[size - 8][8] = true;
}

function penalty(modules: boolean[][]) {
  const n = modules.length;
  let lost = 0;
  const runs = (line: boolean[]) => {
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) run += 1;
      else {
        if (run >= 5) lost += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) lost += 3 + (run - 5);
  };
  for (let i = 0; i < n; i += 1) {
    runs(modules[i]);
    runs(modules.map((row) => row[i]));
  }
  for (let row = 0; row < n - 1; row += 1) {
    for (let col = 0; col < n - 1; col += 1) {
      const v = modules[row][col];
      if (v === modules[row][col + 1] && v === modules[row + 1][col] && v === modules[row + 1][col + 1]) lost += 3;
    }
  }
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark += 1;
  lost += (Math.abs(Math.floor((dark * 100) / (n * n)) - 50) / 5) * 10;
  return lost;
}

function encodeModules(text: string) {
  const payload = new TextEncoder().encode(text);
  const version = chooseVersion(payload);
  const spec = VERSIONS[version];
  if (!spec) throw new Error("Check-in link is too long to encode.");
  const codewords = interleave(dataCodewords(payload, spec), spec);
  const size = 17 + 4 * version;
  const modules = blank(size);
  const reserved = reservedGrid(size);
  drawFinder(modules, reserved, 0, 0);
  drawFinder(modules, reserved, 0, size - 7);
  drawFinder(modules, reserved, size - 7, 0);
  for (let i = 0; i < size; i += 1) {
    if (!reserved[6][i]) {
      modules[6][i] = i % 2 === 0;
      reserved[6][i] = true;
    }
    if (!reserved[i][6]) {
      modules[i][6] = i % 2 === 0;
      reserved[i][6] = true;
    }
  }
  for (const r of spec.align) for (const c of spec.align) drawAlign(modules, reserved, c, r);
  modules[size - 8][8] = true;
  reserved[size - 8][8] = true;
  for (let i = 0; i < 9; i += 1) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8][size - 1 - i] = true;
    if (i < 7) reserved[size - 1 - i][8] = true;
  }
  if (version >= 7) {
    const bits = versionInfoBits(version);
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = i % 3;
      modules[a][size - 11 + b] = dark;
      modules[size - 11 + b][a] = dark;
      reserved[a][size - 11 + b] = true;
      reserved[size - 11 + b][a] = true;
    }
  }
  const isData = reservedGrid(size);
  placeData(modules, isData, reserved, codewords);
  let best = modules;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestMask = 0;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = modules.map((row, y) => row.map((cell, x) => (isData[y][x] && maskBit(mask, y, x) ? !cell : cell)));
    drawFormat(candidate, mask);
    const score = penalty(candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
      bestMask = mask;
    }
  }
  drawFormat(best, bestMask);
  return best;
}

export function qrSvg(text: string) {
  const modules = encodeModules(text);
  const n = modules.length;
  const cell = 4;
  const quiet = 4;
  const size = (n + quiet * 2) * cell;
  let marks = "";
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      if (!modules[row][col]) continue;
      marks += `<rect x="${(col + quiet) * cell}" y="${(row + quiet) * cell}" width="${cell}" height="${cell}" fill="#111"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/>${marks}</svg>`;
}
