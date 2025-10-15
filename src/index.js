"use strict";

import {createPopup} from "./popups.js";

const {FFmpeg} = /** @type {typeof import('@ffmpeg/ffmpeg')} */ FFmpegWASM;

const blobURLCache = new Map();
const toBlobURL = async (url, mimeType) => {
    let cached = blobURLCache.get(url);
    if (!cached) {
        const r = await fetch(url);
        const buffer = await r.arrayBuffer();
        const blob = new Blob([buffer], {type: mimeType});
        cached = URL.createObjectURL(blob);
        blobURLCache.set(url, cached);
    }
    return cached;
}

const localStorageSettingsName = '8mb-settings';
const ffmpegSingleBase = 'ffmpeg/';
const ffmpegMTBase = 'ffmpeg-mt/';
let baseURL;

if (navigator.userAgent.includes('Edg/')) {
    for (const elem of document.querySelectorAll('[data-edge]')) elem.classList.remove('hidden');
}

const getFFmpeg = (() => {
    const ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({message}) => {
        console.info(message);
    });

    return async (forceSingleThreaded, signal) => {
        if (!ffmpeg.loaded) {
            try {
                console.log('Force single threaded:', forceSingleThreaded);
                console.log('Cross origin isolated?:', window.crossOriginIsolated);
                baseURL = (forceSingleThreaded || !window.crossOriginIsolated) ? ffmpegSingleBase : ffmpegMTBase;
                const loadData = {
                    coreURL: await toBlobURL(baseURL + 'ffmpeg-core.js', 'text/javascript'),
                    wasmURL: await toBlobURL(baseURL + 'ffmpeg-core.wasm', 'application/wasm')
                }
                if (baseURL === ffmpegMTBase) {
                    console.log('Using multi threaded mode');
                    loadData.workerURL = await toBlobURL(baseURL + 'ffmpeg-core.worker.js', 'text/javascript');
                } else {
                    console.log('Using single threaded mode');
                }
                console.log('Loading ffmpeg with data:', loadData);
                console.log('Blob cache:', blobURLCache);
                if (signal) {
                    await ffmpeg.load(loadData, {signal});
                } else {
                    await ffmpeg.load(loadData);
                }
                console.log('Loaded ffmpeg');
            } catch (error) {
                console.error(error);
                if (signal?.aborted) {
                    return ffmpeg;
                } else {
                    throw error;
                }
            }
        }
        return ffmpeg;
    }
})();

let cancelCurrent;
let cancelAll;

const runAsync = (...args) => Promise.allSettled(args);

// discords limit is 10MiB
// https://discord.com/developers/docs/reference#uploading-files
const defaultVideoSizes = ["8", "10", "25", "50"]; // so these are in MiB

const codecOverheadMultipliers = [0.9, 0.7, 0.5, 0.3];
const maxAudioSizeMultiplier = 0.1;
const ifNeededMaxAudioSizeMultiplier = 0.3;

