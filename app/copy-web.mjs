// リポジトリ直下のウェブ版を www/ に写す（ストア版の中身はウェブ版と同じ）
import { cpSync, rmSync, mkdirSync } from 'node:fs';
const files = ['index.html', 'style.css', 'app.js', 'live.js', 'data.js', 'config.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'vendor'];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of files) cpSync(`../${f}`, `www/${f}`, { recursive: true });
console.log('www/ を更新しました');
