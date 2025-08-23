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
        if (message?.startsWith('worker sent an error!')) {
            // fatal error -> show thing to refresh page
        }
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

const ffmpeg_presets = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
const auto_audio_bitrates = [128 * 1024, 64 * 1024, 32 * 1024, 16 * 1024]; // bits

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

            const deleteInputFile = () => runAsync(ffmpeg.deleteFile(inputFileName));

            if ((wroteFile.status !== "fulfilled") || (wroteFile.value !== true)) {
                await deleteInputFile();
                console.error('Error writing file:', wroteFile.reason);
                continue;
            }

            // get video duration
            let output_info = 'output.txt';
            if (inputFileName === outputFileName) {
                output_info = 'output_not_today.txt';
            }
            const [ffprobeStatus] = await runAsync(ffmpeg.ffprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inputFileName, '-o', output_info]));

            console.log('FFProbe:', ffprobeStatus);

            if ((ffprobeStatus.status !== "fulfilled") || ((ffprobeStatus.value !== 0) && (ffprobeStatus.value !== -1))) { // it seems to give -1 even on success
                await runAsync(deleteInputFile(), ffmpeg.deleteFile(output_info));
                console.error('Failed to get duration of video with error:', ffprobeStatus.reason);
                continue;
            }

            const [durationResult] = await runAsync(ffmpeg.readFile(output_info, "utf8"));

            if ((durationResult.status !== "fulfilled")) {
                await runAsync(deleteInputFile(), ffmpeg.deleteFile(output_info));
                console.error('Failed to read video duration file with error:', durationResult.reason);
            }

            const duration = Number(durationResult.value);
            await runAsync(ffmpeg.deleteFile(output_info)); // we dont care about the outcome here

            if (Number.isNaN(duration) || duration <= 0) {
                await deleteInputFile();
                console.error('Failed to get duration of video!');
                continue;
            }

            let audioBitrate; // bps
            let audioSize; // bits

            for (const audioBR of auto_audio_bitrates) {
                audioBitrate = audioBR;
                audioSize = audioBR * duration;
                if (audioSize < targetFileSize) break;
            }

            if (audioSize >= targetFileSize) {
                await deleteInputFile();
                console.error('Audio of video will be larger than allowed size!');
                continue;
            }

            const videoBitrate = Math.floor((targetFileSize - audioSize) / duration); // bps

            onProgress = (progress, time) => {
                console.log(`progress: ${progress}, time: ${time}`);
            };

            console.log(`Using video bitrate: ${videoBitrate / 1024}kbps and audio bitrate: ${audioBitrate / 1024}kbps`);

            const [ffmpegStatus] = await runAsync(ffmpeg.exec([
                '-i', inputFileName,
                '-c:v', 'libx264',
                '-preset', ffmpeg_presets[0],
                '-b:v', videoBitrate.toString(),
                '-maxrate', videoBitrate.toString(),
                '-c:a', 'aac',
                '-b:a', audioBitrate.toString(),
                outputFileName
            ]));

            console.log('FFMpeg:', ffmpegStatus);

            await deleteInputFile(); // dont need it anymore after here

            const deleteOutputFile = () => runAsync(ffmpeg.deleteFile(outputFileName));

            if ((ffmpegStatus.status !== "fulfilled") || (ffmpegStatus.value !== 0)) {
                await deleteOutputFile();
                console.error('Failed to exec ffmpeg command with error:', ffmpegStatus.reason);
                continue;
            }

            const [videoStatus] = await runAsync(ffmpeg.readFile(outputFileName));

            if (videoStatus.status !== "fulfilled") {
                await deleteOutputFile();
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

            await deleteOutputFile();
        }
        fileInput.disabled = false;
    }).catch((e) => {
        // display error
        console.error('Error loading ffmpeg:', e);
        fileInput.disabled = false;
        onProgress = null;
    });
});

// visuals

const mainBox = document.getElementById('mainBox');
const spinner = document.getElementById('spinner');
const spinnerRect = spinner.querySelector('rect');
const spinnerRectRadius = 20; // px
const spinnerRectDashCount = 30;
const spinnerRectDashGap = 10;

const resizeSpinner = () => {
    const {width, height} = mainBox.getBoundingClientRect();
    spinner.setAttributeNS(null, 'viewBox', `0 0 ${width} ${height}`);
    spinner.setAttributeNS(null, 'width', `${width}px`);
    spinner.setAttributeNS(null, 'height', `${height}px`);

    const rectWidth = width - 10;
    const rectHeight = height - 10;

    spinnerRect.setAttributeNS(null, 'width', `${rectWidth}px`);
    spinnerRect.setAttributeNS(null, 'height', `${rectHeight}px`);

    const perimeter = 2 * (rectHeight + rectWidth - 4 * spinnerRectRadius) + 2 * Math.PI * spinnerRectRadius;
    const dash = (perimeter / spinnerRectDashCount) - spinnerRectDashGap;
    spinnerRect.style.strokeDasharray = `${dash},${spinnerRectDashGap}`;

    for (const anim of spinnerRect.getAnimations()) anim.cancel();

    spinnerRect.animate([
        {strokeDashoffset: dash + spinnerRectDashGap},
        {strokeDashoffset: 0}
    ], {
        duration: 2000,
        iterations: Infinity,
        easing: 'linear',
    });
}
resizeSpinner();

window.addEventListener('resize', resizeSpinner, {passive: true});