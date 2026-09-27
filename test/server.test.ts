// Talks to the real speech server in calibre, if calibre is installed here.
import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PiperClient } from '../src/piper-client.ts';
import type { PiperClientOptions, Timers } from '../src/piper-client.ts';
import type { Calibre } from '../src/calibre.ts';
import { must } from './must.ts';

const CALIBRE: Calibre = {
  file: '/opt/calibre/calibre-debug', command: '/opt/calibre/calibre-debug', args: [], label: 'calibre',
};
const VOICES = path.join(os.homedir(), '.cache', 'calibre', 'piper-voices');
const voice = fs.existsSync(VOICES) ? fs.readdirSync(VOICES).find((f) => f.endsWith('.onnx')) : undefined;
const skip = !(fs.existsSync(CALIBRE.file) && voice);

// esbuild bundles the server script as text; here it is read from its file.
const serverSource = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'piper_server.py'), 'utf8');

// Obsidian's window timers stand-in: Node's, with numeric handles.
const timers: Timers = {
  setTimeout: (handler, ms) => Number(setTimeout(handler, ms)),
  clearTimeout: (id) => clearTimeout(id),
};

/** Runs `body` with a client whose script goes into a temporary folder. */
async function withClient(
  options: Partial<PiperClientOptions>,
  body: (client: PiperClient) => Promise<void>,
): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readaloud-'));
  const client = new PiperClient({
    serverSource, timers, scriptDir: dir, onAudio: () => {}, onError: () => {}, ...options,
  });
  try {
    await body(client);
  } finally {
    client.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('speaks sentence by sentence and honors cancel', { skip }, async () => {
  const chunks: { id: number; n: number; rate: number; last: boolean }[] = [];
  let resolveDone = () => {};
  const done = new Promise<void>((r) => { resolveDone = r; });
  await withClient({
    onAudio: (id, samples, rate, last) => {
      chunks.push({ id, n: samples.length, rate, last });
      if (id === 2 && last) resolveDone();
    },
    onError: (err) => { throw err; },
  }, async (client) => {
    await client.start(CALIBRE);
    client.setVoice(path.join(VOICES, must(voice)), 1.0);
    client.speak(1, 'Ezt a mondatot nem kell végighallgatni. Mert úgyis megszakítjuk. Harmadik mondat.');
    client.cancel();
    client.speak(2, 'Első mondat. Második mondat.');
    await done;
    assert.ok(chunks.filter((c) => c.id === 1).length < 3, 'cancelled speech kept coming');
    const second = chunks.filter((c) => c.id === 2);
    assert.strictEqual(second.length, 2);
    assert.ok(second.every((c) => c.rate === 22050 && c.n > 10000));
    assert.deepStrictEqual(second.map((c) => c.last), [false, true]);

    const { voices, dir } = await client.catalog();
    assert.strictEqual(dir, must(client.info).voicesDir);
    assert.ok(voices.length > 100, 'calibre knows over a hundred voices');
    assert.ok(voices.some((v) => v.key === must(voice).slice(0, -5) && v.installed));
    const empty = await client.catalog(dir + '-does-not-exist');
    assert.ok(empty.voices.every((v) => !v.installed));
  });
});

test('a server killed from outside is reported, and waiting requests fail', { skip }, async () => {
  const errors: Error[] = [];
  await withClient({ onError: (e) => errors.push(e) }, async (client) => {
    await client.start(CALIBRE);
    const proc = must(client.proc);
    const waiting = client.catalog();
    proc.kill('SIGKILL');
    await assert.rejects(waiting);
    await new Promise((r) => setTimeout(r, 50));
    assert.match(must(errors[0]).message, /signal SIGKILL/);
    assert.strictEqual(client.proc, null);
    // Writing to it afterwards must not throw.
    client.send({ cmd: 'cancel' });
  });
});

test('stopping one server does not fail requests to the next one', { skip }, async () => {
  await withClient({}, async (client) => {
    await client.start(CALIBRE);
    client.stop();                      // like "Check again"
    await client.start(CALIBRE);
    const { voices } = await client.catalog();
    assert.ok(voices.length > 100);
  });
});

test('stopping while starting leaves no stray server', { skip }, async () => {
  await withClient({}, async (client) => {
    const first = client.start(CALIBRE);
    const firstProc = must(client.proc);
    client.stop();                      // "Check again" while still starting
    await assert.rejects(first);
    const second = client.start(CALIBRE);
    await second;
    assert.strictEqual(client.ready, second, 'the first start must not forget the second');
    await new Promise<void>((r) => {
      if (firstProc.exitCode !== null || firstProc.signalCode) r();
      else firstProc.once('exit', () => r());
    });
    // A bad request is answered with an error, and the server keeps working.
    must(client.proc).stdin.write('[1, 2]\n');
    const { voices } = await client.catalog();
    assert.ok(voices.length > 100);
  });
});

test('a failing voice list is answered with an error, not silence', { skip }, async () => {
  await withClient({}, async (client) => {
    await client.start(CALIBRE);
    // A folder name with a NUL byte makes os.listdir raise ValueError.
    await assert.rejects(client.catalog('bad\u0000folder'), /Could not list the voices/);
    const { voices } = await client.catalog();   // and it keeps working
    assert.ok(voices.length > 100);
  });
});
