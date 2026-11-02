// Draft From Commits: prints a JSON skeleton of changelog changes from `git log` since the last release commit (a subject
// that starts "v1.2.3"), for the owner to rewrite in plain customer language in the Updates tab. Calls no AI and writes
// nothing: not the database, not a file. Run with `pnpm updates:draft`; an optional argument names another starting point.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** A release commit: the subject starts with a version, as in "v0.0.16". */
export const isReleaseSubject = (s) => /^v\d+\.\d+\.\d+/.test(s.trim());
/** Merges and release commits carry no change of their own. */
const isNoise = (s) => isReleaseSubject(s) || /^merge\b/i.test(s.trim());

/** The commit text without a "wave7:" style prefix, starting with a capital and cut to the database's 300 characters. */
export function cleanSubject(s) {
  const t = s.trim().replace(/^wave\s*\d+\s*[:\-]\s*/i, "").replace(/\s+/g, " ");
  const cut = t.length > 300 ? `${t.slice(0, 297).trimEnd()}...` : t;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

/** Which heading a commit most likely belongs under. A guess: the owner fixes it while rewriting. */
export function kindOf(subject) {
  const t = cleanSubject(subject);
  if (/^(fix|fixes|fixed|repair|stop|prevent|correct|handle)\b/i.test(t)) return "fixed";
  if (/^(add|adds|added|new|introduce|allow|let|support|show)\b/i.test(t)) return "new";
  return "improved";
}

/** Turns commits (newest first, as `git log` prints them) into the skeleton: changes oldest first, each with a kind and text. */
export function draftFromCommits(commits, since) {
  const used = commits.filter((c) => !isNoise(c.subject)).reverse();
  return {
    since: since ?? null,
    note: "A rough list from commit messages. Rewrite each line in plain customer words, drop internal ones, then paste into New Update.",
    changes: used.map((c) => ({ kind: kindOf(c.subject), text: cleanSubject(c.subject) })),
    commits: used.map((c) => `${c.sha} ${c.subject.trim()}`),
  };
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

/** The newest commit on this branch whose subject is a release, or a tag when one is newer. Undefined when there is neither. */
function lastRelease() {
  const line = git("log", "--first-parent", "--format=%H%x09%s", "-500").split("\n").map((l) => l.split("\t")).find(([, s]) => s && isReleaseSubject(s));
  return line ? { ref: line[0], label: line[1] } : undefined;
}

function main() {
  const arg = process.argv[2];
  const start = arg ? { ref: arg, label: arg } : lastRelease();
  const range = start ? `${start.ref}..HEAD` : "HEAD";
  const raw = git("log", "--no-merges", "--format=%h%x09%s", range);
  const commits = raw ? raw.split("\n").map((l) => { const [sha, ...rest] = l.split("\t"); return { sha, subject: rest.join("\t") }; }) : [];
  process.stdout.write(`${JSON.stringify(draftFromCommits(commits, start?.label), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
