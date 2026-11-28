// A scripted git-runner double: `script` maps the joined argv to a {stdout} answer, a {code, stderr}
// failure, or a function of the call. Every call is recorded with its cwd (and, feature 016, the spec it names).
import { GitError } from '../../../src/git-runner.mjs';

export function fakeGit(script = {}) {
  const calls = [];
  const git = {
    async run(args, { cwd, spec } = {}) {
      calls.push({ args: [...args], cwd, ...(spec && { spec }) });
      const key = args.join(' ');
      let answer = script[key];
      if (typeof answer === 'function') answer = answer({ args, cwd, calls });
      if (answer === undefined) throw new Error(`fake git has no answer for: git ${key}`);
      if (answer.code) throw new GitError(`git ${args[0]} failed (exit ${answer.code})`, { exitCode: answer.code, stderr: answer.stderr ?? '' });
      return { stdout: answer.stdout ?? '', stderr: '' };
    },
  };
  return { git, calls, verbs: () => calls.map((c) => c.args[0]) };
}
