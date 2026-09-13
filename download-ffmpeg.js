import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zipURL = 'https://github.com/usyless/ffmpeg.wasm.8mb/releases/download/v0.1/ffmpeg-esm.zip';
const srcDir = path.join(__dirname, 'src');

/**
 * Downloads a file as a Buffer using standard fetch.
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
async function download(url) {
    console.log(`Downloading ${url}...`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
    }

    const totalBytes = Number(response.headers.get('content-length')) || 0;
    let loadedBytes = 0;
    const chunks = [];

    for await (const chunk of response.body) {
        chunks.push(chunk);
        loadedBytes += chunk.length;
        if (totalBytes > 0 && process.stdout.isTTY) {
            const percent = Math.round((loadedBytes / totalBytes) * 100);
            const mb = (loadedBytes / (1024 * 1024)).toFixed(2);
            const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);
            process.stdout.write(`\rDownloading... ${mb} MB / ${totalMb} MB (${percent}%)`);
        }
    }
    if (totalBytes > 0 && process.stdout.isTTY) {
        process.stdout.write('\n');
    }
    console.log('Download complete.');
    return Buffer.concat(chunks);
}

/**
 * Extracts a ZIP archive buffer cross-platform into destDir using Node built-ins.
 * @param {Buffer} buf
 * @param {string} destDir
 */
function extractZip(buf, destDir) {
    let eocd = -1;
    const maxSearch = Math.max(0, buf.length - 65557);
    for (let i = buf.length - 22; i >= maxSearch; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd === -1) {
        throw new Error('Not a valid zip archive');
    }

    const totalEntries = buf.readUInt16LE(eocd + 10);
    let pos = buf.readUInt32LE(eocd + 16);
    for (let i = 0; i < totalEntries; i++) {
        if (buf.readUInt32LE(pos) !== 0x02014b50) {
            throw new Error(`Invalid central directory record at offset ${pos}`);
        }

        const method = buf.readUInt16LE(pos + 10);
        const compSize = buf.readUInt32LE(pos + 20);
        const uncompSize = buf.readUInt32LE(pos + 24);
        const nameLen = buf.readUInt16LE(pos + 28);
        const extraLen = buf.readUInt16LE(pos + 30);
        const commentLen = buf.readUInt16LE(pos + 32);
        const localHeaderOffset = buf.readUInt32LE(pos + 42);
        const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);

        pos += 46 + nameLen + extraLen + commentLen;

        const targetPath = path.resolve(destDir, name);
        if (!targetPath.startsWith(path.resolve(destDir) + path.sep) && targetPath !== path.resolve(destDir)) {
            throw new Error(`Zip slip detected for entry: ${name}`);
        }

        if (name.endsWith('/')) {
            fs.mkdirSync(targetPath, { recursive: true });
            continue;
        }

        fs.mkdirSync(path.dirname(targetPath), { recursive: true });

        if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
            throw new Error(`Invalid local header for ${name} at offset ${localHeaderOffset}`);
        }

        const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;

        let fileData;
        if (method === 0) {
            fileData = buf.subarray(dataStart, dataStart + uncompSize);
        } else if (method === 8) {
            fileData = zlib.inflateRawSync(buf.subarray(dataStart, dataStart + compSize));
        } else {
            throw new Error(`Unsupported compression method ${method} for ${name}`);
        }

        fs.writeFileSync(targetPath, fileData);
        console.log(`Extracted ${name}`);
    }
}

async function main() {
    try {
        const zipBuffer = await download(zipURL);
        console.log(`Extracting to ${srcDir}...`);
        extractZip(zipBuffer, srcDir);
        console.log('Finished extracting ffmpeg files.');
    } catch (err) {
        console.error('Failed to download or extract ffmpeg:', err.message);
        process.exit(1);
    }
}

void main();
