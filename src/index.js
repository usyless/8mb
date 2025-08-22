import { FFmpeg } from '@ffmpeg/ffmpeg';

let onProgress;

const getFFmpeg = (() => {
    const baseURL = (window.crossOriginIsolated) ? './ffmpeg/' : './ffmpeg-mt/';

    const ffmpeg = new FFmpeg();
    let loaded = false;

    ffmpeg.on('log', ({ message }) => {
        console.log(message);
    });

    ffmpeg.on('progress', ({ progress, time }) => {
        onProgress?.(progress, time);
    });

    return async () => {
        if (!loaded) {
            try {
                const loadData = {
                    coreURL: baseURL + 'ffmpeg-core.js',
                    wasmURL: baseURL + 'ffmpeg-core.wasm'
                }
                if (window.crossOriginIsolated) {
                    loadData.workerURL = baseURL + 'ffmpeg-core.worker.js';
                }
                await ffmpeg.load(loadData);
                loaded = true;
            } catch (error) {
                loaded = false;
                console.error(error);
            }
        } else {
            return ffmpeg;
        }
    }
})();