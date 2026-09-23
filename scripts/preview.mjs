// Test-only Chrome API harness; no real profile, cloud or browsing data.
import http from 'node:http';import {readFile} from 'node:fs/promises';import path from 'node:path';
const root=process.cwd();
http.createServer(async(req,res)=>{
  try{
    let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/')name='/extension/panel.html';
    let file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep))throw Error();
    // panel.html 을 / 로 내놓으므로 그 안의 상대 경로(panel.css, fonts/…)는 / 아래로 온다.
    // 뿌리에 없으면 확장 폴더에서 찾는다. 예전에는 여기서 404 를 돌려주어, 미리보기가
    // 스타일 없이 뜨는 것을 모르고 글꼴·자간을 재고 있었다.
    let body;
    try{ body=await readFile(file); }
    catch{
      file=path.resolve(root,'extension','.'+name);
      if(!file.startsWith(root+path.sep))throw Error();
      body=await readFile(file);
    }
    if(name==='/extension/panel.html')body=body.toString().replace('<script type="module" src="panel.js"></script>','<script type="module" src="/tests/preview-bootstrap.mjs"></script>');
    if(name==='/extension/print.html')body=body.toString().replace('<script src="print.js"></script>','<script type="module" src="/tests/print-bootstrap.mjs"></script>');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/javascript');res.end(body);
  }catch{res.statusCode=404;res.end('Not found');}
}).listen(4178,'127.0.0.1',()=>console.log('Test harness: http://127.0.0.1:4178 (in-memory test data only)'));
