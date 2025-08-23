"use strict";

const {FFmpeg} = /** @type {typeof import('@ffmpeg/ffmpeg')} */ FFmpegWASM;

const toBlobURL = async (url, mimeType) => URL.createObjectURL(
    new Blob([await (await fetch(url)).arrayBuffer()], {type: mimeType})
);

let onProgress;

const getFFmpeg = (() => {
    const baseURL = (window.crossOriginIsolated) ? 'ffmpeg-mt/' : 'ffmpeg/';

    const ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({message}) => {
        console.info(message);
    });

    ffmpeg.on('progress', ({progress, time}) => {
        onProgress?.(progress, time);
    });

    return async () => {
        if (!ffmpeg.loaded) {
            try {
                const loadData = {
                    coreURL: await toBlobURL(baseURL + 'ffmpeg-core.js', 'text/javascript'),
                    wasmURL: await toBlobURL(baseURL + 'ffmpeg-core.wasm', 'application/wasm')
                }
                if (window.crossOriginIsolated) {
                    console.log('Using MT mode');
                    loadData.workerURL = await toBlobURL(baseURL + 'ffmpeg-core.worker.js', 'text/javascript');
                }
                console.log('Loading ffmpeg with data:', loadData);
                await ffmpeg.load(loadData);
                console.log('Loaded ffmpeg');
            } catch (error) {
                console.error(error);
                throw error;
            }
        }
        return ffmpeg;
    }
})();

const targetFileSize = 8 * 1024 * 1024 * 8; // bits -> 8mib

const audioBitrate = 128 * 1024 * 8; // bits -> 128kib

/** @type {HTMLInputElement} */
const fileInput = document.getElementById('file');

fileInput.addEventListener('change', (e) => {
    const files = fileInput.files;
    fileInput.disabled = true;

    getFFmpeg().then(async (ffmpeg) => {
        onProgress = null;

        console.log(ffmpeg);
        for (const file of files) {
            if (file.size <= targetFileSize) {
                console.log('File is already under desired size!');
                continue;
            }

            const inputFileName = file.name;

            const fileName = (() => {
                const split = inputFileName.split('.');
                if (split.length > 1) {
                    split.pop();
                    return split.join('.');
                } else {
                    return split[0];
                }
            })();

            const outputFileName = fileName + '.mp4';

            const wroteFile = await ffmpeg.writeFile(inputFileName, new Uint8Array(await file.arrayBuffer()));

            if (!wroteFile) {
                console.error('Error writing file');
                // error
                continue;
            }

            // get video duration
            let output_info = 'output.txt';
            if (inputFileName === outputFileName) {
                output_info = 'output_not_today.txt';
            }
            const ffprobeStatus = await ffmpeg.ffprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inputFileName, '-o', output_info]);

            if (ffprobeStatus !== 0) {
                console.error('Failed to get duration of video!');
                continue;
            }

            const duration = Number(await ffmpeg.readFile(output_info, "utf8"));

            if (Number.isNaN(duration) || duration <= 0) {
                console.error('Failed to get duration of video!');
                continue;
            }

            const audioSize = audioBitrate * duration; // bits

            if (audioSize >= targetFileSize) {
                console.error('Audio of video will be larger than allowed size!');
                continue;
            }

            const videoBitrate = (targetFileSize - audioSize) / (duration * 1024); // kbps

            onProgress = (progress, time) => {
                console.log(`progress: ${progress}, time: ${time}`);
            };

            console.log(`Using video bitrate: ${videoBitrate}kbps and audio bitrate: ${audioBitrate / (1024 * 8)}kbps`);

            const ffmpegStatus = await ffmpeg.exec(['-i', inputFileName, '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', `${videoBitrate}k`, '-c:a', 'aac', '-b:a', `${audioBitrate / (1024 * 8)}k`, outputFileName]);

            if (ffmpegStatus !== 0) {
                console.error('Failed to exec ffmpeg command');
                // error
                continue;
            }

            const video = await ffmpeg.readFile(outputFileName);

            // download video
            const a = document.createElement('a');
            const url = URL.createObjectURL(new Blob([video.buffer], {type: 'video/mp4'}));
            a.href = url;
            a.download = outputFileName;
            a.click();
            URL.revokeObjectURL(url);
        }
        fileInput.disabled = false;
    }).catch((e) => {
        // display error
        console.error(e);
        fileInput.disabled = false;
        onProgress = null;
    });
});