import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { MessageContent, MessageContentPart } from './messages.js';
import { isInsideWorkspace } from '../tools/workspace-path.js';

const execFileAsync = promisify(execFile);

const IMAGE_EXTENSIONS = new Set([
	'.jpg',
	'.jpeg',
	'.png',
	'.gif',
	'.webp',
	'.bmp',
	'.tif',
	'.tiff',
]);

const MIME_BY_EXTENSION: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.bmp': 'image/bmp',
	'.tif': 'image/tiff',
	'.tiff': 'image/tiff',
};

const MAX_ATTACH_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 2048;

const PATH_CANDIDATE_RE = /(?:^|[\s"'`([{:])((?:~|\/|\.{1,2}\/)?[^\s"'`)}\],:]+?\.(?:jpe?g|png|gif|webp|bmp|tiff?))(?=$|[\s"'`)}\],:])/gi;

export interface AttachedImage {
	filePath: string;
	mimeType: string;
	byteLength: number;
}

function expandHome(filePath: string): string {
	if (filePath === '~') {
		return os.homedir();
	}
	if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
		return path.join(os.homedir(), filePath.slice(2));
	}
	return filePath;
}

export function isImagePath(filePath: string): boolean {
	return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function mimeTypeForImagePath(filePath: string): string {
	return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export function extractImagePathsFromText(text: string, cwd = process.cwd()): string[] {
	const found: string[] = [];
	const seen = new Set<string>();

	for (const match of text.matchAll(PATH_CANDIDATE_RE)) {
		const raw = match[1];
		if (!raw) {
			continue;
		}

		const resolved = path.resolve(cwd, expandHome(raw));
		if (seen.has(resolved) || !isInsideWorkspace(resolved)) {
			continue;
		}

		try {
			const stats = fs.statSync(resolved);
			if (!stats.isFile() || !isImagePath(resolved)) {
				continue;
			}
		} catch {
			continue;
		}

		seen.add(resolved);
		found.push(resolved);
	}

	return found;
}

async function maybeDownscaleImage(filePath: string): Promise<string> {
	if (process.platform !== 'darwin') {
		return filePath;
	}

	try {
		const { stdout } = await execFileAsync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], {
			timeout: 10000,
		});
		const width = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1] || 0);
		const height = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1] || 0);
		if (!width || !height || (width <= MAX_DIMENSION && height <= MAX_DIMENSION)) {
			return filePath;
		}

		const ext = path.extname(filePath) || '.jpg';
		const tempPath = path.join(os.tmpdir(), `cobot-vision-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
		await execFileAsync('sips', ['-Z', String(MAX_DIMENSION), filePath, '--out', tempPath], {
			timeout: 30000,
		});
		return tempPath;
	} catch {
		return filePath;
	}
}

export async function encodeImageAttachment(filePath: string): Promise<{ mimeType: string; base64: string; byteLength: number } | null> {
	const sourcePath = await maybeDownscaleImage(filePath);
	const stats = await fs.promises.stat(sourcePath);
	if (stats.size > MAX_ATTACH_BYTES) {
		if (sourcePath !== filePath) {
			await fs.promises.unlink(sourcePath).catch(() => undefined);
		}
		return null;
	}

	const buffer = await fs.promises.readFile(sourcePath);
	if (sourcePath !== filePath) {
		await fs.promises.unlink(sourcePath).catch(() => undefined);
	}

	return {
		mimeType: mimeTypeForImagePath(filePath),
		base64: buffer.toString('base64'),
		byteLength: buffer.byteLength,
	};
}

export async function buildUserMessageContent(text: string, cwd = process.cwd()): Promise<{
	content: MessageContent;
	attachedImages: AttachedImage[];
}> {
	const imagePaths = extractImagePathsFromText(text, cwd);
	if (imagePaths.length === 0) {
		return { content: text, attachedImages: [] };
	}

	const parts: MessageContentPart[] = [{ type: 'text', text }];
	const attachedImages: AttachedImage[] = [];

	for (const imagePath of imagePaths) {
		const encoded = await encodeImageAttachment(imagePath);
		if (!encoded) {
			continue;
		}

		parts.push({
			type: 'image_url',
			image_url: {
				url: `data:${encoded.mimeType};base64,${encoded.base64}`,
				detail: 'high',
			},
		});
		attachedImages.push({
			filePath: imagePath,
			mimeType: encoded.mimeType,
			byteLength: encoded.byteLength,
		});
	}

	if (attachedImages.length === 0) {
		return { content: text, attachedImages: [] };
	}

	return { content: parts, attachedImages };
}
