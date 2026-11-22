/**
 * Convert assets PNG files to base64 dataURL JSON for static HTML access.
 * Each image becomes a sibling .json file containing only the dataURL string.
 * Run: npx tsx scripts/gen-assets-dataurl.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.resolve(__dirname, '../src/assets');

function fileToDataUrl(filePath: string): string {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : `image/${ext.slice(1)}`;
    return `data:${mime};base64,${buf.toString('base64')}`;
}

function walkDir(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkDir(fullPath));
        } else if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(entry.name)) {
            results.push(fullPath);
        }
    }
    return results;
}

function main() {
    console.log('Scanning assets...');
    const files = walkDir(ASSETS_DIR);

    // Clean old generated files
    const oldTs = path.join(ASSETS_DIR, 'dataUrls.ts');
    const oldJson = path.join(ASSETS_DIR, 'dataUrls.json');
    for (const f of [oldTs, oldJson]) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
    }

    for (const filePath of files) {
        const relative = path.relative(ASSETS_DIR, filePath).replace(/\\/g, '/');
        console.log(`  Converting: ${relative}`);

        const dataUrl = fileToDataUrl(filePath);
        // Write as top-level string JSON — Vite import gives the string directly
        const jsonPath = filePath.replace(/\.[^.]+$/, '.json');
        fs.writeFileSync(jsonPath, JSON.stringify(dataUrl), 'utf-8');
    }

    console.log(`\nDone: ${files.length} .json files generated`);
}

main();
