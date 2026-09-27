'use strict';

// Talks to the real speech server in calibre, if calibre is installed here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const CALIBRE = '/opt/calibre/calibre-debug';
const VOICES = path.join(os.homedir(), '.cache', 'calibre', 'piper-voices');
const voice = fs.existsSync(VOICES) && fs.readdirSync(VOICES).find((f) => f.endsWith('.onnx'));

// piper-client.js requires the .py file as text, as esbuild bundles it.
Module._extensions['.py'] = (module, filename) => {
  module.exports = fs.readFileSync(filename, 'utf8');
};
const { PiperClient } = require('../src/piper-client');

test('speaks sentence by sentence and honors cancel', { skip: !(fs.existsSync(CALIBRE) && voice) }, async () => {
  const chunks = [];
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readaloud-'));
  const client = new PiperClient({
    scriptDir: dir,
    onAudio: (id, samples, rate, last) => {
      chunks.push({ id, n: samples.length, rate, last });
      if (id === 2 && last) resolveDone();
    },
    onError: (err) => { throw err; },
  });
  try {
    await client.start({ command: CALIBRE, args: [] });
    client.setVoice(path.join(VOICES, voice), 1.0);
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
    assert.strictEqual(dir, client.info.voicesDir);
    assert.ok(voices.length > 100, 'calibre knows over a hundred voices');
    assert.ok(voices.some((v) => v.key === voice.slice(0, -5) && v.installed));
    const empty = await client.catalog(dir + '-does-not-exist');
    assert.ok(empty.voices.every((v) => !v.installed));
  } finally {
    client.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a server killed from outside is reported, and waiting requests fail', { skip: !(fs.existsSync(CALIBRE) && voice) }, async () => {
  const errors = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readaloud-'));
  const client = new PiperClient({ scriptDir: dir, onAudio: () => {}, onError: (e) => errors.push(e) });
  try {
    await client.start({ command: CALIBRE, args: [] });
    const proc = client.proc;
    const waiting = client.catalog();
    proc.kill('SIGKILL');
    await assert.rejects(waiting);
    await new Promise((r) => setTimeout(r, 50));
    assert.match(errors[0].message, /signal SIGKILL/);
    assert.strictEqual(client.proc, null);
    // Writing to it afterwards must not throw.
    client.send({ cmd: 'cancel' });
  } finally {
    client.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stopping one server does not fail requests to the next one', { skip: !(fs.existsSync(CALIBRE) && voice) }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readaloud-'));
  const client = new PiperClient({ scriptDir: dir, onAudio: () => {}, onError: () => {} });
  try {
    await client.start({ command: CALIBRE, args: [] });
    client.stop();                      // like "Check again"
    await client.start({ command: CALIBRE, args: [] });
    const { voices } = await client.catalog();
    assert.ok(voices.length > 100);
  } finally {
    client.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
