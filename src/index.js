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

const runAsync = (...args) => Promise.allSettled(args);

const targetFileSize = 8 * 1024 * 1024 * 8; // bits -> 8mib

const audioBitrate = 128 * 1024 * 8; // bits -> 128kib

/** @type {HTMLInputElement} */
const fileInput = document.getElementById('file');

fileInput.addEventListener('change', (e) => {
    const files = fileInput.files;
    fileInput.disabled = true;

    getFFmpeg().then(async (ffmpeg) => {
        console.log(ffmpeg);
        for (const file of files) {
            onProgress = null;

            if ((file.size * 8) <= targetFileSize) { // convert into bits
                console.log('File is already under desired size!');
                continue;
            }

            const inputFileName = file.name;

            const outputFileName = (() => {
                let fileName;

                const split = inputFileName.split('.');
                if (split.length > 1) {
                    split.pop();
                    fileName = split.join('.');
                } else {
                    fileName = split[0];
                }
                return fileName + '_usyless.uk_8mb.mp4';
            })();

            console.log(`Input File: ${inputFileName}\nOutput File: ${outputFileName}`);

            const [wroteFile] = await runAsync(ffmpeg.writeFile(inputFileName, new Uint8Array(await file.arrayBuffer())));

            const deleteFile = () => runAsync(ffmpeg.deleteFile(inputFileName));

            if ((wroteFile.status !== "fulfilled") || (wroteFile.value !== true)) {
                await deleteFile();
                console.error('Error writing file:', wroteFile.reason);
                continue;
            }

            // get video duration
            let output_info = 'output.txt';
            if (inputFileName === outputFileName) {
                output_info = 'output_not_today.txt';
            }
            const [ffprobeStatus] = await runAsync(ffmpeg.ffprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inputFileName, '-o', output_info]));

            if ((ffprobeStatus.status !== "fulfilled") || (ffprobeStatus.value !== 0)) {
                await runAsync(deleteFile(), ffmpeg.deleteFile(output_info));
                console.error('Failed to get duration of video with error:', ffprobeStatus.reason);
                continue;
            }

            const [durationResult] = await runAsync(ffmpeg.readFile(output_info, "utf8"));

            if ((durationResult.status !== "fulfilled")) {
                await runAsync(deleteFile(), ffmpeg.deleteFile(output_info));
                console.error('Failed to read video duration file with error:', durationResult.reason);
            }

            const duration = Number(durationResult.value);
            await runAsync(ffmpeg.deleteFile(output_info)); // we dont care about the outcome here

            if (Number.isNaN(duration) || duration <= 0) {
                await deleteFile();
                console.error('Failed to get duration of video!');
                continue;
            }

            const audioSize = audioBitrate * duration; // bits

            if (audioSize >= targetFileSize) {
                await deleteFile();
                console.error('Audio of video will be larger than allowed size!');
                continue;
            }

            const videoBitrate = (targetFileSize - audioSize) / (duration * 1024); // kbps

            onProgress = (progress, time) => {
                console.log(`progress: ${progress}, time: ${time}`);
            };

            console.log(`Using video bitrate: ${videoBitrate}kbps and audio bitrate: ${audioBitrate / (1024 * 8)}kbps`);

            const [ffmpegStatus] = await runAsync(ffmpeg.exec(['-i', inputFileName, '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', `${videoBitrate}k`, '-c:a', 'aac', '-b:a', `${audioBitrate / (1024 * 8)}k`, outputFileName]));

            if ((ffmpegStatus.status !== "fulfilled") || (ffmpegStatus.value !== 0)) {
                await deleteFile();
                console.error('Failed to exec ffmpeg command with error:', ffmpegStatus.reason);
                continue;
            }

            const [videoStatus] = await runAsync(ffmpeg.readFile(outputFileName));

            if (videoStatus.status !== "fulfilled") {
                await deleteFile();
                console.error('Failed to read output video file with error:', videoStatus.reason);
                continue;
            }

            // download video
            const a = document.createElement('a');
            const url = URL.createObjectURL(new Blob([videoStatus.value.buffer], {type: 'video/mp4'}));
            a.href = url;
            a.download = outputFileName;
            a.click();
            URL.revokeObjectURL(url);

            await deleteFile();
        }
        fileInput.disabled = false;
    }).catch((e) => {
        // display error
        console.error(e);
        fileInput.disabled = false;
        onProgress = null;
    });
});