// no veryfast as it seems to be broken
const ffmpeg_presets = ['ultrafast', 'superfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
const auto_audio_bitrates = [128 * 1000, 96 * 1000, 64 * 1000]; // bits
const if_really_needed_audio_bitrates = [32 * 1000, 24 * 1000];

// take into account fps too
const bitrateToMaxDimensions = {
    [(2 * 1000 * 1000)]: 640, // gives 360p
    [(4 * 1000 * 1000)]: 854, // gives 480p
    [(8 * 1000 * 1000)]: 1280, // gives 720p
    [(15 * 1000 * 1000)]: 1920, // gives 1080p
    [(30 * 1000 * 1000)]: 2560 // gives 1440p
    // otherwise none i guess
}

const FFMPEG_MINIMUM_VIDEO_BITRATE = 1000;

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

    const originalSettings = getSettings();

    // is assigned before first use
    let settings;

    let ffmpeg;

    let currentMultiplier = codecOverheadMultipliers[0];
    let lastIndex = 0;
    let index = 1;
    let attempt = 1;

    const setProgressBar = (prog) => {
        ProgressBar.style.width = `${prog}%`;
        if (attempt > 1) {
            ProgressBar.nextElementSibling.textContent = `${prog}% (Video ${index}/${totalVideos} - Attempt ${attempt})`;
        } else {
            ProgressBar.nextElementSibling.textContent = `${prog}% (Video ${index}/${totalVideos})`;
        }
    }

    ProgressBar.classList.add('animate');
    setProgressBar(0);

    let lastAbort;

    for (; index <= files.length; ++index) {
        if (!lastAbort?.signal.aborted) lastAbort?.abort();
        const file = files[index - 1];
        const originalInputFileName = file.name;

        ++attempt;
        if (lastIndex !== index) {
            attempt = 1;
            currentMultiplier = codecOverheadMultipliers[0];
            settings = structuredClone(originalSettings);
        } else if (attempt > codecOverheadMultipliers.length) { // not >= check as its -1'd
            await createPopup(`Failed to get ${originalInputFileName} below the desired filesize!`);
            continue;
        } else {
            currentMultiplier = codecOverheadMultipliers[attempt - 1];
        }
        lastIndex = index;
        // always terminate ffmpeg
        ffmpeg?.terminate();

        setProgressBar(1);

        let inputFileName = file.name;

        const abort = new AbortController();
        lastAbort = abort;

        currentCancelled = false;

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

        try {
            ffmpeg = await getFFmpeg(settings.forceSingleThreaded, abort.signal);

            if (allCancelled) break;
            else if (currentCancelled) continue;
        } catch (e) {
            console.error('Error loading ffmpeg:', e);
            await createPopup('Failed to load FFmpeg, maybe try again in single threaded mode?');
            break;
        }

        if (!file.type.startsWith('video/')) {
            console.log(`File ${originalInputFileName} is not a video file!`);
            await createPopup(`File ${originalInputFileName} is not a video file!`);
            continue;
        }

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

        const targetSizeNoMultiplier = ((settings.targetFileSize)
            ? (settings.targetFileSize)
            : (+settings.defaultVideoSize)
        ) * 1024 * 1024 * 8 * currentMultiplier;
        const targetSize = targetSizeNoMultiplier * currentMultiplier;

        if ((file.size * 8) <= targetSizeNoMultiplier) { // convert into bits
            const res = await createPopup(`File ${originalInputFileName} is already under the desired size!`, {
                buttons: ['Process Anyway', 'Skip']
            });
            if (res === 'Skip' || res === false) {
                console.log(`File ${inputFileName} is already under desired size!`);
                continue;
            }
        }

        const outputFileName = inputFileNameNoExtension + '_usyless.uk_8mb.mp4';

        console.log(`Input File: ${inputFileName}\nOutput File: ${outputFileName}`);

        setProgressBar(2);

        const [wroteFile] = await runAsync(ffmpeg.writeFile(inputFileName, new Uint8Array(await file.arrayBuffer()), {signal: abort.signal}));

        if (allCancelled) break;
        else if (currentCancelled) continue;

        setProgressBar(3);

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

        setProgressBar(4);

        const [ffprobeStatus] = await runAsync(ffmpeg.ffprobe([
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            inputFileName,
            '-o', output_info
        ], -1, {signal: abort.signal}));

        console.log('FFProbe:', ffprobeStatus);

        if (allCancelled) break;
        else if (currentCancelled) continue;

        setProgressBar(5);

        if ((ffprobeStatus.status !== "fulfilled") || ((ffprobeStatus.value !== 0) && (ffprobeStatus.value !== -1))) { // it seems to give -1 even on success
            console.error(`Failed to get duration of video ${inputFileName} with error:`, ffprobeStatus.reason);
            await createPopup(`Failed to get duration of video ${originalInputFileName} with error: ${ffprobeStatus.reason}`);
            continue;
        }

        const [durationResult] = await runAsync(ffmpeg.readFile(output_info, "utf8", {signal: abort.signal}));

        console.log('Video stats:', durationResult);

        if (allCancelled) break;
        else if (currentCancelled) continue;

        if ((durationResult.status !== "fulfilled")) {
            console.error('Failed to read video duration file with error:', durationResult.reason);
            await createPopup(`Failed to read video duration file with error: ${durationResult.reason}`);
            continue;
        }

        const duration = Number(durationResult.value);

        console.log(`Duration: ${duration}`);

        if (duration == null || Number.isNaN(duration) || duration <= 0) {
            console.error(`Failed to get duration of video ${inputFileName}!`);
            await createPopup(`Failed to get duration of video ${originalInputFileName}!`);
            continue;
        }

        let audioBitrate; // bps
        let audioSize; // bits
        let videoBitrate; // bps

        if (settings.customAudioBitrate) {
            audioBitrate = settings.customAudioBitrate * 1000;
            audioSize = audioBitrate * duration;
            videoBitrate = Math.floor((targetSize - audioSize) / duration);
        } else {
            for (const audioBR of auto_audio_bitrates) {
                audioBitrate = audioBR;
                audioSize = audioBR * duration;
                videoBitrate = Math.floor((targetSize - audioSize) / duration);
                if ((audioSize < (targetSize * maxAudioSizeMultiplier))
                    && (videoBitrate > FFMPEG_MINIMUM_VIDEO_BITRATE)) break;
            }

            if ((audioSize >= targetSize) || (videoBitrate < FFMPEG_MINIMUM_VIDEO_BITRATE)) {
                // fall back to the very bad audio qualities
                for (const audioBR of if_really_needed_audio_bitrates) {
                    audioBitrate = audioBR;
                    audioSize = audioBR * duration;
                    videoBitrate = Math.floor((targetSize - audioSize) / duration);
                    if ((audioSize < (targetSize * ifNeededMaxAudioSizeMultiplier))
                        && (videoBitrate > FFMPEG_MINIMUM_VIDEO_BITRATE)) break;
                }
            }
        }

        // dont check against leeway here incase its gone super low and still isn't passing
        // although that shouldn't be the case ever
        if ((audioSize >= targetSize) || (videoBitrate < FFMPEG_MINIMUM_VIDEO_BITRATE)) {
            console.error(`Audio of video ${inputFileName} will be larger than target size, or video bitrate is too low!`);

            if (settings.customAudioBitrate) {
                console.error(`This is potentially due to the custom set bitrate of ${settings.customAudioBitrate}kbps`);
                await createPopup(`Audio of video ${originalInputFileName} will be larger than target size, or video bitrate is too low!\nMaybe try disabling your custom audio bitrate (${settings.customAudioBitrate}kbps)`);
            } else {
                await createPopup(`Audio of video ${originalInputFileName} will be larger than target size, or video bitrate is too low!`);
            }
            continue;
        }

        videoBitrate = Math.floor((targetSize - audioSize) / duration); // bps
        const preset = settings.ffmpegPreset;

        console.log(`Video bitrate: ${videoBitrate / 1000}kbps\nAudio bitrate: ${audioBitrate / 1000}kbps\nPreset: ${preset}\nFile: ${inputFileName}`);

        const dimensions = [];

        if (!settings.disableDimensionLimit) {
            for (const bitrate in bitrateToMaxDimensions) {
                if (videoBitrate <= +bitrate) {
                    const size = bitrateToMaxDimensions[bitrate];
                    dimensions.push(
                        '-vf',
                        `scale='if(gt(iw,${size}),${size},iw)':'if(gt(ih,${size}),${size},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`
                    );
                    break;
                }
            }
            // if it hasn't been assigned one it means bitrate is high enough to not care
        }

        console.log(`Setting dimensions:`, dimensions);

        const onProgress = ({progress, time}) => {
            console.log(`Video ${inputFileName} -> progress: ${progress}, time: ${time}`);
            if (progress <= 1 && progress >= 0) {
                setProgressBar((5 + (95 * progress)).toFixed(1));
            }
        };

        ffmpeg.on('progress', onProgress);

        let disableMT = false;

        if (baseURL === ffmpegMTBase) {
            // check if MT is broken, if so reload in single threaded
            void (async (timeout) => {
                let progressFired = false;
                const onProgress = () => {
                    progressFired = true
                    stopListen();
                }
                const stopListen = () => ffmpeg.off('progress', onProgress);
                ffmpeg.on('progress', onProgress);

                await new Promise((resolve) => setTimeout(resolve, timeout));

                if (!abort.signal.aborted && !progressFired) {
                    const res = await createPopup(
                        'Video processing seems to be stuck...\nIf not in firefox -> I advise switching to single threaded',
                        {buttons: ['Single Threaded', 'Proceed Anyway']}
                    );
                    if (res === 'Single Threaded' || res === false) {
                        disableMT = true;
                        abort.abort();
                    }
                }
                stopListen();
            })(10000);
        }

        const ffmpegParameters = [
            '-i', inputFileName,
            '-map', '0:v:0', '-map', '0:a:0?',
            '-map', '-0:s', '-map', '-0:t', '-map', '-0:d',
            '-map_metadata', '-1',
            '-c:v', 'libx264',
            '-preset', preset,
            ...dimensions,
            '-b:v', videoBitrate.toString(),
            '-maxrate', videoBitrate.toString(),
            '-c:a', 'aac',
            '-b:a', audioBitrate.toString(),
            outputFileName
        ];
        console.log("Ffmpeg command parameters:", ffmpegParameters);
        const [ffmpegStatus] = await runAsync(
            ffmpeg.exec(ffmpegParameters, -1, {signal: abort.signal})
        );

        ffmpeg.off('progress', onProgress);

        console.log('FFMpeg:', ffmpegStatus);

        if (disableMT) {
            --index;
            originalSettings.forceSingleThreaded = true;
            continue;
        }

        if (allCancelled) break;
        else if (currentCancelled) continue;

        if ((ffmpegStatus.status !== "fulfilled") || (ffmpegStatus.value !== 0)) {
            console.error(`Failed to exec ffmpeg command for video ${inputFileName} with error:`, ffmpegStatus.reason);

            if (dimensions.length > 0) {
                console.log(`Trying to run command again for ${inputFileName} without dimensions limit`);
                // try again with no limit
                --index;
                settings.disableDimensionLimit = true;
                continue;
            } else {
                await createPopup(`Failed to exec ffmpeg command for video ${originalInputFileName} with error: ${ffmpegStatus.reason}`);
                continue;
            }
        }

        const [videoStatus] = await runAsync(ffmpeg.readFile(outputFileName, "binary", {signal: abort.signal}));

        if (allCancelled) break;
        else if (currentCancelled) continue;

        if (videoStatus.status !== "fulfilled") {
            console.error(`Failed to read output video file for ${inputFileName} with error:`, videoStatus.reason);
            await createPopup(`Failed to read output video file for ${originalInputFileName} with error: ${videoStatus.reason}`);
            continue;
        }

        if ((videoStatus.value.byteLength * 8) > targetSizeNoMultiplier) {
            --index;
            continue;
        }

        // download video
        const a = document.createElement('a');
        const url = URL.createObjectURL(new Blob([videoStatus.value.buffer], {type: 'video/mp4'}));
        a.classList.add('hidden');
        a.href = url;
        a.download = outputFileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            URL.revokeObjectURL(url);
            document.body.removeChild(a);
        }, 5000);

        setProgressBar(100);
    }
    if (!lastAbort?.signal.aborted) lastAbort?.abort();

    index = totalVideos;
    setProgressBar(100);
    fileInput.disabled = false;
    cancelSpinner();
    setDefaultText();
    disableCancel();
    ProgressBar.classList.remove('animate');

    fileInput.value = ''; // reset so same file again still works

    // always terminate at the end
    ffmpeg.terminate();
});

