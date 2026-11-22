import { useAppApi, useAppEvents } from "@kirocrew/app-sdk";
import type { AppApi } from "@kirocrew/app-sdk";
import { Badge, Card, PageHeader, StatCard } from "@kirocrew/app-sdk/ui";
import type { BadgeVariant } from "@kirocrew/app-sdk/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { MANIFEST_SCHEMA } from "../../src/manifestTypes.js";
import type { DisassemblyManifest, ManifestDepthChange, ManifestScc } from "../../src/manifestTypes.js";
import { groupSccEdges } from "../../src/sccEdges.js";
import { SAMPLE_MANIFEST } from "./sample.js";

/** Host API path that returns the latest manifest. Needs a Kiro Crew host to answer. */
const MANIFEST_ENDPOINT = "/files/disassembly-manifest.json";
const MANIFEST_FILE = "disassembly-manifest.json";

type Source =
  | { kind: "live"; manifest: DisassemblyManifest }
  | { kind: "sample"; manifest: DisassemblyManifest; reason: string };

function isManifest(value: unknown): value is DisassemblyManifest {
  return typeof value === "object" && value !== null && (value as { schema?: unknown }).schema === MANIFEST_SCHEMA;
}

function parseManifest(raw: unknown): DisassemblyManifest {
  const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!isManifest(value)) {
    throw new Error(`The response is not a ${MANIFEST_SCHEMA} manifest.`);
  }
  return value;
}

