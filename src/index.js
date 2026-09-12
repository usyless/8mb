"use strict";

import {createPopup} from "./popups.js";

const {FFmpeg} = /** @type {typeof import('@ffmpeg/ffmpeg')} */ (window.FFmpegWASM || self.FFmpegWASM || FFmpegWASM);

const localStorageSettingsName = '8mb-settings';
const ffmpegSingleBase = 'ffmpeg/';
const ffmpegMTBase = 'ffmpeg-mt/';
let baseURL;

if (navigator.userAgent.includes('Edg/')) {
    document.body.classList.add('Edge');
}

const fileInput = /** @type {HTMLInputElement} */ (document.getElementById('file'));
const ProgressBar = document.getElementById('progress')?.firstElementChild;
const mainBox = document.getElementById('mainBox');
const spinner = document.getElementById('spinner');
const spinnerRect = spinner ? spinner.querySelector('rect') : null;

const queueWrapper = document.getElementById('queueWrapper');
const queueBadge = document.getElementById('queueBadge');
const queueList = document.getElementById('queueList');
const toggleQueueCollapseBtn = document.getElementById('toggleQueueCollapse');
const collapseIcon = document.getElementById('collapseIcon');
const collapseText = document.getElementById('collapseText');
const clearCompletedQueueBtn = document.getElementById('clearCompletedQueue');
const cancelCurrentBtn = document.getElementById('cancelCurrent');
const cancelAllBtn = document.getElementById('cancelAll');
const defaultVideoSizeElem = document.getElementById('defaultVideoSize');
const settingsTemplate = document.getElementById('settingsTemplate');

const spinnerRectRadius = 20; // px
const spinnerRectDashCount = 30;
const spinnerRectDashGap = 10;
let spinnerRunning = false;

const startSpinner = (() => {
    let lastPerimeter = 0;
    return () => {
        spinnerRunning = true;
        if (!spinnerRect) return;
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
    };
})();

const cancelSpinner = () => {
    if (isProcessing) return;
    spinnerRunning = false;
    if (spinnerRect) {
        for (const anim of spinnerRect.getAnimations()) anim.pause();
    }
};

const resizeSpinner = () => {
    if (!mainBox || !spinner || !spinnerRect) return;
    const {width, height} = mainBox.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    spinner.setAttributeNS(null, 'viewBox', `0 0 ${width} ${height}`);
    spinner.setAttributeNS(null, 'width', `${width}px`);
    spinner.setAttributeNS(null, 'height', `${height}px`);
    spinnerRect.setAttributeNS(null, 'width', `${Math.max(0, width - 10)}px`);
    spinnerRect.setAttributeNS(null, 'height', `${Math.max(0, height - 10)}px`);
    spinner.style.top = '0px';
    spinner.style.left = '0px';
    spinner.style.width = '100%';
    spinner.style.height = '100%';

    if (spinnerRunning) startSpinner();
};

const scheduleResizeSpinner = (() => {
    let resizeQueued = false;
    const framecb = () => {
        resizeQueued = false;
        resizeSpinner();
    };
    return () => {
        if (resizeQueued) return;
        resizeQueued = true;
        requestAnimationFrame(framecb);
    };
})();

const setProcessingText = () => {
    for (const elem of document.querySelectorAll('[data-processing][data-default]')) {
        elem.textContent = elem.dataset.processing;
    }
    resizeSpinner();
};

const setDefaultText = () => {
    for (const elem of document.querySelectorAll('[data-processing][data-default]')) {
        elem.textContent = elem.dataset.default;
    }
    resizeSpinner();
};

const defaultVideoSizes = ["8", "10", "20", "25", "50"]; // MiB
const ffmpeg_presets = ['ultrafast', 'superfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];

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
        default: "20",
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
};

const getSettings = () => {
    let set = JSON.parse(localStorage.getItem(localStorageSettingsName)) || {};
    if (typeof set !== 'object') set = {};

    for (const setting in settingDefinitions) {
        const definition = settingDefinitions[setting];
        if (!definition.isValid(set[setting])) set[setting] = definition.default;
    }

    return set;
};

const updateDefaultVideoSize = () => {
    if (!defaultVideoSizeElem) return;
    const set = getSettings();
    defaultVideoSizeElem.value = set.defaultVideoSize;

    if (set.targetFileSize) {
        defaultVideoSizeElem.nextElementSibling?.classList.remove('noOpacity');
        defaultVideoSizeElem.disabled = true;
    } else {
        defaultVideoSizeElem.nextElementSibling?.classList.add('noOpacity');
        defaultVideoSizeElem.disabled = false;
    }
};

