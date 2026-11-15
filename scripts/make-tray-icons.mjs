// Regenerates resources/tray*.png (a small house mark). Run: node scripts/make-tray-icons.mjs
// Placeholder artwork until the artist delivers an icon; no dependencies.
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { join } from 'node:path'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** Coverage (0 or 1) of the house shape at a point in a 16x16 design space. */
function inside(x, y) {
  const roof = y >= 2 && y < 8 && Math.abs(x - 8) <= (y - 2) * 1.1 + 0.6
  const body = y >= 8 && y < 14 && x >= 3 && x < 13
  const door = y >= 10 && y < 14 && x >= 7 && x < 9
  return (roof || body) && !door
}

function png(size, [r, g, b]) {
  const scale = size / 16
  const ss = 4 // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let py = 0; py < size; py++) {
    const row = py * (size * 4 + 1)
    raw[row] = 0
    for (let px = 0; px < size; px++) {
      let hits = 0
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++)
          if (inside((px + (sx + 0.5) / ss) / scale, (py + (sy + 0.5) / ss) / scale)) hits++
      const o = row + 1 + px * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = Math.round((hits / (ss * ss)) * 255)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const out = join(import.meta.dirname, '..', 'resources')
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'trayTemplate.png'), png(16, [0, 0, 0]))
writeFileSync(join(out, 'trayTemplate@2x.png'), png(32, [0, 0, 0]))
writeFileSync(join(out, 'tray.png'), png(32, [0x5e, 0xea, 0xd4]))
console.log(`Wrote tray icons to ${out}`)
