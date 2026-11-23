# Kiro IDE: what to use for UnboltKit

Checked November 23, 2026. The installed macOS bundle reports **1.5.11**; the [IDE release log](https://kiro.dev/changelog/ide/) dates that build to November 20. This guide describes the desktop IDE, not the separate Kiro Crew product. It does not assume which account, organization or plan is signed in.

## Pick a model

Open the model button in the chat input bar. The dropdown shows what this account can select; the Effort slider appears only when supported. The [model comparison](https://kiro.dev/docs/models/), [lifecycle table](https://kiro.dev/docs/models/available-models/), [model changes](https://kiro.dev/changelog/models/) and [effort reference](https://kiro.dev/docs/models/effort/) are the sources. Model availability depends on subscription, supported geography and, where applicable, administrator policy.

| Commercial catalog, grouped by access | Models as of this check |
| --- | --- |
| Free tier options also listed for paid users | Auto, Claude Sonnet 4.5, GLM-5, MiniMax M2.5, DeepSeek 3.2, MiniMax M2.1, Qwen3 Coder Next. Some options are US-only or experimental. |
| Additional paid options (Pro, Pro+, Pro Max, Power) | GPT-5.6 Sol, Terra and Luna; Claude Opus 5.5, 5, 4.8, 4.7, 4.6 and 4.5; Claude Sonnet 5.5, 5 and 4.6; Claude Haiku 5.5 and 4.5; Kimi K3; Grok 4.7 (experimental). |
| Enterprise with explicit administrator enablement | Claude Fable 5.1, US East only. GovCloud has a separate catalog. |

The overview still contains a row for Sonnet 4.0. The dated retirement notice and lifecycle table mark it end of life on **October 14, 2026**, so it is excluded above.

**Project choice:** GPT-5.6 Sol at High for tracing the first false collision clearance across the solver, independent checker and UI. Claude Opus 5.5 is a good alternative if offered; use Auto if neither is visible. For routine scoped UI work after the geometry contract is settled, I would use Sonnet 5.5 or Auto. These are task-specific recommendations, not measured accuracy rankings on our repo.

## Desktop feature map

| Capability | What it does and where it fits |
| --- | --- |
| [Chat and context](https://kiro.dev/docs/ide/chat/) | Start with Default for quick edits or Plan for investigation. Attach relevant files, folders, specs, diffs, diagnostics, terminal output or images. For the collision bug use the TypeScript probe; the project's [.kiroignore](../../.kiroignore) excludes GLB files. |
| [Specs](https://kiro.dev/docs/specs/) and [Bug Fix](https://kiro.dev/docs/specs/bugfix-specs/) | Feature Specs offer requirements-first or design-first; Quick Spec suits a bounded, understood change. Bug Fix records current, expected and preserved behavior before design and tasks. Review individual spec tasks or run independent tasks in parallel. Use Bug Fix now; later use a feature spec for the selected-part, fixed-shaft interaction. |
| [Steering](https://kiro.dev/docs/steering/), [Memory](https://kiro.dev/docs/memory/), [compaction](https://kiro.dev/docs/compaction/) | Steering supplies persistent project instructions; Memory can carry lessons across chats if enabled; compaction shortens a long conversation. Keep geometry constraints and verified release decisions in files teammates can inspect. |
| [Hooks](https://kiro.dev/docs/hooks/) | Run a command or prompt an agent on defined events. The [existing test hook](../../.kiro/hooks/verify-dbg-invariants.kiro.hook) runs the core quick suite after a matching edit; it does not replace the invariant suite. The [second hook](../../.kiro/hooks/sync-extraction-primitive.kiro.hook) coordinates consumers of changed primitives. |
| [MCP](https://kiro.dev/docs/mcp/), [Powers](https://kiro.dev/docs/powers/) and [Skills](https://kiro.dev/docs/skills/) | MCP exposes callable tools; a Power can bundle tools with domain guidance; a Skill supplies reusable instructions. The repo already [registers the CAD auditor](../../.kiro/settings/mcp.json) and contains the [Power and its documented tools](../../powers/cad-assembly-auditor/POWER.md). Later, ask the connected auditor to inspect a **bundled sample kit** by name. A zero from the existing checker is not independent proof the crossed-bars case is clear. |
| [Custom agents](https://kiro.dev/docs/custom-agents/), sub-agents and [workflows](https://kiro.dev/docs/workflows/) | Define roles and tools, delegate a second opinion, or run a repeatable multi-step process. A read-only reviewer can challenge whether a proposed fix rejects every move indiscriminately. The built-in Bug Fix chat and a saved declarative workflow are distinct. |
| [Editor](https://kiro.dev/docs/ide/editor/interface/), [Markdown Review](https://kiro.dev/docs/ide/editor/markdown-review/) and [built-in tools](https://kiro.dev/docs/tools/) | Source control and diffs, diagnostics, debugging, multi-root workspaces, compatible extensions, integrated terminal, background dev servers, semantic code tools, and review comments anchored to spec text. Comment on the acceptance criteria directly in bugfix.md. |
| [Permissions](https://kiro.dev/docs/permissions/), [checkpoints](https://kiro.dev/docs/checkpoints/) and [changelog](https://kiro.dev/changelog/ide/) | Supervised lets you review edits. Where enabled, other modes include Accept file changes and Approve for me. Command sandboxing and permission rules control access; checkpoints restore prior edits. Use Supervised for the first geometry investigation. |
| [Agent Focus](https://kiro.dev/docs/ide/experimental/focus-mode/), [artifacts](https://kiro.dev/docs/ide/chat/artifacts/) and [session export](https://kiro.dev/docs/ide/chat/chat-export/) | Track sessions and inspect their outputs. Artifacts are session outputs; write the regression to the repo for durable evidence. Retain a genuine before/after run or a cropped screenshot from the chat for the Kiro story. |
| [Remote development](https://kiro.dev/docs/ide/remote-development/) | This release adds SSH to a Linux host, Dev Containers and opening cloud sessions from the IDE. The local project already contains the untracked regression probe, so start in the current local workspace. |

## First session: diagnose the crossed-bars bug

Open a new local chat → **Bug Fix** → **Supervised** → choose the model. Paste:

> Investigate a false “Verified” result in UnboltKit. This is the analysis phase of a Bug Fix spec. Leave production code and existing tests unchanged for this turn.
>
> From the repository root, read demo-video/research/probes/crossed-bars.ts and run the two commands in its header, one at a time. Report the actual selected part and direction, checker hit count, and the first sampled pose at which the meshes intersect. An expected failing assertion is evidence. If your output differs, report it before diagnosing.
>
> Trace how this move gets accepted in packages/unbolt-core, what the independent checker measures, and where Guide Forge turns zero hits into “Verified.” Cite the relevant file and function for each. Distinguish observed facts from your hypothesis.
>
> Write bugfix.md covering the observed defect, expected behavior, and behavior to preserve. Design a nearby control where the same part travels the same direction and distance but clears the obstacle; explain how the two cases can be told apart independently. For finite straight moves, distinguish blocked, clear with supporting evidence, and unverified. Preserve valid teardowns and the independence of the checker. No special cases for names, no blanket rejection, and no claim about rotational paths. Stop at the analysis for review.

**Review before implementation:** the result should contain the failing run, code references and a specific control with a geometric reason it clears. A universal “unverified” label or denser sampling presented as a proof is insufficient. The next step is a regression and its passing control, then the smallest shared correction; the red-ring UI comes after that. See the [project decision](overall-prize-decision.md).