const showSettings = () => {
    if (!settingsTemplate) return;
    const set = settingsTemplate.content.cloneNode(true);
    const currSet = getSettings();

    for (const setting in settingDefinitions) {
        const elem = set.querySelector(`#${setting}`);
        if (elem) elem[settingDefinitions[setting].getter] = currSet[setting];
    }

    set.serialise = () => {
        const setMenu = document.getElementById('settingsMenu');
        const updatedSet = getSettings();
        for (const setting in settingDefinitions) {
            const elem = setMenu.querySelector(`#${setting}`);
            if (elem) {
                const def = settingDefinitions[setting];
                updatedSet[setting] = def.setter(elem[def.getter]);
            }
        }
        return updatedSet;
    };
    createPopup(set, {buttons: 'Save Settings'}).then((value) => {
        if (typeof value === 'object') {
            localStorage.setItem(localStorageSettingsName, JSON.stringify(value));
            updateDefaultVideoSize();
        }
    });
};

document.getElementById('settings')?.addEventListener('click', showSettings);

if (defaultVideoSizeElem) {
    defaultVideoSizeElem.addEventListener('change', (e) => {
        localStorage.setItem(localStorageSettingsName, JSON.stringify({...getSettings(), defaultVideoSize: e.currentTarget.value}));
    });
}
updateDefaultVideoSize();

let ffmpegInstance = null;

const terminateFFmpeg = () => {
    if (ffmpegInstance) {
        try {
            console.log('Terminating FFmpeg instance');
            ffmpegInstance.terminate();
        } catch (e) {
            console.error('Error terminating ffmpeg:', e);
        }
        ffmpegInstance = null;
    }
};

const getFFmpeg = async (forceSingleThreaded, signal) => {
    if (!ffmpegInstance || !ffmpegInstance.loaded) {
        try {
            console.log('Force single threaded:', forceSingleThreaded);
            console.log('Cross origin isolated?:', window.crossOriginIsolated);
            baseURL = (forceSingleThreaded || !window.crossOriginIsolated) ? ffmpegSingleBase : ffmpegMTBase;

            if (!ffmpegInstance) {
                ffmpegInstance = new FFmpeg();
                ffmpegInstance.on('log', ({message}) => {
                    console.info(message);
                });
            }

            const loadData = {
                coreURL: baseURL + 'ffmpeg-core.js',
                wasmURL: baseURL + 'ffmpeg-core.wasm',
            };

            if (baseURL === ffmpegMTBase) console.log('Using multi threaded mode');
            else console.log('Using single threaded mode');
            console.log('Loading ffmpeg with data:', loadData);

            if (signal) {
                await ffmpegInstance.load(loadData, {signal});
            } else {
                await ffmpegInstance.load(loadData);
            }
            console.log('Loaded ffmpeg');
        } catch (error) {
            console.error(error);
            if (signal?.aborted) {
                return ffmpegInstance;
            } else {
                throw error;
            }
        }
    }
    return ffmpegInstance;
};

const runAsync = (...args) => Promise.allSettled(args);

const codecOverheadMultipliers = [0.9, 0.7, 0.5, 0.3];
const maxAudioSizeMultiplier = 0.1;
const ifNeededMaxAudioSizeMultiplier = 0.3;

const auto_audio_bitrates = [128 * 1000, 96 * 1000, 64 * 1000]; // bits
const if_really_needed_audio_bitrates = [32 * 1000, 24 * 1000];

const bitrateToMaxDimensions = {
    [(2 * 1000 * 1000)]: 640,
    [(4 * 1000 * 1000)]: 854,
    [(8 * 1000 * 1000)]: 1280,
    [(15 * 1000 * 1000)]: 1920,
    [(30 * 1000 * 1000)]: 2560
};

const FFMPEG_MINIMUM_VIDEO_BITRATE = 1000;

const queue = [];
let activeItem = null;
let isProcessing = false;
let queueCollapsed = true;

let cancelCurrent;
let cancelAll;

function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function updateFooterButtons() {
    const hasActive = isProcessing && activeItem != null;
    const hasQueuedOrActive = queue.some(i => i.status === 'queued' || i.status === 'processing');
    const hasFinished = queue.some(i => i.status === 'completed' || i.status === 'cancelled' || i.status === 'failed' || i.status === 'skipped');

    if (cancelCurrentBtn) cancelCurrentBtn.disabled = !hasActive;
    if (cancelAllBtn) cancelAllBtn.disabled = !hasQueuedOrActive;
    if (clearCompletedQueueBtn) clearCompletedQueueBtn.disabled = !hasFinished;
}

