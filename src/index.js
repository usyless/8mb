"use strict";

import {createPopup} from "./popups.js";

const {FFmpeg} = /** @type {typeof import('@ffmpeg/ffmpeg')} */ FFmpegWASM;

const toBlobURL = async (url, mimeType) => URL.createObjectURL(
    new Blob([await (await fetch(url)).arrayBuffer()], {type: mimeType})
);

let onProgress;

const getFFmpeg = (() => {
    const ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({message}) => {
        console.info(message);
    });

    ffmpeg.on('progress', ({progress, time}) => {
        onProgress?.(progress, time);
    });

    return async (forceSingleThreaded) => {
        if (!ffmpeg.loaded) {
            try {
                const baseURL = (forceSingleThreaded || !window.crossOriginIsolated) ? 'ffmpeg/' : 'ffmpeg-mt/';
                const loadData = {
                    coreURL: await toBlobURL(baseURL + 'ffmpeg-core.js', 'text/javascript'),
                    wasmURL: await toBlobURL(baseURL + 'ffmpeg-core.wasm', 'application/wasm')
                }
                if (window.crossOriginIsolated) {
                    console.log('Using multi threaded mode');
                    loadData.workerURL = await toBlobURL(baseURL + 'ffmpeg-core.worker.js', 'text/javascript');
                } else {
                    console.log('Using single threaded mode');
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

let cancelCurrent;
let cancelAll;

const runAsync = (...args) => Promise.allSettled(args);

const codecOverheadMultiplier = 0.9;
const maxAudioSizeMultiplier = 0.5;

const ffmpeg_presets = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
const auto_audio_bitrates = [128 * 1000, 64 * 1000, 32 * 1000, 16 * 1000, 8 * 1000]; // bits

/** @type {HTMLInputElement} */
const fileInput = document.getElementById('file');
const ProgressBar = document.getElementById('progress').firstElementChild;

fileInput.addEventListener('change', async () => {
    const files = fileInput.files;
    fileInput.disabled = true;

    let currentCancelled = false;
    let allCancelled = false;

    startSpinner();
    setProcessingText();

    const totalVideos = files.length;

    const setProgressBar = (prog, videoIndex) => {
        ProgressBar.style.width = `${prog}%`;
        ProgressBar.nextElementSibling.textContent = `${prog}% (Video ${videoIndex}/${totalVideos})`;
    }

    setProgressBar(0, 1);

    const settings = getSettings();

    let ffmpeg;

    let index = 0;
    for (const file of files) {
        // always terminate ffmpeg
        ffmpeg?.terminate();

        try {
            ffmpeg = await getFFmpeg(settings.forceSingleThreaded);
        } catch (e) {
            console.error('Error loading ffmpeg:', e);
            fileInput.disabled = false;
            cancelSpinner();
            setDefaultText();
            disableCancel();
            onProgress = null;
            void createPopup('Failed to load FFmpeg: The page will now refresh\nCheck the console for more logs').then(() => {
                window.location.reload();
            });
        }
        currentCancelled = false;
        ++index;
        onProgress = null;

        const originalInputFileName = file.name;

        if (!file.type.startsWith('video/')) {
            console.log(`File ${originalInputFileName} is not a video file!`);
            await createPopup(`File ${originalInputFileName} is not a video file!`);
            continue;
        }

        let inputFileName = file.name;

        const [inputFileNameNoExtension, inputFileExtension] = (() => {
            let fileName;
            let extension = '';

            const split = inputFileName.split('.');
            if (split.length > 1) {
                extension = `.${split.pop()}`;
                fileName = split.join('.');
            } else {
                fileName = split[0];
            }
            return [fileName, extension];
        })();

        const [currentFS] = await runAsync(ffmpeg.listDir("/"));

        if (currentFS.status !== "fulfilled") {
            console.error(`Error reading ffmpeg directory for file ${originalInputFileName}:`, currentFS.reason);
            await createPopup(`Error reading ffmpeg directory for file ${originalInputFileName}: ${currentFS.reason}`);
            continue;
        }

        for (const {name} of currentFS.value) {
            if (inputFileName === name) {
                inputFileName = `${inputFileNameNoExtension}_inputUSY${inputFileExtension}`;
                break;
            }
        }

        const targetSize = ((settings.targetFileSize)
            ? (settings.targetFileSize)
            : (+settings.defaultVideoSize)
        ) * 1000 * 1000 * 8 * codecOverheadMultiplier;

        if ((file.size * 8) <= targetSize) { // convert into bits
            const res = await createPopup(`File ${originalInputFileName} is already under the desired size!`, {
                buttons: ['Process Anyway', 'Skip']
            });
            if (res === 'Skip') {
                console.log(`File ${inputFileName} is already under desired size!`);
                continue;
            }
        }

        const outputFileName = inputFileNameNoExtension + '_usyless.uk_8mb.mp4';

        console.log(`Input File: ${inputFileName}\nOutput File: ${outputFileName}`);

        setProgressBar(1, index);

        const abort = new AbortController();

        cancelCurrent = () => {
            console.log(`Cancelling ${inputFileName}`);
            currentCancelled = true;
            abort.abort();
        }

        cancelAll = () => {
            console.log(`Cancelling all of ${files}`);
            allCancelled = true;
            abort.abort();
        }

        enableCancel();

        const [wroteFile] = await runAsync(ffmpeg.writeFile(inputFileName, new Uint8Array(await file.arrayBuffer()), {signal: abort.signal}));

        if (allCancelled) break;
        else if (currentCancelled) continue;

        setProgressBar(2, index);

        if ((wroteFile.status !== "fulfilled") || (wroteFile.value !== true)) {
            console.error(`Error writing file ${inputFileName}:`, wroteFile.reason);
            await createPopup(`Error writing file ${originalInputFileName}: ${wroteFile.reason}`);
            continue;
        }

        // get video duration
        let output_info = 'output.txt';
        if (inputFileName === outputFileName) {
            output_info = 'output_not_today.txt';
        }

        setProgressBar(3, index);

        const [ffprobeStatus] = await runAsync(ffmpeg.ffprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inputFileName, '-o', output_info], -1, {signal: abort.signal}));

        console.log('FFProbe:', ffprobeStatus);

        if (allCancelled) break;
        else if (currentCancelled) continue;

        setProgressBar(5, index);

        if ((ffprobeStatus.status !== "fulfilled") || ((ffprobeStatus.value !== 0) && (ffprobeStatus.value !== -1))) { // it seems to give -1 even on success
            console.error(`Failed to get duration of video ${inputFileName} with error:`, ffprobeStatus.reason);
            await createPopup(`Failed to get duration of video ${originalInputFileName} with error: ${ffprobeStatus.reason}`);
            continue;
        }

        const [durationResult] = await runAsync(ffmpeg.readFile(output_info, "utf8", {signal: abort.signal}));

        if (allCancelled) break;
        else if (currentCancelled) continue;

        if ((durationResult.status !== "fulfilled")) {
            console.error('Failed to read video duration file with error:', durationResult.reason);
            await createPopup(`Failed to read video duration file with error: ${durationResult.reason}`);
            continue;
        }

        const duration = Number(durationResult.value);

        if (Number.isNaN(duration) || duration <= 0) {
            console.error(`Failed to get duration of video ${inputFileName}!`);
            await createPopup(`Failed to get duration of video ${originalInputFileName}!`);
            continue;
        }

        let audioBitrate; // bps
        let audioSize; // bits

        if (settings.customAudioBitrate) {
            audioBitrate = settings.customAudioBitrate * 1000;
            audioSize = audioBitrate * duration;
        } else {
            for (const audioBR of auto_audio_bitrates) {
                audioBitrate = audioBR;
                audioSize = audioBR * duration;
                if (audioSize < (targetSize * maxAudioSizeMultiplier)) break;
            }
        }

        // dont check against leeway here incase its gone super low and still isn't passing
        // although that shouldn't be the case ever
        if (audioSize >= targetSize) {
            console.error(`Audio of video ${inputFileName} will be larger than target size!`);

            if (settings.customAudioBitrate) {
                console.error(`This is potentially due to the custom set bitrate of ${settings.customAudioBitrate}kbps`);
                await createPopup(`Audio of video ${originalInputFileName} will be larger than target size!\nMaybe try disabling your custom audio bitrate (${settings.customAudioBitrate}kbps)`);
            } else {
                await createPopup(`Audio of video ${originalInputFileName} will be larger than target size!`);
            }
            continue;
        }

        const videoBitrate = Math.floor((targetSize - audioSize) / duration); // bps

        onProgress = (progress, time) => {
            console.log(`Video ${inputFileName} -> progress: ${progress}, time: ${time}`);
            if (progress <= 100 && progress >= 0) {
                setProgressBar((5 + (95 * progress)).toFixed(1), index);
            }
        };

        let preset = ffmpeg_presets.includes(settings.ffmpegPreset)
            ? (settings.ffmpegPreset)
            : (ffmpeg_presets[0]);

        console.log(`Video bitrate: ${videoBitrate / 1000}kbps\nAudio bitrate: ${audioBitrate / 1000}kbps\nPreset: ${preset}\nFile: ${inputFileName}`);

        const [ffmpegStatus] = await runAsync(ffmpeg.exec([
            '-i', inputFileName,
            '-c:v', 'libx264',
            '-preset', preset,
            '-b:v', videoBitrate.toString(),
            '-maxrate', videoBitrate.toString(),
            '-c:a', 'aac',
            '-b:a', audioBitrate.toString(),
            outputFileName
        ], -1, {signal: abort.signal}));

        console.log('FFMpeg:', ffmpegStatus);

        if (allCancelled) break;
        else if (currentCancelled) continue;

        if ((ffmpegStatus.status !== "fulfilled") || (ffmpegStatus.value !== 0)) {
            console.error(`Failed to exec ffmpeg command for video ${inputFileName} with error:`, ffmpegStatus.reason);
            await createPopup(`Failed to exec ffmpeg command for video ${originalInputFileName} with error: ${ffmpegStatus.reason}`);
            continue;
        }

        const [videoStatus] = await runAsync(ffmpeg.readFile(outputFileName, "binary", {signal: abort.signal}));

        if (allCancelled) break;
        else if (currentCancelled) continue;

        if (videoStatus.status !== "fulfilled") {
            console.error(`Failed to read output video file for ${inputFileName} with error:`, videoStatus.reason);
            await createPopup(`Failed to read output video file for ${originalInputFileName} with error: ${videoStatus.reason}`);
            continue;
        }

        // download video
        const a = document.createElement('a');
        const url = URL.createObjectURL(new Blob([videoStatus.value.buffer], {type: 'video/mp4'}));
        a.href = url;
        a.download = outputFileName;
        a.click();
        URL.revokeObjectURL(url);

        setProgressBar(100, index);
    }

    setProgressBar(100, files.length);
    fileInput.disabled = false;
    cancelSpinner();
    setDefaultText();
    disableCancel();

    // always terminate at the end
    ffmpeg.terminate();
});

const settingsTemplate = document.getElementById('settingsTemplate');
const showSettings = () => {
    const set = settingsTemplate.content.cloneNode(true);
    const currSet = getSettings() ?? {};

    set.querySelector('#forceSingleThreaded').checked = currSet.forceSingleThreaded;
    set.querySelector('#targetFileSize').value = currSet.targetFileSize;
    set.querySelector('#customAudioBitrate').value = currSet.customAudioBitrate;
    set.querySelector('#ffmpegPreset').value = currSet.ffmpegPreset;

    set.serialise = () => {
        const set = document.getElementById('settingsMenu');
        return {
            forceSingleThreaded: set.querySelector('#forceSingleThreaded').checked,
            targetFileSize: +set.querySelector('#targetFileSize').value,
            customAudioBitrate: +set.querySelector('#customAudioBitrate').value,
            ffmpegPreset: set.querySelector('#ffmpegPreset').value,
            defaultVideoSize: document.getElementById('defaultVideoSize').value
        };
    }
    createPopup(set, {buttons: 'Save Settings'}).then((value) => {
        if (typeof value === 'object') {
            localStorage.setItem('settings', JSON.stringify(value));
            updateDefaultVideoSize();
        }
    });
}
document.getElementById('settings').addEventListener('click', showSettings);

const getSettings = () => {
    let set = JSON.parse(localStorage.getItem('settings')) || {};

    if (typeof set !== 'object') {
        set = {};
    }

    if (typeof set.forceSingleThreaded !== 'boolean') {
        set.forceSingleThreaded = false;
    }

    if (typeof set.targetFileSize !== 'number' || set.targetFileSize < 0) {
        set.targetFileSize = 0;
    }

    if (typeof set.customAudioBitrate !== 'number' || set.customAudioBitrate < 0) {
        set.customAudioBitrate = 0;
    }

    if (typeof set.ffmpegPreset !== 'string') {
        set.ffmpegPreset = "ultrafast";
    }

    const defaultVideoSizes = ["8", "10", "25", "50"];
    if (!defaultVideoSizes.includes(set.defaultVideoSize)) {
        set.defaultVideoSize = "8";
    }

    return set;
}

const defaultVideoSizeElem = document.getElementById('defaultVideoSize');
defaultVideoSizeElem.addEventListener('change', (e) => {
    localStorage.setItem('settings', JSON.stringify({...getSettings(), defaultVideoSize: e.currentTarget.value}));
});

const updateDefaultVideoSize = () => {
    const set = getSettings();

    defaultVideoSizeElem.value = set.defaultVideoSize;

    if (set.targetFileSize) {
        defaultVideoSizeElem.nextElementSibling.classList.remove('noOpacity');
        defaultVideoSizeElem.disabled = true;
    } else {
        defaultVideoSizeElem.nextElementSibling.classList.add('noOpacity');
        defaultVideoSizeElem.disabled = false;
    }
}
updateDefaultVideoSize();

const enableCancel = () => {
    document.getElementById('cancelCurrent').disabled = false;
    document.getElementById('cancelAll').disabled = false;
}

const disableCancel = () => {
    document.getElementById('cancelCurrent').disabled = true;
    document.getElementById('cancelAll').disabled = true;
}
disableCancel();

document.getElementById('cancelCurrent').addEventListener('click', () => {
    cancelCurrent?.();
});
document.getElementById('cancelAll').addEventListener('click', () => {
    cancelAll?.();
});

const setProcessingText = () => {
    for (const elem of document.querySelectorAll('[data-processing][data-default]')) {
        elem.textContent = elem.dataset.processing;
    }
    resizeSpinner();
}

const setDefaultText = () => {
    for (const elem of document.querySelectorAll('[data-processing][data-default]')) {
        elem.textContent = elem.dataset.default;
    }
    resizeSpinner();
}

const changeEvent = new Event('change');
const loadFiles = (files) => {
    const validFiles = Array.from(files).filter((f) => f.type.startsWith('video/'));
    if (validFiles.length > 0) {
        const dataTransfer = new DataTransfer();
        for (const file of validFiles) dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        fileInput.dispatchEvent(changeEvent);
    } else {
        console.log('No valid files provided');
        void createPopup('No valid files provided!');
    }
}

// drag and drop + paste

const mainBox = document.getElementById('mainBox');
const spinner = document.getElementById('spinner');
const spinnerRect = spinner.querySelector('rect');

document.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy';
    startSpinner();
});
document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    cancelSpinner();
});
document.addEventListener('dragend', (e) => {
    e.preventDefault();
    cancelSpinner();
});
document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (fileInput.disabled) return;
    loadFiles(e.dataTransfer.files);
});
document.addEventListener('paste', (e) => {
    const d = new DataTransfer();
    for (const item of e.clipboardData.items) {
        if (item.kind === 'file') d.items.add(item.getAsFile());
    }
    if (fileInput.disabled) return;
    if (d.files.length > 0) {
        e.preventDefault();
        loadFiles(d.files);
    } else {
        console.log('No files provided in paste');
        void createPopup('No valid files provided in paste!');
    }
});
spinner.addEventListener('click', () => {
    if (fileInput.disabled) return;
    fileInput.click();
});

