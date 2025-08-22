"use strict";

import { FFmpeg } from '@ffmpeg/ffmpeg';

let onProgress;

const getFFmpeg = (() => {
    const baseURL = (window.crossOriginIsolated) ? './ffmpeg/' : './ffmpeg-mt/';

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
                    loadData.workerURL = baseURL + 'ffmpeg-core.worker.js';
                }
                await ffmpeg.load(loadData);
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
        for (const file of files) {
            const wroteFile = await ffmpeg.writeFile('input', new Uint8Array(await file.arrayBuffer()));

            if (!wroteFile) {
                // error
                continue;
            }

            onProgress = (progress, time) => {
                console.log(`progress: ${progress}, time: ${time}`);
            };

            const status = await ffmpeg.exec(['-i', 'input', 'output.mp4']);

            if (status !== 0) {
                // error
                continue;
            }
        }
    }).catch((e) => {
        // display error
        fileInput.disabled = false;
        onProgress = null;
    });
});