function updateMainProgressBar() {
    if (!ProgressBar) return;
    const total = queue.length;
    if (total === 0) {
        ProgressBar.style.width = '0%';
        if (ProgressBar.nextElementSibling) ProgressBar.nextElementSibling.textContent = '0% (No videos)';
        ProgressBar.classList.remove('animate');
        return;
    }

    const completed = queue.filter(i => i.status === 'completed').length;
    const currentIndex = queue.findIndex(i => i === activeItem);

    if (isProcessing && activeItem) {
        ProgressBar.style.width = `${activeItem.progress}%`;
        ProgressBar.classList.add('animate');
        const videoNumber = currentIndex !== -1 ? currentIndex + 1 : completed + 1;
        if (ProgressBar.nextElementSibling) {
            if (activeItem.attempt > 1) {
                ProgressBar.nextElementSibling.textContent = `${activeItem.progress}% (Video ${videoNumber}/${total} - Attempt ${activeItem.attempt})`;
            } else {
                ProgressBar.nextElementSibling.textContent = `${activeItem.progress}% (Video ${videoNumber}/${total})`;
            }
        }
    } else if (completed === total && total > 0) {
        ProgressBar.style.width = '100%';
        ProgressBar.classList.remove('animate');
        if (ProgressBar.nextElementSibling) ProgressBar.nextElementSibling.textContent = `100% (${completed}/${total} Completed)`;
    } else {
        ProgressBar.classList.remove('animate');
        if (ProgressBar.nextElementSibling) ProgressBar.nextElementSibling.textContent = `Idle (${completed}/${total} Completed)`;
    }
}

function updateItemProgressUI(item) {
    const itemElem = document.getElementById(`queue-item-${item.id}`);
    if (!itemElem) return;
    const badge = itemElem.querySelector('.queueItemStatusBadge');
    if (badge) {
        badge.textContent = item.stageText;
    }
    let miniProg = itemElem.querySelector('.queueItemMiniProg');
    if (item.status === 'processing' && item.progress > 0) {
        if (!miniProg) {
            miniProg = document.createElement('div');
            miniProg.className = 'queueItemMiniProg';
            itemElem.appendChild(miniProg);
        }
        miniProg.style.width = `${item.progress}%`;
    } else if (miniProg && item.status !== 'processing') {
        miniProg.remove();
    }
}

function createQueueItemElement(item) {
    const card = document.createElement('div');
    card.id = `queue-item-${item.id}`;
    card.className = `queueItem status-${item.status}`;

    const left = document.createElement('div');
    left.className = 'queueItemLeft';

    const name = document.createElement('div');
    name.className = 'queueItemName';
    name.textContent = item.name;
    name.title = item.name;

    const meta = document.createElement('div');
    meta.className = 'queueItemMeta';
    const origFormatted = formatBytes(item.originalSize);
    if (item.status === 'completed' && item.compressedSize) {
        const compFormatted = formatBytes(item.compressedSize);
        const savingsPct = Math.round((1 - (item.compressedSize / item.originalSize)) * 100);
        meta.innerHTML = `${origFormatted} &rarr; <strong>${compFormatted}</strong>` +
            (savingsPct > 0 ? ` <span class="queueItemSavings">(-${savingsPct}%)</span>` : '');
    } else {
        meta.textContent = origFormatted;
    }

    left.append(name, meta);

    const right = document.createElement('div');
    right.className = 'queueItemRight';

    const badge = document.createElement('span');
    badge.className = 'queueItemStatusBadge';
    badge.textContent = item.stageText;
    right.appendChild(badge);

    if (item.status === 'completed') {
        const dlBtn = document.createElement('button');
        dlBtn.className = 'queueMiniBtn btnDownload';
        dlBtn.textContent = '⬇';
        dlBtn.title = 'Download video';
        dlBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadItem(item);
        });
        right.appendChild(dlBtn);
    }

    if (item.status === 'queued' || item.status === 'processing') {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'queueMiniBtn btnCancel';
        cancelBtn.textContent = '✕';
        cancelBtn.title = 'Cancel this item';
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            cancelItem(item);
        });
        right.appendChild(cancelBtn);
    } else {
        const clearBtn = document.createElement('button');
        clearBtn.className = 'queueMiniBtn btnClear';
        clearBtn.textContent = '✕';
        clearBtn.title = 'Remove this item';
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearItem(item);
        });
        right.appendChild(clearBtn);
    }

    if (item.status === 'processing' && item.progress > 0) {
        const miniProg = document.createElement('div');
        miniProg.className = 'queueItemMiniProg';
        miniProg.style.width = `${item.progress}%`;
        card.appendChild(miniProg);
    }

    card.append(left, right);
    return card;
}

