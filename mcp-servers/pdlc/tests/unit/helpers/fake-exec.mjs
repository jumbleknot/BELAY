// A recording execFile double. `answer(args)` returns {stdout, stderr} or {code, stderr} for a failure.
export function fakeExecFile(answer = () => ({ stdout: '' })) {
  const calls = [];
  const execFile = (file, args, options, callback) => {
    calls.push({ file, args: [...args], options });
    const r = answer(args, options) ?? {};
    queueMicrotask(() => {
      if (r.code) {
        const err = Object.assign(new Error(`Command failed: ${file} ${args.join(' ')}\n${r.stderr ?? ''}`), { code: r.code });
        callback(err, r.stdout ?? '', r.stderr ?? '');
      } else callback(null, r.stdout ?? '', r.stderr ?? '');
    });
  };
  return { execFile, calls };
}
