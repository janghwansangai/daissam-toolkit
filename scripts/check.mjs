import {readFileSync,readdirSync} from 'node:fs';import {execFileSync} from 'node:child_process';
const manifest=JSON.parse(readFileSync('extension/manifest.json','utf8'));
for(const entry of ['extension/background.js','extension/panel.js','extension/guard.js','extension/locked.js','extension/print.js','extension/offscreen.js','extension/camera.js','extension/recorder.js','extension/capture.js','extension/capture-core.js','extension/record.js',...readdirSync('extension/lib').map(x=>'extension/lib/'+x)])execFileSync(process.execPath,['--check',entry]);
const webAccessible=(manifest.web_accessible_resources||[]).flatMap(entry=>entry.resources);
for(const file of [manifest.background.service_worker,manifest.side_panel.default_path,manifest.options_page,...webAccessible,...Object.values(manifest.icons)])readFileSync('extension/'+file);
if(manifest.permissions.includes('bookmarks')||manifest.permissions.includes('history'))throw Error('Unnecessary data access');
console.log('PASS: JavaScript syntax, manifest assets, minimum permissions');