function renderQueue() {
    if (!queueWrapper || !queueBadge || !queueList) return;
    const total = queue.length;
    const processing = queue.filter(i => i.status === 'processing').length;
    const queued = queue.filter(i => i.status === 'queued').length;
    const completed = queue.filter(i => i.status === 'completed').length;
    const failed = queue.filter(i => i.status === 'failed').length;
    const cancelled = queue.filter(i => i.status === 'cancelled').length;
    const skipped = queue.filter(i => i.status === 'skipped').length;

    if (total === 0) {
        queueBadge.textContent = '0 items';
        queueWrapper.classList.add('queue-empty');
        queueList.innerHTML = '<div class="queueEmptyNotice">Queue is empty. Add videos above!</div>';
    } else {
        queueWrapper.classList.remove('queue-empty');
        const parts = [];
        if (processing > 0) parts.push(`${processing} active`);
        if (queued > 0) parts.push(`${queued} queued`);
        if (completed > 0) parts.push(`${completed} done`);
        if (failed > 0) parts.push(`${failed} failed`);
        if (cancelled > 0) parts.push(`${cancelled} cancelled`);
        if (skipped > 0) parts.push(`${skipped} skipped`);
        queueBadge.textContent = `${total} item${total === 1 ? '' : 's'}${parts.length ? ' (' + parts.join(', ') + ')' : ''}`;

        queueList.innerHTML = '';
        for (const item of queue) {
            queueList.appendChild(createQueueItemElement(item));
        }
    }

    updateFooterButtons();
    scheduleResizeSpinner();
}

function downloadItem(item) {
    if (!item.compressedBlob) return;
    const now = Date.now();
    if (item._lastDownloadTime && (now - item._lastDownloadTime < 1000)) {
        return;
    }
    item._lastDownloadTime = now;

    const url = URL.createObjectURL(item.compressedBlob);
    item.activeUrls.add(url);
    const a = document.createElement('a');
    a.classList.add('hidden');
    a.href = url;
    a.download = item.outputFileName || `${item.name}_8mb.mp4`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        item.activeUrls.delete(url);
        a.remove();
    }, 10000);
}

function clearItem(item) {
    if (item === activeItem || item.status === 'processing') {
        item.status = 'cancelled';
        item.stageText = 'Cancelled';
        item.abortController?.abort();
        terminateFFmpeg();
    }
    if (item.activeUrls) {
        for (const url of item.activeUrls) {
            try {
                URL.revokeObjectURL(url);
            } catch (e) {}
        }
        item.activeUrls.clear();
    }
    item.compressedBlob = null;
    item.file = null;

    const idx = queue.indexOf(item);
    if (idx !== -1) {
        queue.splice(idx, 1);
    }

    renderQueue();
    updateMainProgressBar();
}

function clearFinished() {
    const finishedItems = queue.filter(item => 
        item.status === 'completed' || item.status === 'cancelled' || item.status === 'failed' || item.status === 'skipped'
    );
    for (const item of finishedItems) {
        clearItem(item);
    }
}

function cancelItem(item) {
    if (item.status === 'queued') {
        item.status = 'cancelled';
        item.stageText = 'Cancelled';
        renderQueue();
    } else if (item.status === 'processing') {
        item.status = 'cancelled';
        item.stageText = 'Cancelled';
        item.abortController?.abort();
        terminateFFmpeg();
        renderQueue();
    }
}

function addFiles(files) {
    const validFiles = Array.from(files).filter((f) => f.type.startsWith('video/'));
    if (validFiles.length === 0) {
        if (files.length > 0) {
            void createPopup('No valid video files provided!');
        }
        return;
    }

    for (const file of validFiles) {
        const item = {
            id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            file,
            name: file.name,
            originalSize: file.size,
            status: 'queued',
            progress: 0,
            stageText: 'Waiting in queue...',
            attempt: 1,
            totalAttempts: codecOverheadMultipliers.length,
            compressedBlob: null,
            compressedSize: null,
            outputFileName: null,
            error: null,
            abortController: null,
            activeUrls: new Set()
        };
        queue.push(item);
    }

    renderQueue();
    updateMainProgressBar();
    void processNext();
}

