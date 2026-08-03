import rawFfmpegPath from 'ffmpeg-static'

// child_process.spawn does not get Electron's automatic asar -> asar.unpacked path
// redirection — that magic only applies to fs.* calls and requiring native .node modules,
// not to arbitrary executable paths handed to spawn(). ffmpeg-static's own __dirname-based
// path still points inside the (non-executable) asar archive in a packaged build, so it has
// to be manually redirected to the unpacked copy asarUnpack actually put on disk. This is a
// no-op in dev, since an unpackaged path never contains "app.asar".
const ffmpegPath: string | null = rawFfmpegPath ? rawFfmpegPath.replace('app.asar', 'app.asar.unpacked') : rawFfmpegPath

export default ffmpegPath
