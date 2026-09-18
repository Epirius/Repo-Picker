// The harnesses are written for jsc, which gives them print(), read() and load().
// Node has none of those, so each one runs in a context that provides them.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HERE = __dirname;
const DRAIN_MS = 100;

function source(file) {
  return fs.readFileSync(path.join(HERE, file), "utf8");
}

async function run(file) {
  const lines = [];
  let broke = null;
  const context = vm.createContext({
    console,
    print: (...args) => lines.push(args.join(" ")),
    read: source,
    load: (name) => vm.runInContext(source(name), context, { filename: name })
  });

  const onRejection = (err) => {
    broke = broke || err;
  };
  process.on("unhandledRejection", onRejection);
  try {
    vm.runInContext(source(file), context, { filename: file });
    await new Promise((done) => setTimeout(done, DRAIN_MS));
  } catch (err) {
    broke = err;
  } finally {
    process.off("unhandledRejection", onRejection);
  }

  const failed = lines.some((line) => /\bFAIL\b/.test(line) || /^\d+ failing$/.test(line));
  return { lines, broke, ok: !broke && !failed };
}

(async () => {
  const files = process.argv.length > 2
    ? process.argv.slice(2)
    : fs.readdirSync(HERE).filter((f) => /^test-.+\.js$/.test(f)).sort();

  let failures = 0;
  for (const file of files) {
    const result = await run(file);
    console.log(`=== ${file}`);
    for (const line of result.lines) console.log(line);
    if (result.broke) console.log(`threw: ${result.broke.stack || result.broke}`);
    if (!result.ok) failures += 1;
    console.log("");
  }
  console.log(failures ? `${failures} of ${files.length} harnesses failing` : `all ${files.length} harnesses pass`);
  process.exitCode = failures ? 1 : 0;
})();