/** `useAppApi` throws outside a Kiro Crew host. The page then runs in preview mode. */
function useHostApi(): { api: AppApi | null; reason: string } {
  try {
    return { api: useAppApi(), reason: "" };
  } catch (cause) {
    return { api: null, reason: `Kiro Crew host API unavailable: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}

/** Subscribes to host events. Outside a Kiro Crew host the hook throws and the page just does not auto-reload. */
function useHostEvents(onEvent: (type: string, payload: unknown) => void): void {
  try {
    useAppEvents((event) => onEvent(event.type, event.payload));
  } catch (cause) {
    console.info(`Kiro Crew host events unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function useManifest(): { source: Source; loading: boolean; reload: () => void } {
  const { api, reason } = useHostApi();
  const [source, setSource] = useState<Source>({
    kind: "sample",
    manifest: SAMPLE_MANIFEST,
    reason: reason === "" ? "Loading the latest manifest." : reason,
  });
  const [loading, setLoading] = useState(api !== null);
  const [version, setVersion] = useState(0);
  // The host may hand out a new client object on every render, so the effect reads it from a ref.
  const apiRef = useRef<AppApi | null>(api);
  apiRef.current = api;
  const hasApi = api !== null;

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    const client = apiRef.current;
    if (client === null) {
      setSource({ kind: "sample", manifest: SAMPLE_MANIFEST, reason });
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    client
      .get<unknown>(MANIFEST_ENDPOINT)
      .then((raw) => {
        if (!cancelled) {
          setSource({ kind: "live", manifest: parseManifest(raw) });
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          const message = cause instanceof Error ? cause.message : String(cause);
          setSource({ kind: "sample", manifest: SAMPLE_MANIFEST, reason: `No usable ${MANIFEST_FILE} yet (${message}). Run the audit to create one.` });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasApi, reason, version]);

  useHostEvents((type, payload) => {
    const text = `${type} ${typeof payload === "string" ? payload : JSON.stringify(payload ?? "")}`;
    if (text.includes(MANIFEST_FILE) || type.startsWith("audit.")) {
      reload();
    }
  });

  return { source, loading, reload };
}

// ---------------------------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------------------------

const grid: CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" };
const stack: CSSProperties = { display: "grid", gap: 16 };
const mono: CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 };
const muted: CSSProperties = { opacity: 0.75, fontSize: 13 };
const row: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" };

function statusVariant(status: DisassemblyManifest["assembly"]["status"]): BadgeVariant {
  return status === "solved" ? "success" : status === "deadlocked" ? "danger" : "warning";
}

function formatDir(dir: readonly number[]): string {
  return `(${dir.map((value) => value.toFixed(2)).join(", ")})`;
}

function depthText(depth: number | null): string {
  return depth === null ? "stuck" : String(depth);
}

function ClashBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }): ReactNode {
  const percent = max === 0 ? 0 : Math.max(value === 0 ? 0 : 2, Math.round((value / max) * 100));
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <span>{label}</span>
        <strong>{value} clashes</strong>
      </div>
      <div role="img" aria-label={`${label}: ${value} clashes`} style={{ background: "rgba(128,128,128,0.2)", borderRadius: 4, height: 10 }}>
        <div style={{ background: color, borderRadius: 4, height: 10, width: `${percent}%` }} />
      </div>
    </div>
  );
}

function SccCard({ scc, index }: { scc: ManifestScc; index: number }): ReactNode {
  return (
    <Card title={`Deadlock cycle ${index + 1}`} description="Tarjan SCC: none of these parts can move first.">
      <div style={stack}>
        <div style={row}>
          {scc.names.map((name) => (
            <Badge key={name} variant="danger">
              {name}
            </Badge>
          ))}
        </div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {groupSccEdges(scc).map((group) => (
            <li key={`${group.fromName}-${group.toName}`} style={mono}>
              {group.fromName} is blocked by {group.toName} in {group.directionCount} direction{group.directionCount === 1 ? "" : "s"}, e.g.{" "}
              {formatDir(group.sampleDir)}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function DepthRow({ change }: { change: ManifestDepthChange }): ReactNode {
  const worse = change.candidateDepth === null || (change.delta !== null && change.delta > 0);
  return (
    <tr>
      <td style={{ padding: "4px 12px 4px 0", ...mono }}>{change.name || change.partId}</td>
      <td style={{ padding: "4px 12px 4px 0" }}>
        {depthText(change.baselineDepth)} to {depthText(change.candidateDepth)}
      </td>
      <td style={{ padding: "4px 0" }}>
        <Badge variant={worse ? "danger" : "success"}>
          {change.delta === null ? (change.candidateDepth === null ? "now deadlocked" : "now reachable") : change.delta > 0 ? `+${change.delta}` : String(change.delta)}
        </Badge>
      </td>
    </tr>
  );
}

function DepthSection({ manifest }: { manifest: DisassemblyManifest }): ReactNode {
  const { diff, assembly } = manifest;
  if (diff === null) {
    const deepest = [...assembly.repairability.steps].sort((a, b) => b.depth - a.depth).slice(0, 8);
    return (
      <Card title="Repairability depth" description="No baseline in this run. Deepest parts are the hardest to service.">
        {deepest.length === 0 ? (
          <p style={muted}>No parts were removed, so no depth is available.</p>
        ) : (
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {deepest.map((step) => (
                <tr key={step.partId}>
                  <td style={{ padding: "4px 12px 4px 0", ...mono }}>{step.name || step.partId}</td>
                  <td style={{ padding: "4px 12px 4px 0" }}>depth {step.depth}</td>
                  <td style={{ padding: "4px 0", ...muted }}>{step.primitive ?? "no primitive"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    );
  }
  const regressions = [...diff.depthRegressions].sort((a, b) => (b.delta ?? Number.MAX_SAFE_INTEGER) - (a.delta ?? Number.MAX_SAFE_INTEGER));
  return (
    <Card
      title="Repairability depth diff"
      description={`Candidate against baseline ${diff.baseline.source.name}. Depth 1 comes out first, a larger depth is harder to reach.`}
    >
      <div style={stack}>
        {regressions.length === 0 ? (
          <p style={muted}>No part became harder to reach.</p>
        ) : (
          <table style={{ borderCollapse: "collapse" }}>
            <tbody>
              {regressions.map((change) => (
                <DepthRow key={change.partId} change={change} />
              ))}
            </tbody>
          </table>
        )}
        {diff.depthImprovements.length > 0 && (
          <div>
            <p style={muted}>Easier to reach</p>
            <table style={{ borderCollapse: "collapse" }}>
              <tbody>
                {diff.depthImprovements.map((change) => (
                  <DepthRow key={change.partId} change={change} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(diff.addedParts.length > 0 || diff.removedParts.length > 0) && (
          <p style={muted}>
            Added parts: {diff.addedParts.join(", ") || "none"}. Removed parts: {diff.removedParts.join(", ") || "none"}.
          </p>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

export default function App(): ReactNode {
  const { source, loading, reload } = useManifest();
  const { manifest } = source;
  const { assembly, verdict } = manifest;
  const passed = verdict.ci === "pass";
  const sccs = assembly.deadlock?.sccs ?? [];
  const maxClashes = Math.max(assembly.clashes.naive, assembly.clashes.oracle);

  return (
    <div style={{ ...stack, padding: 24 }}>
      <PageHeader
        title="Assembly CI"
        description={`${assembly.source.name} audited ${new Date(manifest.generatedAt).toLocaleString()} (${manifest.mode} mode)`}
        actions={
          <div style={row}>
            {source.kind === "sample" && <Badge variant="info">Sample preview</Badge>}
            <button type="button" onClick={reload} disabled={loading}>
              {loading ? "Loading" : "Reload"}
            </button>
          </div>
        }
      />

      {source.kind === "sample" && (
        <Card title="Sample data">
          <p style={muted}>
            {source.reason} The numbers below are illustrative. Run{" "}
            <code style={mono}>node apps/crew-assembly-ci/scripts/run-audit.mjs --kit haunted-clockwork-lockbox</code> to write a real{" "}
            <code style={mono}>{MANIFEST_FILE}</code>.
          </p>
        </Card>
      )}

      <div style={grid}>
        <StatCard label="CI verdict" value={passed ? "PASS" : "FAIL"} hint={verdict.summary} />
        <StatCard label="Assembly status" value={assembly.status} hint={`${assembly.partCount} parts, ${assembly.totalTriangles} triangles`} />
        <StatCard label="Max repairability depth" value={assembly.repairability.maxDepth} hint={`${assembly.repairability.steps.length} parts removed`} />
        <StatCard label="Clashes avoided" value={assembly.clashes.avoidedByPlan} hint={`naive ${assembly.clashes.naive}, DBG oracle ${assembly.clashes.oracle}`} />
      </div>

      <Card title="Verdict">
        <div style={stack}>
          <div style={row}>
            <Badge variant={passed ? "success" : "danger"}>{passed ? "PASS" : "FAIL"}</Badge>
            <Badge variant={statusVariant(assembly.status)}>{assembly.status}</Badge>
            {assembly.polyBudgetExceeded && <Badge variant="warning">sampled, approximate</Badge>}
          </div>
          <p style={{ margin: 0 }}>{verdict.summary}</p>
          {verdict.reasons.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {verdict.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          {verdict.warnings.map((warning) => (
            <div key={warning} style={row}>
              <Badge variant="warning">warning</Badge>
              <span style={{ fontSize: 13 }}>{warning}</span>
            </div>
          ))}
          {assembly.error !== null && (
            <p style={{ margin: 0 }}>
              <strong>{assembly.error.kind}:</strong> {assembly.error.message}
            </p>
          )}
        </div>
      </Card>

      {sccs.length === 0 ? (
        <Card title="Deadlock cycles">
          <p style={muted}>{assembly.status === "error" ? "The audit failed, so no deadlock check ran." : "No Tarjan SCC deadlock. Every part has a collision-free way out."}</p>
        </Card>
      ) : (
        <div style={stack}>
          {sccs.map((scc, index) => (
            <SccCard key={scc.partIds.join("|")} scc={scc} index={index} />
          ))}
          {(assembly.deadlock?.blockedByCycle.length ?? 0) > 0 && (
            <p style={muted}>Blocked by a cycle but not part of one: {assembly.deadlock?.blockedByCycle.map((part) => part.name || part.partId).join(", ")}.</p>
          )}
        </div>
      )}

      <DepthSection manifest={manifest} />

      <Card title="Naive radial explode vs DBG plan" description="Collisions counted by the independent Clash_Checker on the same assembly.">
        <div style={stack}>
          <ClashBar label="Naive radial explode" value={assembly.clashes.naive} max={maxClashes} color="#d9534f" />
          <ClashBar label="DBG plan (oracle)" value={assembly.clashes.oracle} max={maxClashes} color="#3fae6a" />
          <p style={muted}>
            The naive explode would push {assembly.clashes.naiveObstructedParts} of {assembly.partCount} parts through another part.
          </p>
        </div>
      </Card>
    </div>
  );
}