const settingDefinitions = {
    forceSingleThreaded: {
        default: false,
        isValid: (value) => typeof value === 'boolean',
        getter: 'checked',
        setter: (value) => value
    },
    targetFileSize: {
        default: 0,
        isValid: (value) => typeof value === 'number' && value >= 0 && !(Number.isNaN(value)),
        getter: 'value',
        setter: (value) => +value
    },
    customAudioBitrate: {
        default: 0,
        isValid: (value) => typeof value === 'number' && value >= 0 && !(Number.isNaN(value)),
        getter: 'value',
        setter: (value) => +value
    },
    ffmpegPreset: {
        default: 'faster',
        isValid: (value) => ffmpeg_presets.includes(value),
        getter: 'value',
        setter: (value) => value
    },
    defaultVideoSize: {
        default: "10",
        isValid: (value) => defaultVideoSizes.includes(value),
        getter: 'value',
        setter: (value) => value
    },
    disableDimensionLimit: {
        default: false,
        isValid: (value) => typeof value === 'boolean',
        getter: 'checked',
        setter: (value) => value
    },
}

const settingsTemplate = document.getElementById('settingsTemplate');
const showSettings = () => {
    const set = settingsTemplate.content.cloneNode(true);
    const currSet = getSettings();

    for (const setting in settingDefinitions) {
        const elem = set.querySelector(`#${setting}`);
        if (elem) elem[settingDefinitions[setting].getter] = currSet[setting];
    }

    set.serialise = () => {
        const set = document.getElementById('settingsMenu');
        const currSet = getSettings();
        for (const setting in settingDefinitions) {
            const elem = set.querySelector(`#${setting}`);
            if (elem) {
                const def = settingDefinitions[setting];
                // no need to validate here as validated in get settings
                currSet[setting] = def.setter(elem[def.getter]);
            }
        }
        return currSet;
    }
    createPopup(set, {buttons: 'Save Settings'}).then((value) => {
        if (typeof value === 'object') {
            localStorage.setItem(localStorageSettingsName, JSON.stringify(value));
            updateDefaultVideoSize();
        }
    });
}
document.getElementById('settings').addEventListener('click', showSettings);

