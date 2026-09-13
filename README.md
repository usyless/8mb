<h1 align="center"><a href="https://usyless.uk/8mb"><img src="https://github.com/usyless/8mb/blob/main/src/favicon.svg?raw=true" alt="logo" width="160" height="160"></a><br>8mb</h1><h3 align="center">Browser based video compressor</h3>

# 8mb - by usy
A local browser based video compressor which targets 8mb videos by default

Uses [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)! Therefore performance isn't great, but there is no server involved.

# Settings
- Force single threaded mode (multi threaded doesnt work in some browsers such as edge)
- Target file size
- Custom audio bitrate
- FFmpeg quality preset

# Running locally
- Clone this repository
- Set your directory the cloned folder
- run `npm init`, given that you have node.js in your PATH
- then run `npm run download`
- finally, run `npm run dev` and open the url in the console

# Hosting
- It can be statically hosted once you have built it once (npm run build)
- The required folders are: `ffmpeg` and `ffmpeg-mt`
- The required files are: `8mb.webmanifest`, `bundle.js`, `favicon.ico`, `favicon.svg`, `index.html`, `*.css`, `service-worker.js`, `worker.js`
- Check out [my github.io page of 8mb as an example](https://github.com/usyless/usyless.github.io/tree/main/8mb)