// visuals

const spinnerRectRadius = 20; // px
const spinnerRectDashCount = 30;
const spinnerRectDashGap = 10;

let spinnerRunning = false;

const cancelSpinner = () => {
    if (fileInput.disabled) return;
    spinnerRunning = false;
    for (const anim of spinnerRect.getAnimations()) anim.pause();
}

const startSpinner = (() => {
    let lastPerimeter = 0;

    return () => {
        spinnerRunning = true;
        const width = +spinnerRect.getAttributeNS(null, 'width').slice(0, -2);
        const height = +spinnerRect.getAttributeNS(null, 'height').slice(0, -2);

        const perimeter = 2 * (height + width - 4 * spinnerRectRadius) + 2 * Math.PI * spinnerRectRadius;
        if (perimeter === lastPerimeter) {
            for (const anim of spinnerRect.getAnimations()) anim.play();
        } else {
            lastPerimeter = perimeter;
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
    }
})();

const resizeSpinner = () => {
    const {width, height, top, left} = mainBox.getBoundingClientRect();
    spinner.style.top = `${top}px`;
    spinner.style.left = `${left}px`;
    spinner.setAttributeNS(null, 'viewBox', `0 0 ${width} ${height}`);
    spinner.setAttributeNS(null, 'width', `${width}px`);
    spinner.setAttributeNS(null, 'height', `${height}px`);
    spinnerRect.setAttributeNS(null, 'width', `${width - 10}px`);
    spinnerRect.setAttributeNS(null, 'height', `${height - 10}px`);

    if (spinnerRunning) startSpinner();
}
resizeSpinner();
startSpinner();
cancelSpinner();

window.addEventListener('resize', resizeSpinner, {passive: true});

spinner.addEventListener('pointerenter', startSpinner);
spinner.addEventListener('pointerleave', cancelSpinner);
spinner.addEventListener('touchend', cancelSpinner);