async function processNext() {
    if (isProcessing) return;

    const nextItem = queue.find(i => i.status === 'queued');
    if (!nextItem) {
        isProcessing = false;
        activeItem = null;
        cancelSpinner();
        setDefaultText();
        updateFooterButtons();
        updateMainProgressBar();
        terminateFFmpeg();
        return;
    }

    isProcessing = true;
    activeItem = nextItem;
    startSpinner();
    setProcessingText();
    updateFooterButtons();

    try {
        await processVideoItem(nextItem);
    } catch (err) {
        console.error('Unexpected error in processVideoItem:', err);
        if (nextItem.status === 'processing') {
            nextItem.status = 'failed';
            nextItem.stageText = 'Processing error';
            nextItem.error = err.message;
        }
    } finally {
        isProcessing = false;
        activeItem = null;
        renderQueue();
        updateFooterButtons();
        updateMainProgressBar();
        void processNext();
    }
}

async function processVideoItem(item) {
    if (item.status === 'cancelled') return;

    item.status = 'processing';
    item.progress = 0;
    item.stageText = 'Starting...';
    renderQueue();
    updateMainProgressBar();

    const originalSettings = getSettings();
    let settings = structuredClone(originalSettings);

    if (!item.file.type.startsWith('video/')) {
        console.log(`File ${item.name} is not a video file!`);
        item.status = 'failed';
        item.stageText = 'Not a video file';
        await createPopup(`File ${item.name} is not a video file!`);
        return;
    }

    const targetSizeNoMultiplier = ((settings.targetFileSize)
        ? (settings.targetFileSize)
        : (+settings.defaultVideoSize)
    ) * 1024 * 1024 * 8;

    if ((item.file.size * 8) <= targetSizeNoMultiplier) {
        const res = await createPopup(`File ${item.name} is already under the desired size!`, {
            buttons: ['Process Anyway', 'Skip']
        });
        if (res === 'Skip' || res === false) {
            console.log(`File ${item.name} is already under desired size, skipping.`);
            item.status = 'skipped';
            item.stageText = 'Skipped (already under target size)';
            return;
        }
    }

    let inputFileName = item.name;
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

    const outputFileName = inputFileNameNoExtension + '_usyless.uk_8mb.mp4';
    item.outputFileName = outputFileName;
    console.log(`Input File: ${inputFileName}\nOutput File: ${outputFileName}`);

    let lastAbort;
    let attempt = 1;

    for (; attempt <= codecOverheadMultipliers.length; ++attempt) {
        if (item.status === 'cancelled') break;
        if (!lastAbort?.signal.aborted) lastAbort?.abort();

        const abort = new AbortController();
        lastAbort = abort;
        item.abortController = abort;

        const currentMultiplier = codecOverheadMultipliers[attempt - 1];
        const targetSize = targetSizeNoMultiplier * currentMultiplier;

        item.attempt = attempt;
        item.progress = 1;
        item.stageText = attempt > 1 ? `Starting attempt ${attempt}...` : 'Starting...';
        updateItemProgressUI(item);
        updateMainProgressBar();

        terminateFFmpeg();

        let disableMT = false;
        let ffmpeg;

        try {
            ffmpeg = await getFFmpeg(settings.forceSingleThreaded, abort.signal);
            if (abort.signal.aborted || item.status === 'cancelled') {
                item.status = 'cancelled';
                item.stageText = 'Cancelled';
                return;
            }
        } catch (e) {
            console.error('Error loading ffmpeg:', e);
            if (abort.signal.aborted || item.status === 'cancelled') {
                item.status = 'cancelled';
                item.stageText = 'Cancelled';
                return;
            }
            await createPopup('Failed to load FFmpeg, maybe try again in single threaded mode?');
            item.status = 'failed';
            item.stageText = 'Failed to load FFmpeg';
            return;
        }

        const [currentFS] = await runAsync(ffmpeg.listDir("/"));
        if (currentFS.status !== "fulfilled") {
            console.error(`Error reading ffmpeg directory for file ${item.name}:`, currentFS.reason);
            await createPopup(`Error reading ffmpeg directory for file ${item.name}: ${currentFS.reason}`);
            item.status = 'failed';
            item.stageText = 'FS error';
            return;
        }

        let actualInputFileName = inputFileName;
        for (const {name} of currentFS.value) {
            if (actualInputFileName === name) {
                actualInputFileName = `${inputFileNameNoExtension}_inputUSY${inputFileExtension}`;
                break;
            }
        }

        item.progress = 2;
        item.stageText = 'Writing file...';
        updateItemProgressUI(item);
        updateMainProgressBar();

        const fileData = await item.file.arrayBuffer();
        if (abort.signal.aborted || item.status === 'cancelled') {
            item.status = 'cancelled';
            item.stageText = 'Cancelled';
            return;
        }

        const [wroteFile] = await runAsync(ffmpeg.writeFile(actualInputFileName, new Uint8Array(fileData), {signal: abort.signal}));

        if (abort.signal.aborted || item.status === 'cancelled') {
            item.status = 'cancelled';
            item.stageText = 'Cancelled';
            return;
        }

        if ((wroteFile.status !== "fulfilled") || (wroteFile.value !== true)) {
            console.error(`Error writing file ${actualInputFileName}:`, wroteFile.reason);
            await createPopup(`Error writing file ${item.name}: ${wroteFile.reason}`);
            item.status = 'failed';
            item.stageText = 'File write error';
            return;
        }

        let output_info = (actualInputFileName === outputFileName) ? 'output_not_today.txt' : 'output.txt';

        item.progress = 4;
        item.stageText = 'Probing duration...';
        updateItemProgressUI(item);
        updateMainProgressBar();

        const [ffprobeStatus] = await runAsync(ffmpeg.ffprobe([
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            actualInputFileName,
            '-o', output_info
        ], -1, {signal: abort.signal}));

        console.log('FFProbe:', ffprobeStatus);

        if (abort.signal.aborted || item.status === 'cancelled') {
            item.status = 'cancelled';
            item.stageText = 'Cancelled';
            return;
        }

        if ((ffprobeStatus.status !== "fulfilled") || ((ffprobeStatus.value !== 0) && (ffprobeStatus.value !== -1))) {
            console.error(`Failed to get duration of video ${actualInputFileName} with error:`, ffprobeStatus.reason);
            await createPopup(`Failed to get duration of video ${item.name} with error: ${ffprobeStatus.reason}`);
            item.status = 'failed';
            item.stageText = 'Duration probe error';
            return;
        }

        const [durationResult] = await runAsync(ffmpeg.readFile(output_info, "utf8", {signal: abort.signal}));
        console.log('Video stats:', durationResult);

        if (abort.signal.aborted || item.status === 'cancelled') {
            item.status = 'cancelled';
            item.stageText = 'Cancelled';
            return;
        }

        if (durationResult.status !== "fulfilled") {
            console.error('Failed to read video duration file with error:', durationResult.reason);
            await createPopup(`Failed to read video duration file with error: ${durationResult.reason}`);
            item.status = 'failed';
            item.stageText = 'Duration read error';
            return;
        }

        const duration = Number(durationResult.value);
        console.log(`Duration: ${duration}`);

        if (duration == null || Number.isNaN(duration) || duration <= 0) {
            console.error(`Failed to get duration of video ${actualInputFileName}!`);
            await createPopup(`Failed to get duration of video ${item.name}!`);
            item.status = 'failed';
            item.stageText = 'Invalid duration';
            return;
        }

        let audioBitrate;
        let audioSize;
        let videoBitrate;

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
                    && (videoBitrate >= FFMPEG_MINIMUM_VIDEO_BITRATE)) break;
            }

            if ((audioSize >= targetSize) || (videoBitrate < FFMPEG_MINIMUM_VIDEO_BITRATE)) {
                // fall back to the very bad audio qualities
                for (const audioBR of if_really_needed_audio_bitrates) {
                    audioBitrate = audioBR;
                    audioSize = audioBR * duration;
                    videoBitrate = Math.floor((targetSize - audioSize) / duration);
                    if ((audioSize < (targetSize * ifNeededMaxAudioSizeMultiplier))
                        && (videoBitrate >= FFMPEG_MINIMUM_VIDEO_BITRATE)) break;
                }
            }
        }

        // dont check against leeway here incase its gone super low and still isn't passing
        // although that shouldn't be the case ever
        if ((audioSize >= targetSize) || (videoBitrate < FFMPEG_MINIMUM_VIDEO_BITRATE)) {
            console.error(`Audio of video ${actualInputFileName} will be larger than target size, or video bitrate is too low!`);
            if (settings.customAudioBitrate) {
                console.error(`This is potentially due to the custom set bitrate of ${settings.customAudioBitrate}kbps`);
                await createPopup(`Audio of video ${item.name} will be larger than target size, or video bitrate is too low!\nMaybe try disabling your custom audio bitrate (${settings.customAudioBitrate}kbps)`);
            } else {
                await createPopup(`Audio of video ${item.name} will be larger than target size, or video bitrate is too low!`);
            }
            item.status = 'failed';
            item.stageText = 'Bitrate too low for target size';
            return;
        }

        videoBitrate = Math.floor((targetSize - audioSize) / duration);
        const preset = settings.ffmpegPreset;

        console.log(`Video bitrate: ${videoBitrate / 1000}kbps\nAudio bitrate: ${audioBitrate / 1000}kbps\nPreset: ${preset}\nFile: ${actualInputFileName}`);

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
            console.log(`Video ${actualInputFileName} -> progress: ${progress}, time: ${time}`);
            if (progress <= 1 && progress >= 0) {
                const progPct = Math.round(5 + (95 * progress));
                item.progress = progPct;
                item.stageText = `Encoding (${progPct}%)` + (attempt > 1 ? ` [Attempt ${attempt}/${codecOverheadMultipliers.length}]` : '');
                updateItemProgressUI(item);
                updateMainProgressBar();
            }
        };

        ffmpeg.on('progress', onProgress);

        let stopWatchdog = () => {};
        if (baseURL === ffmpegMTBase) {
            let watchdogTimer = null;
            let execFinished = false;
            let progressFired = false;

            const onWatchdogProgress = () => {
                progressFired = true;
                stopWatchdog();
            };

            stopWatchdog = () => {
                execFinished = true;
                if (watchdogTimer !== null) {
                    clearTimeout(watchdogTimer);
                    watchdogTimer = null;
                }
                ffmpeg.off('progress', onWatchdogProgress);
                abort.signal.removeEventListener('abort', stopWatchdog);
            };

            ffmpeg.on('progress', onWatchdogProgress);
            abort.signal.addEventListener('abort', stopWatchdog, { once: true });

            watchdogTimer = setTimeout(async () => {
                watchdogTimer = null;
                ffmpeg.off('progress', onWatchdogProgress);

                if (!abort.signal.aborted && !progressFired && !execFinished && item.status === 'processing' && activeItem === item) {
                    const res = await createPopup(
                        'Video processing seems to be stuck...\nIf not in firefox -> I advise switching to single threaded',
                        {buttons: ['Single Threaded', 'Proceed Anyway']}
                    );
                    if ((res === 'Single Threaded' || res === false) && !execFinished && item.status === 'processing' && activeItem === item) {
                        disableMT = true;
                        abort.abort();
                    }
                }
            }, 10000);
        }

        const ffmpegParameters = [
            '-i', actualInputFileName,
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
        let ffmpegStatus;
        try {
            const [status] = await runAsync(
                ffmpeg.exec(ffmpegParameters, -1, {signal: abort.signal})
            );
            ffmpegStatus = status;
        } finally {
            stopWatchdog();
            ffmpeg.off('progress', onProgress);
        }

        console.log('FFMpeg:', ffmpegStatus);

        if (disableMT) {
            --attempt;
            originalSettings.forceSingleThreaded = true;
            settings.forceSingleThreaded = true;
            continue;
        }

        if (abort.signal.aborted || item.status === 'cancelled') {
            item.status = 'cancelled';
            item.stageText = 'Cancelled';
            return;
        }

        if ((ffmpegStatus.status !== "fulfilled") || (ffmpegStatus.value !== 0)) {
            console.error(`Failed to exec ffmpeg command for video ${actualInputFileName} with error:`, ffmpegStatus.reason);

            if (dimensions.length > 0) {
                console.log(`Trying to run command again for ${actualInputFileName} without dimensions limit`);
                --attempt;
                settings.disableDimensionLimit = true;
                continue;
            } else {
                await createPopup(`Failed to exec ffmpeg command for video ${item.name} with error: ${ffmpegStatus.reason}`);
                item.status = 'failed';
                item.stageText = 'FFmpeg exec failed';
                return;
            }
        }

        const [videoStatus] = await runAsync(ffmpeg.readFile(outputFileName, "binary", {signal: abort.signal}));

        if (abort.signal.aborted || item.status === 'cancelled') {
            item.status = 'cancelled';
            item.stageText = 'Cancelled';
            return;
        }

        if (videoStatus.status !== "fulfilled") {
            console.error(`Failed to read output video file for ${actualInputFileName} with error:`, videoStatus.reason);
            await createPopup(`Failed to read output video file for ${item.name} with error: ${videoStatus.reason}`);
            item.status = 'failed';
            item.stageText = 'Failed to read output';
            return;
        }

        if ((videoStatus.value.byteLength * 8) > targetSizeNoMultiplier) {
            console.log(`Video output size ${videoStatus.value.byteLength} exceeded target ${targetSizeNoMultiplier / 8}, retrying...`);
            if (attempt >= codecOverheadMultipliers.length) {
                await createPopup(`Failed to get ${item.name} below the desired filesize!`);
                item.status = 'failed';
                item.stageText = 'Could not reach target size';
                return;
            }
            continue;
        }

        // Successfully compressed!
        const blob = new Blob([videoStatus.value.buffer], {type: 'video/mp4'});
        item.compressedBlob = blob;
        item.compressedSize = blob.size;
        item.status = 'completed';
        item.progress = 100;
        item.stageText = 'Completed';

        downloadItem(item);

        terminateFFmpeg();
        return;
    }

    if (item.status === 'processing') {
        item.status = 'failed';
        item.stageText = 'Failed to compress';
        await createPopup(`Failed to get ${item.name} below the desired filesize!`);
    }
}

