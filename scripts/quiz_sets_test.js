#!/usr/bin/env node
// Verifies multi-set rotation in api/quiz.js without the network or the model.
//
// Contract under test:
//   1. two drills started with different `Set:` values are served different Q1 stems
//   2. one drill stays on its own set for all 33 turns (the graded reply restates
//      the question it graded, which is how the server recovers the set)
//   3. grading is against the set actually being served
//   4. a seed-only client (no `Set:`) still lands on a valid set
//
//   node scripts/quiz_sets_test.js
//
const Module = require('module');
const path = require('path');

const SETS = [1, 2].map(s => ({
  set: s,
  generated: '2026-01-0' + s,
  questions: Array.from({ length: 33 }, (_, i) => ({
    n: i + 1,
    course: 'AP Biology',
    unit: 'U' + i,
    stem: `SET${s} Q${i + 1}: which option is correct for set ${s} item ${i + 1}?`,
    options: ['alpha', 'beta', 'gamma', 'delta'],
    answer: 'ABCD'[i % 4],
    why: `Set ${s} item ${i + 1} explanation.`,
  })),
}));

const BANK = { id: 'apbio', title: 'AP Biology', generated: '2026-01-02', questions: SETS[1].questions, sets: SETS };

const fakeHttps = {
  get(url, opts, cb) {
    const res = new (require('events').EventEmitter)();
    res.statusCode = 200;
    res.setEncoding = () => {};
    res.resume = () => {};
    const req = new (require('events').EventEmitter)();
    req.destroy = () => {};
    req.setTimeout = () => {};
    setImmediate(() => {
      cb(res);
      res.emit('data', JSON.stringify(BANK));
      res.emit('end');
    });
    return req;
  },
};
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'https') return fakeHttps;
  return origLoad.apply(this, arguments);
};

const handler = require(path.join(__dirname, '..', 'api', 'quiz.js'));

function call(body) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 0,
      headers: {},
      setHeader() {},
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve(o); return this; },
      send(o) { resolve(o); return this; },
      end(o) { resolve(o); },
    };
    handler({ method: 'POST', body, headers: {}, on() {}, query: {} }, res)
      .then(r => { if (r && typeof r === 'object' && 'reply' in r) resolve(r); })
      .catch(reject);
  });
}

const fails = [];
function check(name, ok, detail) {
  if (!ok) fails.push(name + (detail ? ' — ' + detail : ''));
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

(async () => {
  const startA = `Start AP Biology quiz. Set: 0. Seed: aaa`;
  const startB = `Start AP Biology quiz. Set: 1. Seed: bbb`;
  const a = await call({ message: startA, history: [], subject: 'AP Biology', student: 'Tester' });
  const b = await call({ message: startB, history: [], subject: 'AP Biology', student: 'Tester' });
  check('set 0 serves set 1 Q1', /^Q1\/33: SET1 Q1/.test(a.reply), a.reply.slice(0, 40));
  check('set 1 serves set 2 Q1', /^Q1\/33: SET2 Q1/.test(b.reply), b.reply.slice(0, 40));
  check('two sets differ', a.reply !== b.reply);

  const seedOnly = await call({ message: 'Start apbio quiz. Seed: zzz9', history: [], subject: 'AP Biology' });
  check('seed-only client gets a valid set', /^Q1\/33: SET[12] Q1/.test(seedOnly.reply), seedOnly.reply.slice(0, 40));

  // Walk the whole second set: answer with the key, confirm numbering, set
  // continuity past the point where the start message leaves history, grading.
  let hist = [
    { role: 'user', content: startB },
    { role: 'assistant', content: b.reply },
  ];
  let ok = true;
  for (let i = 1; i <= 33; i++) {
    const key = 'ABCD'[(i - 1) % 4];
    const reply = await call({ message: key, history: hist.slice(-30), subject: 'AP Biology' }).then(r => r.reply);
    const correct = reply.startsWith('Correct.');
    const onSet = i === 33 || reply.includes('SET2');
    if (!correct || !onSet) { ok = false; console.log('  turn', i, reply.slice(0, 80)); }
    const next = i < 33 ? `Q${i + 1}/33: SET2 Q${i + 1}` : 'Quiz complete';
    if (!reply.includes(next)) { ok = false; console.log('  turn', i, 'next header wrong:', reply.slice(-90)); }
    hist.push({ role: 'user', content: key }, { role: 'assistant', content: reply });
  }
  check('one drill stays on its set for 33 turns and grades against it', ok);

  const again = await call({ message: hist[hist.length - 1].content, history: hist.slice(-30), subject: 'AP Biology' });
  check('finished drill does not restart itself', /finished/i.test(again.reply || ''), (again.reply || '').slice(0, 60));

  console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})();
