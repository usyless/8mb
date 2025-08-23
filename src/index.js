"use strict";

const { FFmpeg } = /** @type {typeof import('@ffmpeg/ffmpeg')} */ FFmpegWASM;

const toBlobURL = async (url, mimeType) => URL.createObjectURL(
    new Blob([await (await fetch(url)).arrayBuffer()], { type: mimeType })
);

let onProgress;

const getFFmpeg = (() => {
    const baseURL = (window.crossOriginIsolated) ? 'ffmpeg-mt/' : 'ffmpeg/';

    const ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
        console.info(message);
    });

    ffmpeg.on('progress', ({ progress, time }) => {
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

/** @type {HTMLInputElement} */
const fileInput = document.getElementById('file');

fileInput.addEventListener('change', (e) => {
    const files = fileInput.files;
    fileInput.disabled = true;

    getFFmpeg().then(async (ffmpeg) => {
        console.log(ffmpeg);
        for (const file of files) {
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

            onProgress = (progress, time) => {
                console.log(`progress: ${progress}, time: ${time}`);
            };

            const status = await ffmpeg.exec(['-i', inputFileName, outputFileName]);

            if (status !== 0) {
                console.error('Failed to exec ffmpeg command');
                // error
                continue;
            }

            const video = await ffmpeg.readFile(outputFileName);

            // download video
            const a = document.createElement('a');
            const url = URL.createObjectURL(new Blob([video.buffer], { type: 'video/mp4' }));
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