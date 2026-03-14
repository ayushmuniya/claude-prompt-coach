'use strict';
const http = require('http');
const path = require('path');
const fs   = require('fs');

function startDashboard(data, port = 3847) {
  const htmlPath = path.join(__dirname, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const server = http.createServer((req, res) => {
    if (req.url === '/data') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(data));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  ✦ Dashboard running at ${url}\n`);
    // Auto-open browser
    const cmd = process.platform === 'darwin' ? `open "${url}"`
              : process.platform === 'win32'  ? `start "${url}"`
              : `xdg-open "${url}"`;
    require('child_process').exec(cmd);
    console.log('  Press Ctrl+C to stop\n');
  });

  process.on('SIGINT', () => { server.close(); process.exit(0); });
}

module.exports = { startDashboard };
