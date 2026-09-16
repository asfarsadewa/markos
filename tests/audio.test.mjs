import test from "node:test";
import assert from "node:assert/strict";
const { Sound } = await import("../src/audio.ts");

function environment(t, { blocked = false, missing = false } = {}) {
  const state = {
    contexts: [],
    requests: [],
    blocked,
    missing,
    decoded: 0,
    resumes: 0,
  };
  class Context {
    state = "suspended";
    currentTime = 0;
    destination = {};
    sources = [];
    constructor() {
      state.contexts.push(this);
    }
    resume() {
      state.resumes++;
      if (state.blocked) return Promise.reject(new Error("NotAllowedError"));
      this.state = "running";
      return Promise.resolve();
    }
    createGain() {
      return {
        gain: {
          value: 0,
          setTargetAtTime(value) {
            this.value = value;
          },
        },
        connect() {},
        disconnect() {},
      };
    }
    async decodeAudioData(bytes) {
      state.decoded++;
      return { bytes };
    }
    createBufferSource() {
      const source = {
        started: 0,
        stopped: 0,
        playbackRate: { value: 1 },
        connect() {},
        disconnect() {},
        stop() {
          this.stopped++;
        },
        start() {
          this.started++;
        },
      };
      this.sources.push(source);
      return source;
    }
  }
  const oldAudio = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  t.after(() => {
    globalThis.AudioContext = oldAudio;
  });
  t.mock.method(globalThis, "fetch", async (url) => {
    state.requests.push(url);
    return {
      ok: !(state.missing && url.includes("skyward")),
      arrayBuffer: async () => new ArrayBuffer(8),
    };
  });
  t.mock.method(console, "warn", () => {});
  return state;
}

test("preloading stays silent; the gesture resumes synchronously and repeat unlocks never duplicate loops", async (t) => {
  const state = environment(t);
  const sound = new Sound();
  let loaded = 0;
  await sound.prepare(() => loaded++);
  assert.equal(loaded, 9);
  assert.equal(state.contexts.length, 0);
  assert.equal(state.decoded, 0);
  const first = sound.unlock();
  assert.equal(
    state.resumes,
    1,
    "resume must happen inside the gesture, before any await",
  );
  assert.equal(
    sound.unlock(),
    first,
    "concurrent entry uses the same pending activation",
  );
  assert.equal(await first, true);
  assert.equal(state.requests.length, 9);
  assert.equal(
    state.requests.filter((url) =>
      /\/audio\/(launch|transform|contact|complete)\.wav$/.test(url),
    ).length,
    4,
    "All English barks are requested by their plain asset path",
  );
  assert.equal(state.decoded, 9);
  assert.equal(state.contexts[0].sources.length, 2);
  assert.equal(
    sound.engineGain.gain.value,
    0,
    "the title has music without engine noise",
  );
  assert.ok(sound.musicGain.gain.value > 0);
  sound.context.state = "suspended";
  await sound.unlock();
  assert.equal(state.contexts[0].sources.length, 2);
  assert.equal(state.decoded, 9);
  sound.toggle();
  assert.equal(sound.master.gain.value, 0);
  sound.toggle();
  assert.equal(sound.master.gain.value, 0.7);
  sound.engine(100, false);
  assert.ok(sound.engineGain.gain.value > 0);
  sound.engine(0, true);
  assert.equal(sound.engineGain.gain.value, 0);
});

test("canceling a transformation removes queued speech and stops only its active voice", async (t) => {
  const state = environment(t);
  const sound = new Sound();
  sound.play("transform");
  sound.cancel("transform");
  await sound.unlock();
  assert.equal(
    state.contexts[0].sources.length,
    2,
    "canceled queued bark never starts",
  );
  sound.play("transform");
  const first = sound.voice;
  sound.cancel("transform");
  assert.equal(first.stopped, 1);
  assert.equal(sound.voice, null);
  sound.play("contact");
  const contact = sound.voice;
  first.onended();
  sound.cancel("transform");
  assert.equal(
    sound.voice,
    contact,
    "old source completion must not clear a newer bark",
  );
  assert.equal(contact.stopped, 0, "reversal must not stop contact radio");
  contact.onended();
  assert.equal(sound.voice, null);
});

test("blocked audio leaves entry retryable and does not start sources", async (t) => {
  const state = environment(t, { blocked: true });
  const sound = new Sound();
  await sound.prepare();
  assert.equal(await sound.unlock(), false);
  assert.equal(sound.musicStarted, false);
  assert.equal(state.contexts[0].sources.length, 0);
  state.blocked = false;
  assert.equal(await sound.unlock(), true);
  assert.equal(state.contexts.length, 1);
  assert.equal(state.contexts[0].sources.length, 2);
});

test("a failed soundtrack can retry without downloading or restarting successful clips", async (t) => {
  const state = environment(t, { missing: true });
  const sound = new Sound();
  await sound.prepare();
  assert.equal(await sound.unlock(), false);
  assert.equal(sound.musicStarted, false);
  state.missing = false;
  assert.equal(await sound.unlock(), true);
  assert.equal(
    state.requests.filter((url) => url.includes("skyward")).length,
    3,
  );
  assert.equal(
    state.requests.filter((url) => url.includes("engine")).length,
    1,
  );
  assert.equal(state.contexts[0].sources.length, 2);
});
