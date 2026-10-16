const http = require('http');

const ports = [5173, 5174, 3000, 8080];
let done = 0;

ports.forEach(port => {
  const req = http.get('http://localhost:' + port, res => {
    console.log('Port ' + port + ': HTTP ' + res.statusCode);
    done++;
    if (done === ports.length) process.exit(0);
  });
  req.on('error', err => {
    console.log('Port ' + port + ': ' + err.code);
    done++;
    if (done === ports.length) process.exit(0);
  });
  req.setTimeout(2000, () => {
    req.destroy();
  });
});
