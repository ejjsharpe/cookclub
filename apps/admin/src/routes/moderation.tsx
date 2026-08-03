import { useTRPC, type Outputs } from "@repo/trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  CircleSlash,
  Eye,
  EyeOff,
  LogOut,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useState } from "react";

import { authClient } from "../lib/auth";

export const Route = createFileRoute("/moderation")({
  component: ModerationRoute,
});

type Report = Outputs["admin"]["listReports"]["reports"][number];
type ReportStatus = "open" | "dismissed" | "resolved";
type ResolutionAction = "dismiss" | "hide" | "restore" | "ban" | "unban";

function ModerationRoute() {
  const session = authClient.useSession();
  if (session.isPending) {
    return (
      <main className="center-shell">
        <div className="loading-mark" />
      </main>
    );
  }
  if (!session.data) {
    return (
      <main className="center-shell">
        <section className="modal">
          <h1>Admin sign in required</h1>
          <a className="primary-button" href="/">
            Return to sign in
          </a>
        </section>
      </main>
    );
  }
  return (
    <ModerationQueue
      currentUserEmail={session.data.user.email}
      onSignOut={async () => {
        await authClient.signOut();
        window.location.assign("/");
      }}
    />
  );
}

function ModerationQueue({
  currentUserEmail,
  onSignOut,
}: {
  currentUserEmail: string;
  onSignOut: () => Promise<void>;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ReportStatus>("open");
  const [targetType, setTargetType] = useState<
    "" | "user" | "comment" | "activity" | "recipe"
  >("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  const reportsQuery = useQuery({
    ...trpc.admin.listReports.queryOptions({
      status,
      targetType: targetType || undefined,
      limit: 100,
      offset: 0,
    }),
  });
  const reports = reportsQuery.data?.reports ?? [];
  const selected = reports.find((report) => report.id === selectedId) ?? null;

  const resolveMutation = useMutation({
    ...trpc.admin.resolveReport.mutationOptions(),
    onSuccess: async () => {
      setNotes("");
      setSelectedId(null);
      await queryClient.invalidateQueries(trpc.admin.listReports.pathFilter());
      await queryClient.invalidateQueries(trpc.admin.listUsers.pathFilter());
    },
  });

  const resolve = (action: ResolutionAction) => {
    if (!selected || resolveMutation.isPending) return;
    resolveMutation.mutate({
      reportId: selected.id,
      action,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <main className="admin-shell sidebar-open">
      <aside aria-label="Admin navigation" className="side-rail">
        <div className="brand-lockup">
          <img alt="" className="brand-mark" src="/icons/icon.png" />
          <div>
            <strong>cookclub</strong>
            <span>Admin</span>
          </div>
        </div>
        <nav className="side-nav">
          <a href="/">
            <Users size={18} />
            Users
          </a>
          <span className="active">
            <ShieldAlert size={18} />
            Moderation
          </span>
        </nav>
      </aside>

      <div className="dashboard-main">
        <header className="topbar">
          <div>
            <h1>Moderation queue</h1>
            <p className="topbar-copy">
              {reportsQuery.data?.total ?? 0} {status} reports
            </p>
          </div>
          <div className="topbar-actions">
            <span className="account-chip">
              <span className="account-dot" />
              <span className="signed-in">{currentUserEmail}</span>
            </span>
            <button
              className="secondary-button logout-button"
              onClick={() => onSignOut().catch(console.error)}
              type="button"
            >
              <LogOut size={18} />
              Log out
            </button>
          </div>
        </header>

        <section className="toolbar" aria-label="Report filters">
          <div className="toolbar-controls">
            <label>
              <span className="toolbar-group-label">Status</span>
              <select
                onChange={(event) =>
                  setStatus(event.target.value as ReportStatus)
                }
                value={status}
              >
                <option value="open">Open</option>
                <option value="dismissed">Dismissed</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <label>
              <span className="toolbar-group-label">Target</span>
              <select
                onChange={(event) =>
                  setTargetType(event.target.value as typeof targetType)
                }
                value={targetType}
              >
                <option value="">All targets</option>
                <option value="user">Users</option>
                <option value="recipe">Recipes</option>
                <option value="activity">Activity</option>
                <option value="comment">Comments</option>
              </select>
            </label>
            <button
              className="icon-button"
              onClick={() => reportsQuery.refetch().catch(console.error)}
              title="Refresh"
              type="button"
            >
              <RefreshCw size={18} />
            </button>
          </div>
        </section>

        {reportsQuery.error ? (
          <p className="notice error">{getErrorMessage(reportsQuery.error)}</p>
        ) : null}
        {resolveMutation.error ? (
          <p className="notice error">
            {getErrorMessage(resolveMutation.error)}
          </p>
        ) : null}

        <section className="moderation-layout">
          <div className="table-shell" aria-label="Content reports">
            <table>
              <thead>
                <tr>
                  <th>Age</th>
                  <th>Target</th>
                  <th>Reason</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {reportsQuery.isPending ? (
                  <tr>
                    <td className="empty-row" colSpan={4}>
                      Loading reports…
                    </td>
                  </tr>
                ) : reports.length === 0 ? (
                  <tr>
                    <td className="empty-row" colSpan={4}>
                      No matching reports
                    </td>
                  </tr>
                ) : (
                  reports.map((report) => (
                    <tr
                      className={selectedId === report.id ? "selected-row" : ""}
                      key={report.id}
                      onClick={() => setSelectedId(report.id)}
                    >
                      <td>{formatAge(report.createdAt)}</td>
                      <td>
                        <strong>{report.targetType}</strong> #{report.targetId}
                      </td>
                      <td>{formatReason(report.reason)}</td>
                      <td>{report.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <ReportEvidence
            isPending={resolveMutation.isPending}
            notes={notes}
            onNotesChange={setNotes}
            onResolve={resolve}
            report={selected}
          />
        </section>
      </div>
    </main>
  );
}

function ReportEvidence({
  isPending,
  notes,
  onNotesChange,
  onResolve,
  report,
}: {
  isPending: boolean;
  notes: string;
  onNotesChange: (value: string) => void;
  onResolve: (action: ResolutionAction) => void;
  report: Report | null;
}) {
  if (!report) {
    return (
      <aside className="moderation-evidence">
        <p className="muted-cell">Select a report to review its evidence.</p>
      </aside>
    );
  }
  const contentTarget = report.targetType !== "user";
  return (
    <aside className="moderation-evidence">
      <p className="eyebrow">Report #{report.id}</p>
      <h2>{formatReason(report.reason)}</h2>
      <dl className="evidence-meta">
        <div>
          <dt>Submitted</dt>
          <dd>{new Date(report.createdAt).toLocaleString("en-GB")}</dd>
        </div>
        <div>
          <dt>Reporter</dt>
          <dd>{report.reporterUserId ?? "Deleted account"}</dd>
        </div>
        <div>
          <dt>Target owner</dt>
          <dd>{report.targetOwnerUserId ?? "Unavailable"}</dd>
        </div>
      </dl>
      {report.details ? <p>{report.details}</p> : null}
      <h3>Immutable evidence snapshot</h3>
      <pre>{JSON.stringify(report.targetSnapshot, null, 2)}</pre>
      {report.status === "open" ? (
        <>
          <label>
            <span>Resolution notes</span>
            <textarea
              maxLength={2_000}
              onChange={(event) => onNotesChange(event.target.value)}
              rows={4}
              value={notes}
            />
          </label>
          <div className="moderation-actions">
            <button disabled={isPending} onClick={() => onResolve("dismiss")}>
              <CheckCircle2 size={17} /> Dismiss
            </button>
            {contentTarget ? (
              <>
                <button disabled={isPending} onClick={() => onResolve("hide")}>
                  <EyeOff size={17} /> Hide
                </button>
                <button
                  disabled={isPending}
                  onClick={() => onResolve("restore")}
                >
                  <Eye size={17} /> Restore
                </button>
              </>
            ) : null}
            <button
              className="danger-button"
              disabled={isPending}
              onClick={() => onResolve("ban")}
            >
              <CircleSlash size={17} /> Ban user
            </button>
            <button disabled={isPending} onClick={() => onResolve("unban")}>
              Unban user
            </button>
          </div>
        </>
      ) : (
        <p className="muted-cell">
          This report is {report.status} and cannot be actioned again.
        </p>
      )}
    </aside>
  );
}

function formatReason(reason: string) {
  return reason
    .replaceAll("_", " ")
    .replace(/^./u, (value) => value.toUpperCase());
}

function formatAge(value: Date | string) {
  const milliseconds = Date.now() - new Date(value).getTime();
  const hours = Math.max(0, Math.floor(milliseconds / 3_600_000));
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}
