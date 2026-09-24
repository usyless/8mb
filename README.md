<h1 align="center"><a href="https://usyless.uk/8mb"><img src="https://github.com/usyless/8mb/blob/main/src/favicon.svg?raw=true" alt="logo" width="160" height="160"></a><br>8mb</h1><h3 align="center">Browser based video compressor</h3>

# 8mb - by usy
A local browser based video compressor which targets 8mb videos by default

As a first priority for browsers that arent firefox it uses [mediabunny](https://mediabunny.dev/) for extremely high performance local compression!


As a fallback and for firefox which outputs broken videos using mediabunny, it uses 
[ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) - specifically [my fork](https://github.com/usyless/ffmpeg.wasm.8mb) which fixes multithreading for chromium! Therefore performance isn't great, but there is no server involved.

# Settings
- Force single threaded mode (multi threaded doesnt work in some browsers such as edge)
- Target file size
- Custom audio bitrate
- FFmpeg quality preset

# Running locally
1. Clone this repository
2. Set your directory the cloned folder
3. Run `npm init`, given that you have node.js in your PATH
4. Then run `npm run download`
5. Finally, run `npm run dev` and open the url in the console

# Running with Docker
1. Clone the repository:
    ```bash
    git clone https://github.com/usyless/8mb.git
    cd 8mb
    ```
2. Build the image:
    ```bash
    docker build -t 8mb .
    ```
3. Run the container:
    ```
    docker run -d \
     --name=8mb \
     --restart=unless-stopped \
     -p 8080:80 \
     8mb
    ```
4. Open http://localhost:8080 in your browser.
> [!NOTE]
> The container uses **Nginx** to serve static files. The `--restart=unless-stopped` flag ensures the container automatically restarts after a reboot or crash. You can change the left side of `-p 8080:80` to use a different port instead of `8080`.

# Hosting
- It can be statically hosted once you have built it once (npm run build)
- The required folders are: `ffmpeg` and `ffmpeg-mt`
- The required files are: `8mb.webmanifest`, `bundle.js`, `favicon.ico`, `favicon.svg`, `index.html`, `*.css`, `service-worker.js`, `worker.js`
- Check out [my github.io page of 8mb as an example](https://github.com/usyless/usyless.github.io/tree/main/8mb)