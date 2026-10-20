/** Counts audio streams in the stream listing ffmpeg prints for `-i <file>`. */
export function countAudioStreams(ffmpegLog: string): number {
  return [...ffmpegLog.matchAll(/Stream #\d+:\d+.*: Audio:/g)].length
}
