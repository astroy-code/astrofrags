import { spawn } from 'child_process'
import ffmpegPath from './ffmpegBinary'
import type { AutomaticSpeechRecognitionPipeline } from '@xenova/transformers'

const SAMPLE_RATE = 16000

export interface CaptionLine {
  start: number
  end: number
  text: string
}

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null

function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    // @xenova/transformers is ESM-only; the main process build is CommonJS, so it
    // must be loaded via dynamic import() rather than a static import.
    transcriberPromise = import('@xenova/transformers').then(({ pipeline }) =>
      pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en')
    )
  }
  return transcriberPromise
}

/** Decodes a video's trimmed audio range directly to a 16kHz mono Float32Array, no intermediate file. */
function decodeSegmentPcm(videoPath: string, start: number, end: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg-static binary not found'))
      return
    }

    const args = [
      '-ss', String(start),
      '-i', videoPath,
      '-t', String(end - start),
      '-vn',
      '-ac', '1',
      '-ar', String(SAMPLE_RATE),
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      'pipe:1'
    ]

    const proc = spawn(ffmpegPath, args)
    const chunks: Buffer[] = []
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))

    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`))
        return
      }
      const pcm = Buffer.concat(chunks)
      const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2)
      const floats = new Float32Array(samples.length)
      for (let i = 0; i < samples.length; i++) {
        floats[i] = samples[i] / 32768
      }
      resolve(floats)
    })
  })
}

export async function transcribeClip(videoPath: string, start: number, end: number): Promise<CaptionLine[]> {
  const audio = await decodeSegmentPcm(videoPath, start, end)
  const transcriber = await getTranscriber()
  const output = await transcriber(audio, { return_timestamps: true, chunk_length_s: 30 })
  const result = Array.isArray(output) ? output[0] : output
  const clipDuration = end - start

  return (result.chunks ?? [])
    .map((chunk) => ({
      start: chunk.timestamp[0] ?? 0,
      end: chunk.timestamp[1] ?? clipDuration,
      text: chunk.text.trim()
    }))
    .filter((line) => line.text.length > 0)
}
