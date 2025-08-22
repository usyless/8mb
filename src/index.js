"use strict";

const { FFmpeg } = /** @type {typeof import('@ffmpeg/ffmpeg')} */ FFmpegWASM;

let onProgress;

const getFFmpeg = (() => {
    const baseURL = (window.crossOriginIsolated) ? './ffmpeg-mt/' : './ffmpeg/';

    const ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
        console.log(message);
    });

    ffmpeg.on('progress', ({ progress, time }) => {
        onProgress?.(progress, time);
    });

    return async () => {
        if (!ffmpeg.loaded) {
            try {
                const loadData = {
                    coreURL: baseURL + 'ffmpeg-core.js',
                    wasmURL: baseURL + 'ffmpeg-core.wasm'
                }
                if (window.crossOriginIsolated) {
                    console.log('Using MT mode');
                    loadData.workerURL = baseURL + 'ffmpeg-core.worker.js';
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

/** @type {HTMLInputElement} */
const fileInput = document.getElementById('file');

fileInput.addEventListener('change', (e) => {
    const files = fileInput.files;
    fileInput.disabled = true;

    getFFmpeg().then(async (ffmpeg) => {
        console.log(ffmpeg);
        for (const file of files) {
            const wroteFile = await ffmpeg.writeFile('input', new Uint8Array(await file.arrayBuffer()));

            if (!wroteFile) {
                console.error('Error writing file');
                // error
                continue;
            }

            onProgress = (progress, time) => {
                console.log(`progress: ${progress}, time: ${time}`);
            };

            const status = await ffmpeg.exec(['-i', 'input', 'output.mp4']);

            if (status !== 0) {
                console.error('Failed to exec ffmpeg command');
                // error
                continue;
            }

            const video = await ffmpeg.readFile('output.mp4');

            // download video
            const a = document.createElement('a');
            const url = URL.createObjectURL(new Blob([video.buffer], { type: 'video/mp4' }));
            a.href = url;
            a.download = 'output.mp4';
            a.click();
            URL.revokeObjectURL(url);
        }
        fileInput.disabled = false;
    }).catch((e) => {
        // display error
        fileInput.disabled = false;
        onProgress = null;
    });
});