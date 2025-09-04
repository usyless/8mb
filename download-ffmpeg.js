const fs = require("fs");
const https = require('https');
const path = require('path');

const ffmpegVersion = '0.12.10';
const ffmpegURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@';

const ffmpegMTVersion = '0.12.10';
const ffmpegMTURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@';

const srcDir = path.join(__dirname, 'src');

const files = [
    {
        url: `${ffmpegURL}${ffmpegVersion}/dist/umd/ffmpeg-core.js`,
        file: 'ffmpeg/ffmpeg-core.js',
    },
    {
        url: `${ffmpegURL}${ffmpegVersion}/dist/umd/ffmpeg-core.wasm`,
        file: 'ffmpeg/ffmpeg-core.wasm',
    },
    {
        url: `${ffmpegMTURL}${ffmpegMTVersion}/dist/umd/ffmpeg-core.js`,
        file: 'ffmpeg-mt/ffmpeg-core.js',
    },
    {
        url: `${ffmpegMTURL}${ffmpegMTVersion}/dist/umd/ffmpeg-core.wasm`,
        file: 'ffmpeg-mt/ffmpeg-core.wasm',
    },
    {
        url: `${ffmpegMTURL}${ffmpegMTVersion}/dist/umd/ffmpeg-core.worker.js`,
        file: 'ffmpeg-mt/ffmpeg-core.worker.js',
    },
];

for (const {url, file} of files) {
    const p = path.join(srcDir, file);
    fs.mkdir(path.dirname(p), () => {
        const f = fs.createWriteStream(p);

        https.get(url, (response) => {
            response.pipe(f);
            f.on('finish', () => {
                f.close();
                console.log(`Finished downloading ${file}`);
            });
        }).on('error', (err) => {
            fs.unlink(p, () => {});
            console.error(`Failed to download ${file}: `, err.message);
        });
    });
}

const umd_base = path.join(__dirname, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'umd');
const umd_to_copy = ['ffmpeg.js', '814.ffmpeg.js'];

for (const file of umd_to_copy) {
    fs.copyFile(path.join(umd_base, file), path.join(srcDir, file), 0, (err) => {
        if (err) {
            console.error(`Failed to copy ${file}:`, err.message);
        }
    });
}