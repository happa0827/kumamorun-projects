#!/usr/bin/env python3
"""PreToolUse hook: deny Bash commands that read or write files directly.

File access should go through the Read / Edit / Write tools. Commands are
tokenized (quotes, heredocs, comments) so that text such as grep '>' or the
body of a heredoc is not mistaken for a redirect.

Allowed on purpose: filters reading from a pipe (`ls | head -n 5`), `tail -f`,
grep/find, and redirects to /dev/* or /tmp/*.
Not detected: file access inside scripts (python open()), `xargs cat`,
`find -exec cat`, and commands inside double-quoted $(...).
"""
import json
import os
import re
import sys

OPERATORS = sorted(
    ["<<<", "<<-", "<<", ">>", "&>>", "&>", ">&", "<&", ">|", "&&", "||", "|&",
     ";;", "|", "&", ";", "(", ")", "<", ">", "`"],
    key=len, reverse=True,
)
CONTROL = {";", ";;", "&", "&&", "|", "|&", "||", "(", ")", "`"}
WRITE_REDIRECTS = {">", ">>", ">|", "&>", "&>>"}
KEYWORDS = {"do", "then", "else", "elif", "if", "while", "until", "!", "{"}
WRAPPERS = {"sudo", "command", "env", "time", "nohup", "exec"}
SHELLS = {"sh", "bash", "zsh"}
READERS = {"cat", "head", "tail", "less", "more", "bat"}
HEAD_TAIL_VALUE_OPTS = {"-n", "-c", "--lines", "--bytes"}

READ_HINT = "Use the Read tool to read files."
EDIT_HINT = "Use the Edit tool to change files."
WRITE_HINT = "Use the Write or Edit tool to write files."


def tokenize(s):
    """Split a shell command into ("word", text) and ("op", text) tokens."""
    tokens, cur, quoted = [], "", False
    heredocs, want_delim = [], None
    i, n = 0, len(s)

    def flush():
        nonlocal cur, quoted, want_delim
        if cur or quoted:
            if want_delim is not None:
                heredocs.append((cur, want_delim == "<<-"))
                want_delim = None
            else:
                tokens.append(("word", cur))
        cur, quoted = "", False

    while i < n:
        c = s[i]
        if c == "\\":
            if s[i + 1:i + 2] != "\n":
                cur += s[i + 1:i + 2]
                quoted = True
            i += 2
        elif c == "'":
            end = s.find("'", i + 1)
            end = n if end == -1 else end
            cur += s[i + 1:end]
            quoted = True
            i = end + 1
        elif c == '"':
            i += 1
            depth = 0  # inside "$(...)" a double quote does not close the string
            while i < n and (s[i] != '"' or depth > 0):
                if s[i] == "\\":
                    cur += s[i + 1:i + 2]
                    i += 2
                    continue
                if s.startswith("$(", i):
                    depth += 1
                elif s[i] == ")" and depth > 0:
                    depth -= 1
                cur += s[i]
                i += 1
            quoted = True
            i += 1
        elif c == "#" and not cur and not quoted:
            end = s.find("\n", i)
            i = n if end == -1 else end
        elif c in " \t":
            flush()
            i += 1
        elif c == "\n":
            flush()
            tokens.append(("op", ";"))
            i += 1
            for delim, strip_tabs in heredocs:
                while i < n:
                    end = s.find("\n", i)
                    end = n if end == -1 else end
                    line = s[i:end]
                    i = end + 1
                    if (line.lstrip("\t") if strip_tabs else line) == delim:
                        break
            heredocs.clear()
        else:
            op = next((o for o in OPERATORS if s.startswith(o, i)), None)
            if op is None:
                cur += c
                i += 1
                continue
            if cur.isdigit() and not quoted and op[0] in "<>":
                cur = ""  # file descriptor number, as in 2>
            flush()
            i += len(op)
            if op in ("<<", "<<-"):
                want_delim = op
            else:
                tokens.append(("op", op))
    flush()
    return tokens


