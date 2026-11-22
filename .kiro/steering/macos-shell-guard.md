---
inclusion: always
---

# macOS Shell Guard

## Environment
- This workspace runs on macOS with `zsh`.
- The workspace path contains a space: `/Users/sarvesh/Dev/Kiroween 2027`.
- Always double-quote paths in shell commands, for example `cd "/Users/sarvesh/Dev/Kiroween 2027"`.

## Forbidden patterns
- Never use GNU `timeout`. It is not installed on macOS. Use the `timeout` parameter of the tool instead.
- Never run `execute_bash` calls in parallel. Run them one at a time, in sequence.

## Unreliable exit codes
- Kiro's macOS PTY sometimes reports `Exit Code: -1` even when the command succeeded.
- Do not trust `-1` alone. Read stdout and stderr for the real result, for example `Test Files ... passed`.
- Never retry the same failing command more than twice.
- If bash keeps failing, stop and ask the user to run the command in Terminal and share the output.