const getSettings = () => {
    let set = JSON.parse(localStorage.getItem(localStorageSettingsName)) || {};
    if (typeof set !== 'object') set = {};

    for (const setting in settingDefinitions) {
        const definition = settingDefinitions[setting];
        if (!definition.isValid(set[setting])) set[setting] = definition.default;
    }

    return set;
}

const defaultVideoSizeElem = document.getElementById('defaultVideoSize');
defaultVideoSizeElem.addEventListener('change', (e) => {
    localStorage.setItem(localStorageSettingsName, JSON.stringify({...getSettings(), defaultVideoSize: e.currentTarget.value}));
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
    const {top: parentTop, left: parentLeft} = mainBox.parentElement.getBoundingClientRect();
    const {width, height, top, left} = mainBox.getBoundingClientRect();
    spinner.style.top = `${top - parentTop}px`;
    spinner.style.left = `${left - parentLeft}px`;
    spinner.setAttributeNS(null, 'viewBox', `0 0 ${width} ${height}`);
    spinner.setAttributeNS(null, 'width', `${width}px`);
    spinner.setAttributeNS(null, 'height', `${height}px`);
    spinnerRect.setAttributeNS(null, 'width', `${width - 10}px`);
    spinnerRect.setAttributeNS(null, 'height', `${height - 10}px`);

    if (spinnerRunning) startSpinner();
}
requestAnimationFrame(() => {
    resizeSpinner();
    startSpinner();
    cancelSpinner();
});
setTimeout(() => {
    resizeSpinner();
    startSpinner();
    cancelSpinner();
}, 50);

window.addEventListener('resize', resizeSpinner, {passive: true});

spinner.addEventListener('pointerenter', startSpinner);
spinner.addEventListener('pointerleave', cancelSpinner);
spinner.addEventListener('touchend', cancelSpinner);