def read_ok(path):
    return path == "-" or path.startswith("/dev/")


def write_ok(path):
    return path.startswith(("/dev/", "/tmp/"))


def positional(args, value_opts=()):
    out, skip = [], False
    for a in args:
        if skip:
            skip = False
        elif a in value_opts:
            skip = True
        elif a == "-" or not a.startswith("-"):
            out.append(a)
    return out


def check_sed(args):
    if any(re.match(r"^-[a-zA-Z]*i|^--in-place", a) for a in args):
        return f"sed in-place edit. {EDIT_HINT}"
    rest, has_script, skip = [], False, False
    for a in args:
        if skip:
            skip = False
        elif re.match(r"^-[a-zA-Z]*[ef]$", a):
            has_script = skip = True
        elif a.startswith("--expression") or a.startswith("--file"):
            has_script = True
            skip = "=" not in a
        elif a == "-" or not a.startswith("-"):
            rest.append(a)
    files = rest if has_script else rest[1:]
    if any(not read_ok(f) for f in files):
        return f"sed on a file. {READ_HINT} {EDIT_HINT}"
    return None


def check_command(args, stdin_file):
    """Return (reasons) for one simple command given as a list of words."""
    while args and (
        args[0] in KEYWORDS
        or args[0] in WRAPPERS
        or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", args[0])
    ):
        args = args[1:]
    if not args:
        return []
    cmd, rest = os.path.basename(args[0]), args[1:]

    if cmd == "eval":
        return analyze(" ".join(rest))
    if cmd in SHELLS and "-c" in rest[:-1]:
        return analyze(rest[rest.index("-c") + 1])

    if cmd in READERS:
        if cmd == "tail" and any(
            re.match(r"^-[a-zA-Z]*[fF]", a) or a == "--follow" for a in rest
        ):
            return []
        opts = HEAD_TAIL_VALUE_OPTS if cmd in ("head", "tail") else ()
        files = positional(rest, opts)
        if stdin_file:
            files.append(stdin_file)
        if any(not read_ok(f) for f in files):
            return [f"{cmd} on a file. {READ_HINT}"]
    elif cmd == "sed":
        reason = check_sed(rest)
        return [reason] if reason else []
    elif cmd == "tee":
        if any(not write_ok(f) for f in positional(rest)):
            return [f"tee to a file. {WRITE_HINT}"]
    elif cmd in ("awk", "gawk"):
        if any(a == "inplace" or a == "-iinplace" for a in rest):
            return [f"awk in-place edit. {EDIT_HINT}"]
    elif cmd == "perl":
        if any(re.match(r"^-[pnlaeEw0]*i", a) for a in rest):
            return [f"perl in-place edit. {EDIT_HINT}"]
    return []


def check_segment(segment):
    reasons, args, stdin_file = [], [], None
    k = 0
    while k < len(segment):
        kind, text = segment[k]
        k += 1
        if kind == "word":
            args.append(text)
            continue
        target = segment[k][1] if k < len(segment) else ""
        k += 1
        if text in WRITE_REDIRECTS or (text == ">&" and not re.match(r"^(\d+|-)$", target)):
            if not write_ok(target):
                reasons.append(f"redirect to file '{target}'. {WRITE_HINT}")
        elif text == "<":
            stdin_file = target
    return reasons + check_command(args, stdin_file)


def analyze(command):
    reasons, segment = [], []
    for token in tokenize(command) + [("op", ";")]:
        if token[0] == "op" and token[1] in CONTROL:
            if segment:
                reasons += check_segment(segment)
            segment = []
        else:
            segment.append(token)
    return reasons


def main():
    payload = json.load(sys.stdin)
    command = payload.get("tool_input", {}).get("command", "")
    reasons = list(dict.fromkeys(analyze(command)))
    if not reasons:
        return
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason":
                "Blocked by project hook: " + " ".join(reasons),
        }
    }))


if __name__ == "__main__":
    main()
