import { useCallback, useEffect, useState } from "react";
import { listOnboardingRequests, type OnboardingListResult } from "./administration-client";
import { classifyError, ErrorNotice, LoadingNotice, type ClassifiedError } from "./api-state";
import { QUEUE_STATUS_FILTERS, queueSearchMatch } from "./approvals-model";
import type { AdministrationRuntimeConfiguration } from "./runtime-config";

const PAGE_SIZE = 25;

interface Properties {
  configuration: AdministrationRuntimeConfiguration;
  token: string;
  onUnauthorized: () => void;
  onOpenRequest: (id: string) => void;
}

type QueueState =
  | { kind: "loading" }
  | { kind: "error"; error: ClassifiedError }
  | { kind: "ready"; result: OnboardingListResult };

// ApprovalQueuePage is the approver journey entry point: the tenant-scoped
// pending-request queue backed by administration-service
// GET /v1/onboarding/requests. Status filtering and pagination are
// server-side; the text search honestly filters the loaded page only.
export function ApprovalQueuePage({ configuration, token, onUnauthorized, onOpenRequest }: Properties) {
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  // offsets is the deterministic page-history stack; the current offset is
  // always the top entry so "previous page" never guesses.
  const [offsets, setOffsets] = useState<number[]>([0]);
  const [state, setState] = useState<QueueState>({ kind: "loading" });

  const offset = offsets[offsets.length - 1];

  const load = useCallback(async (status: string, currentOffset: number) => {
    setState({ kind: "loading" });
    try {
      const result = await listOnboardingRequests(configuration, token, {
        status: status === "" ? undefined : status,
        limit: PAGE_SIZE,
        offset: currentOffset,
      });
      setState({ kind: "ready", result });
    } catch (error) {
      const classified = classifyError(error);
      setState({ kind: "error", error: classified });
      if (classified.unauthorized) {
        onUnauthorized();
      }
    }
  }, [configuration, token, onUnauthorized]);

  useEffect(() => {
    void load(statusFilter, offset);
  }, [load, statusFilter, offset]);

  function changeFilter(value: string): void {
    setStatusFilter(value);
    setOffsets([0]);
  }

  function nextPage(nextOffset: number): void {
    setOffsets((current) => [...current, nextOffset]);
  }

  function previousPage(): void {
    setOffsets((current) => current.length > 1 ? current.slice(0, -1) : current);
  }

  return (
    <section className="queue-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Approver journey</p>
          <h2>Onboarding request queue</h2>
        </div>
        <p className="section-note">Tenant-scoped queue from the central administration API. Decisions, provisioning and activation happen on the request detail page.</p>
      </div>

      <div className="queue-controls">
        <label>
          Status filter
          <select value={statusFilter} onChange={(event) => changeFilter(event.target.value)}>
            {QUEUE_STATUS_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
          </select>
        </label>
        <label>
          Search this page
          <input type="search" value={search} placeholder="Name, email, organization or id" onChange={(event) => setSearch(event.target.value)} />
        </label>
        <button className="button button--quiet" onClick={() => void load(statusFilter, offset)}>Refresh</button>
      </div>

      {state.kind === "loading" && <LoadingNotice label="Reading the approver queue" />}
      {state.kind === "error" && <ErrorNotice error={state.error} onRetry={() => void load(statusFilter, offset)} />}
      {state.kind === "ready" && (
        <QueueTable
          result={state.result}
          search={search}
          canGoBack={offsets.length > 1}
          onPrevious={previousPage}
          onNext={nextPage}
          onOpenRequest={onOpenRequest}
        />
      )}
    </section>
  );
}

interface QueueTableProperties {
  result: OnboardingListResult;
  search: string;
  canGoBack: boolean;
  onPrevious: () => void;
  onNext: (nextOffset: number) => void;
  onOpenRequest: (id: string) => void;
}

function QueueTable({ result, search, canGoBack, onPrevious, onNext, onOpenRequest }: QueueTableProperties) {
  const visible = result.requests.filter((record) => queueSearchMatch(record, search));
  if (result.requests.length === 0) {
    return (
      <section className="empty-state" aria-live="polite">
        <p className="eyebrow">Queue empty</p>
        <h2>No onboarding requests match this filter</h2>
        <p>The administration API returned zero records for the current tenant and status filter. This is an observed empty result, not a placeholder.</p>
      </section>
    );
  }
  return (
    <>
      <table className="queue-table">
        <thead>
          <tr>
            <th scope="col">Organization / agency</th>
            <th scope="col">Stakeholder</th>
            <th scope="col">Submitted at</th>
            <th scope="col">Status</th>
            <th scope="col"><span className="visually-hidden">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((record) => (
            <tr key={record.id}>
              <td>{record.organization_id}</td>
              <td>
                <span className="queue-name">{record.first_name} {record.last_name}</span>
                <span className="queue-email">{record.email === "" ? `${record.contact_channel ?? ""}:${record.contact_reference ?? ""}` : record.email}</span>
              </td>
              <td>{new Date(record.created_at).toLocaleString()}</td>
              <td><span className={`status-chip status-chip--${record.status}`}>{record.status}</span></td>
              <td><button className="button button--outline" onClick={() => onOpenRequest(record.id)}>Review</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {visible.length === 0 && (
        <p className="queue-note" role="status">No rows on this page match the search text. The search covers only the currently loaded page of {result.page.total} record(s).</p>
      )}
      <div className="queue-pagination">
        <button className="button button--outline" disabled={!canGoBack} onClick={onPrevious}>Previous page</button>
        <span aria-live="polite">
          Showing {result.page.offset + 1}–{result.page.offset + result.requests.length} of {result.page.total}
        </span>
        <button
          className="button button--outline"
          disabled={result.page.next_offset === null}
          onClick={() => { if (result.page.next_offset !== null) { onNext(result.page.next_offset); } }}
        >
          Next page
        </button>
      </div>
    </>
  );
}
