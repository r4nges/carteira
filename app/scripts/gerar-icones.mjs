// Gera os ícones do PWA em app/public sem dependências nem arquivos externos.
// Desenho: rosca de composição (dois segmentos) sobre o azul-tinta do tema.
// Uso: node scripts/gerar-icones.mjs
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const PUBLICO = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const FUNDO = [0x1d, 0x4f, 0x73] // --cor-destaque (claro)
const SEGMENTO_A = [0xff, 0xff, 0xff]
const SEGMENTO_B = [0x8d, 0xb6, 0xd9] // --cor-destaque (escuro)

// Geometria em fração do lado; cabe na zona segura do maskable (raio 0,4).
const R_EXTERNO = 0.3
const R_INTERNO = 0.185
const FIM_B = 0.3 // segmento B ocupa de 0 a 30% da volta, a partir do topo
const FOLGA = 0.012 // vão entre segmentos, em fração da volta

function corEm(x, y, cantoArredondado) {
  // x, y em [0, 1)
  if (cantoArredondado > 0) {
    const r = cantoArredondado
    const cx = Math.min(Math.max(x, r), 1 - r)
    const cy = Math.min(Math.max(y, r), 1 - r)
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null
  }
  const dx = x - 0.5
  const dy = y - 0.5
  const d = Math.hypot(dx, dy)
  if (d < R_INTERNO || d > R_EXTERNO) return FUNDO
  // Fração da volta no sentido horário a partir do topo.
  let t = Math.atan2(dx, -dy) / (2 * Math.PI)
  if (t < 0) t += 1
  const perto = (a) => Math.min(Math.abs(t - a), 1 - Math.abs(t - a)) < FOLGA / 2
  if (perto(0) || perto(FIM_B)) return FUNDO
  return t < FIM_B ? SEGMENTO_B : SEGMENTO_A
}

function desenhar(lado, cantoArredondado) {
  const AMOSTRAS = 4
  const px = Buffer.alloc(lado * lado * 4)
  for (let j = 0; j < lado; j++) {
    for (let i = 0; i < lado; i++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sj = 0; sj < AMOSTRAS; sj++) {
        for (let si = 0; si < AMOSTRAS; si++) {
          const c = corEm((i + (si + 0.5) / AMOSTRAS) / lado, (j + (sj + 0.5) / AMOSTRAS) / lado, cantoArredondado)
          if (!c) continue
          r += c[0]
          g += c[1]
          b += c[2]
          a += 1
        }
      }
      const o = (j * lado + i) * 4
      const n = AMOSTRAS * AMOSTRAS
      px[o] = a ? Math.round(r / a) : 0
      px[o + 1] = a ? Math.round(g / a) : 0
      px[o + 2] = a ? Math.round(b / a) : 0
      px[o + 3] = Math.round((a / n) * 255)
    }
  }
  return png(lado, px)
}

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = TABELA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function bloco(tipo, dados) {
  const tam = Buffer.alloc(4)
  tam.writeUInt32BE(dados.length)
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(corpo))
  return Buffer.concat([tam, corpo, crc])
}
function png(lado, rgba) {
  const cab = Buffer.alloc(13)
  cab.writeUInt32BE(lado, 0)
  cab.writeUInt32BE(lado, 4)
  cab[8] = 8 // bits por canal
  cab[9] = 6 // RGBA
  const linhas = Buffer.alloc(lado * (lado * 4 + 1))
  for (let j = 0; j < lado; j++) {
    linhas[j * (lado * 4 + 1)] = 0
    rgba.copy(linhas, j * (lado * 4 + 1) + 1, j * lado * 4, (j + 1) * lado * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', cab),
    bloco('IDAT', deflateSync(linhas, { level: 9 })),
    bloco('IEND', Buffer.alloc(0)),
  ])
}

function svg() {
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
  const rm = ((R_EXTERNO + R_INTERNO) / 2) * 64
  const esp = (R_EXTERNO - R_INTERNO) * 64
  const ponto = (t) => {
    const ang = t * 2 * Math.PI
    return `${(32 + rm * Math.sin(ang)).toFixed(2)} ${(32 - rm * Math.cos(ang)).toFixed(2)}`
  }
  const arco = (de, ate, cor) =>
    `<path d="M${ponto(de)}A${rm.toFixed(2)} ${rm.toFixed(2)} 0 ${ate - de > 0.5 ? 1 : 0} 1 ${ponto(ate)}" fill="none" stroke="${hex(cor)}" stroke-width="${esp.toFixed(2)}"/>`
  const f = FOLGA / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="12.8" fill="${hex(FUNDO)}"/>` +
    arco(f, FIM_B - f, SEGMENTO_B) +
    arco(FIM_B + f, 1 - f, SEGMENTO_A) +
    `</svg>\n`
  )
}

writeFileSync(join(PUBLICO, 'icone-192.png'), desenhar(192, 0.2))
writeFileSync(join(PUBLICO, 'icone-512.png'), desenhar(512, 0.2))
writeFileSync(join(PUBLICO, 'icone-maskable-512.png'), desenhar(512, 0))
writeFileSync(join(PUBLICO, 'apple-touch-icon.png'), desenhar(180, 0))
writeFileSync(join(PUBLICO, 'favicon.svg'), svg())
console.log('Ícones gravados em', PUBLICO)