cancelCurrent = () => {
    if (activeItem) {
        console.log(`Cancelling current video: ${activeItem.name}`);
        cancelItem(activeItem);
    }
};

cancelAll = () => {
    console.log('Cancelling all videos in queue');
    for (const item of queue) {
        if (item.status === 'queued') {
            item.status = 'cancelled';
            item.stageText = 'Cancelled';
        } else if (item.status === 'processing') {
            item.status = 'cancelled';
            item.stageText = 'Cancelled';
            item.abortController?.abort();
        }
    }
    terminateFFmpeg();
    renderQueue();
    updateMainProgressBar();
};

cancelCurrentBtn?.addEventListener('click', () => {
    cancelCurrent?.();
});
cancelAllBtn?.addEventListener('click', () => {
    cancelAll?.();
});
clearCompletedQueueBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    clearFinished();
});

queueWrapper?.addEventListener('click', (e) => {
    e.stopPropagation();
});

toggleQueueCollapseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    queueCollapsed = !queueCollapsed;
    if (queueCollapsed) {
        queueWrapper?.classList.add('collapsed');
        if (collapseIcon) collapseIcon.textContent = '▼';
        if (collapseText) collapseText.textContent = 'Expand';
    } else {
        queueWrapper?.classList.remove('collapsed');
        if (collapseIcon) collapseIcon.textContent = '▲';
        if (collapseText) collapseText.textContent = 'Collapse';
    }
    scheduleResizeSpinner();
});

