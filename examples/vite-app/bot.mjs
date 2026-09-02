/**
 * A native chat client on a plain TCP socket — no HTTP, no cookies, no browser.
 *
 * Usage:
 *   node bot.mjs --port 3411 "hello from plain TCP"
 *   node bot.mjs --port 3411 --session <id> "hello from plain TCP"
 *
 * The port is printed by the running app (bottom of the page). Whatever it
 * says lands in the open browser tab over the websocket, because both
 * transports are looking at the same mocked world.
 * */
import net from 'node:net';

const argv = process.argv.slice(2);

const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);

  return index === -1 ? fallback : argv[index + 1];
};

const port = Number(flag('port', process.env.MOCKSMITH_RAW_PORT ?? 3411));
const session = flag('session');
const text = argv.filter((value, index) => {
  const previous = argv[index - 1];

  return !value.startsWith('--') && previous !== '--port' && previous !== '--session';
}).join(' ');

if (!text) {
  console.error('Usage: node bot.mjs --port <port> [--session <id>] "what to say"');
  process.exit(1);
}

const socket = net.connect({ host: 'localhost', port }, () => {
  if (session) {
    socket.write(`SESSION ${session}\n`);
  }

  socket.write(`SAY ${text}\n`);
});

socket.setEncoding('utf8');
socket.on('data', (chunk) => {
  process.stdout.write(chunk);

  // One line per command; `OK <message id>` is the answer to SAY, so we are done.
  if (/^OK \d+/m.test(chunk)) {
    socket.end();
  }
});
socket.on('error', (error) => {
  console.error(`Could not reach the raw socket on :${port} — ${error.message}`);
  process.exit(1);
});
