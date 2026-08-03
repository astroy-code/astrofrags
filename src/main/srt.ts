import type { CaptionLine } from './transcribe'

function pad(n: number, width: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(width, '0')
}

function toSrtTimestamp(seconds: number): string {
  const total = Math.max(0, seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const ms = Math.round((total - Math.floor(total)) * 1000)
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`
}

export function buildSrt(lines: CaptionLine[]): string {
  return lines
    .map((line, i) => `${i + 1}\n${toSrtTimestamp(line.start)} --> ${toSrtTimestamp(line.end)}\n${line.text}\n`)
    .join('\n')
}