const loadFiles = (files) => {
    addFiles(files);
};

fileInput?.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
        loadFiles(fileInput.files);
        fileInput.value = '';
    }
});

// Drag and drop + paste
document.addEventListener('dragover', (e) => {
    e.preventDefault();
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
    cancelSpinner();
    if (e.dataTransfer?.files?.length > 0) {
        loadFiles(e.dataTransfer.files);
    }
});
document.addEventListener('paste', (e) => {
    const d = new DataTransfer();
    for (const item of e.clipboardData.items) {
        if (item.kind === 'file') d.items.add(item.getAsFile());
    }
    if (d.files.length > 0) {
        e.preventDefault();
        loadFiles(d.files);
    } else {
        console.log('No files provided in paste');
        void createPopup('No valid files provided in paste!');
    }
});
spinner?.addEventListener('click', (e) => {
    if (e.target.closest('#queueWrapper')) return;
    fileInput?.click();
});

const initSpinnerSize = async () => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    resizeSpinner();
    startSpinner();
    cancelSpinner();
};

window.addEventListener('load', () => {
    void initSpinnerSize();
    updateFooterButtons();
    renderQueue();
});

document.fonts?.ready?.then?.(resizeSpinner);
if (mainBox) {
    new ResizeObserver(scheduleResizeSpinner).observe(mainBox);
}
window.addEventListener('resize', scheduleResizeSpinner);

spinner?.addEventListener('pointerenter', startSpinner);
spinner?.addEventListener('pointerleave', cancelSpinner);
spinner?.addEventListener('touchend', cancelSpinner);

// Initial render
updateFooterButtons();
renderQueue();
