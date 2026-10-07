/**
 * Delivery (SPEC §5): the answers' pieces not delivered yet (queued, being sent, waiting for a retry)
 * and those that settled (delivered, possibly twice, or abandoned), as the outbound queue keeps them.
 * Shown when an `outbound.queue` is installed (outbound-durable).
 */

import { Activity, Antenna, ChatBubble, CheckCircle, Clock, DeliveryTruck, Hashtag, Repeat, SendDiagonal, Timer, WarningTriangle } from "iconoir-react";
import { useCallback, useEffect, useRef, useState } from "react";
import EmptyState from "@/components/bui/EmptyState";
import { FilterChips, type PillTone, StatePill } from "@/components/bui/FilterTable";
import { Page, Section } from "@/components/bui/Page";
import RecordsTable, { type RecordColumn, RecordMark, RecordName, RecordTag } from "@/components/bui/RecordsTable";
import { ErrorNote } from "@/components/pikit/error-note";
import { usePolling } from "@/lib/activity";
import { api, type ApiPage, type ApiPendingPiece, type ApiReceipt, type ApiReceiptsPage, useApi } from "@/lib/api";
import { formatAgo } from "@/lib/format";
import { defineView } from "@/lib/views";

/** Receipts kept in the page: the most recent ones. */
const KEPT = 500;

/** Every receipt from the oldest the queue keeps, then each new one, every `everyMs` while the dashboard is active. */
function useReceipts(everyMs: number) {
  const [receipts, setReceipts] = useState<ApiReceipt[]>([]);
  const [gap, setGap] = useState(false);
  const [error, setError] = useState<Error>();
  const after = useRef<string>(undefined);
  const live = useRef(true);
  const reading = useRef(false);

  const tick = useCallback(() => {
    if (reading.current) return;
    reading.current = true;
    const readOn = async () => {
      for (let pages = 0; pages < 20; pages++) {
        const page = await api<ApiReceiptsPage>(`/delivery/receipts?limit=200${after.current === undefined ? "" : `&after=${encodeURIComponent(after.current)}`}`);
        if (!live.current) return;
        if (page.gap) setGap(true);
        if (page.items.length > 0) setReceipts((kept) => [...kept, ...page.items].slice(-KEPT));
        after.current = page.next ?? after.current;
        if (page.items.length < 200) return;
      }
    };
    readOn()
      .then(() => live.current && setError(undefined))
      .catch((thrown: unknown) => live.current && setError(thrown instanceof Error ? thrown : new Error(String(thrown))))
      .finally(() => (reading.current = false));
  }, []);

  useEffect(() => {
    live.current = true;
    tick();
    return () => {
      live.current = false;
    };
  }, [tick]);
  usePolling(tick, everyMs);

  return { receipts, gap, error };
}

type PendingFilter = "all" | ApiPendingPiece["state"];
type SettledFilter = "all" | "delivered" | "twice" | "abandoned";

const PENDING_TONE: Record<ApiPendingPiece["state"], PillTone> = { queued: "neutral", sending: "blue", retrying: "orange" };

/** How a receipt settled: delivered, possibly twice, or abandoned. */
const outcomeOf = (receipt: ApiReceipt): Exclude<SettledFilter, "all"> =>
  receipt.outcome.kind === "abandoned" ? "abandoned" : receipt.outcome.possibleDuplicate ? "twice" : "delivered";
const OUTCOME: Record<Exclude<SettledFilter, "all">, { label: string; tone: PillTone }> = {
  delivered: { label: "delivered", tone: "green" },
  twice: { label: "possibly twice", tone: "orange" },
  abandoned: { label: "abandoned", tone: "red" },
};

/** The conversation a piece is for: its key without the channel, the channel as a tag. */
function conversationColumns<T extends { conversationKey: string; channel: string; index: number }>(): RecordColumn<T>[] {
  const name = (row: T) => row.conversationKey.slice(row.conversationKey.indexOf(":") + 1) || row.conversationKey;
  return [
    {
      key: "conversation",
      label: "Conversation",
      icon: <ChatBubble />,
      width: 210,
      sort: (a, b) => a.conversationKey.localeCompare(b.conversationKey),
      title: (row) => row.conversationKey,
      cell: (row) => (
        <>
          <RecordMark name={name(row)} />
          <RecordName>{name(row)}</RecordName>
        </>
      ),
    },
    { key: "channel", label: "Channel", icon: <Antenna />, width: 110, sort: (a, b) => a.channel.localeCompare(b.channel), cell: (row) => <RecordTag>{row.channel}</RecordTag> },
    { key: "piece", label: "Piece", icon: <Hashtag />, width: 80, end: true, cell: (row) => row.index + 1 },
  ];
}

function DeliveryPage() {
  const pending = useApi<ApiPage<ApiPendingPiece>>("/delivery/pending?limit=500", 5000);
  const { receipts, gap, error } = useReceipts(5000);
  const [pendingFilter, setPendingFilter] = useState<PendingFilter>("all");
  const [settledFilter, setSettledFilter] = useState<SettledFilter>("all");
  const waiting = pending.data?.items ?? [];
  const settled = [...receipts].reverse();
  const counted = (outcome: Exclude<SettledFilter, "all">) => receipts.filter((receipt) => outcomeOf(receipt) === outcome).length;
  const waitingCount = (state: ApiPendingPiece["state"]) => waiting.filter((piece) => piece.state === state).length;

  const pendingColumns: RecordColumn<ApiPendingPiece>[] = [
    ...conversationColumns<ApiPendingPiece>(),
    {
      key: "state",
      label: "State",
      icon: <Activity />,
      width: 170,
      sort: (a, b) => a.state.localeCompare(b.state),
      cell: (piece) => (
        <StatePill tone={PENDING_TONE[piece.state]} title={piece.possibleDuplicate ? "Its next send may repeat one that reached the platform" : undefined}>
          {piece.state}
          {piece.possibleDuplicate && " · may repeat"}
        </StatePill>
      ),
    },
    { key: "attempts", label: "Attempts", icon: <Repeat />, width: 110, end: true, cell: (piece) => piece.attempts },
    {
      key: "next",
      label: "Next try",
      icon: <Timer />,
      width: 120,
      muted: (piece) => piece.nextAttemptAt === undefined,
      sort: (a, b) => (a.nextAttemptAt ?? 0) - (b.nextAttemptAt ?? 0),
      cell: (piece) => (piece.nextAttemptAt === undefined ? "—" : piece.nextAttemptAt <= Date.now() ? "due now" : formatAgo(piece.nextAttemptAt)),
    },
    { key: "error", label: "Last error", icon: <WarningTriangle />, width: 150, muted: (piece) => piece.lastError === undefined, title: (piece) => piece.lastError, cell: (piece) => piece.lastError ?? "—" },
    { key: "stored", label: "Stored", icon: <Clock />, width: 120, sort: (a, b) => a.storedAt - b.storedAt, cell: (piece) => <span className="text-ink-2">{formatAgo(piece.storedAt)}</span> },
  ];

  const settledColumns: RecordColumn<ApiReceipt>[] = [
    ...conversationColumns<ApiReceipt>(),
    {
      key: "outcome",
      label: "Outcome",
      icon: <CheckCircle />,
      width: 150,
      cell: (receipt) => <StatePill tone={OUTCOME[outcomeOf(receipt)].tone}>{OUTCOME[outcomeOf(receipt)].label}</StatePill>,
    },
    { key: "attempts", label: "Attempts", icon: <Repeat />, width: 110, end: true, cell: (receipt) => receipt.attempts },
    {
      key: "why",
      label: "Why",
      icon: <WarningTriangle />,
      width: 250,
      muted: (receipt) => receipt.outcome.kind !== "abandoned",
      title: (receipt) => (receipt.outcome.kind === "abandoned" ? receipt.outcome.reason : undefined),
      cell: (receipt) => (receipt.outcome.kind === "abandoned" ? receipt.outcome.reason : "—"),
    },
    { key: "when", label: "When", icon: <Clock />, width: 120, sort: (a, b) => a.at - b.at, cell: (receipt) => <span className="text-ink-2">{formatAgo(receipt.at)}</span> },
  ];

  return (
    <Page
      eyebrow="Delivery"
      title={pending.data === undefined ? undefined : waiting.length === 0 ? "Every answer went out" : `${waiting.length} ${waiting.length === 1 ? "piece" : "pieces"} not delivered yet`}
      description="The answers' pieces as the outbound queue keeps them: those it still holds (never tried, being sent, or waiting to be sent again) and the latest that settled. Never their text."
    >
      <Section
        title="Not delivered yet"
        meta={pending.data === undefined ? undefined : waiting.length}
        tools={
          <FilterChips
            label="Show the pieces that are"
            value={pendingFilter}
            onChange={setPendingFilter}
            filters={[
              { key: "all", label: "All", count: waiting.length },
              { key: "queued", label: "Queued", tone: "neutral", count: waitingCount("queued") },
              { key: "sending", label: "Sending", tone: "blue", count: waitingCount("sending") },
              { key: "retrying", label: "Retrying", tone: "orange", count: waitingCount("retrying") },
            ]}
          />
        }
      >
        {pending.error !== undefined && <ErrorNote error={pending.error} title="The queue cannot be read" />}
        <RecordsTable
          label="Pieces not delivered yet"
          columns={pendingColumns}
          rows={pendingFilter === "all" ? waiting : waiting.filter((piece) => piece.state === pendingFilter)}
          rowKey={(piece) => `${piece.idempotencyKey}#${piece.index}`}
          maxHeight={420}
          empty={
            pending.data === undefined ? (
              <EmptyState icon={<Timer />} title="Reading the queue" />
            ) : waiting.length === 0 ? (
              <EmptyState icon={<SendDiagonal />} title="Nothing waiting" hint="Every answer went out." />
            ) : (
              <EmptyState icon={<SendDiagonal />} title={`No piece is ${pendingFilter}`} hint="Pick another filter to see the others." />
            )
          }
        />
      </Section>

      <Section
        title="Settled"
        meta="the latest, newest first"
        tools={
          <FilterChips
            label="Show the pieces that were"
            value={settledFilter}
            onChange={setSettledFilter}
            filters={[
              { key: "all", label: "All", count: receipts.length },
              { key: "delivered", label: "Delivered", tone: "green", count: counted("delivered") },
              { key: "twice", label: "Possibly twice", tone: "orange", count: counted("twice") },
              { key: "abandoned", label: "Abandoned", tone: "red", count: counted("abandoned") },
            ]}
          />
        }
      >
        {error !== undefined && <ErrorNote error={error} title="The receipts cannot be read" />}
        {gap && <p className="text-[12.5px] text-ink-3">Older receipts were pruned by the queue before they were read.</p>}
        <RecordsTable
          label="Pieces delivered or given up"
          columns={settledColumns}
          rows={settledFilter === "all" ? settled : settled.filter((receipt) => outcomeOf(receipt) === settledFilter)}
          rowKey={(receipt) => receipt.cursor}
          empty={
            receipts.length === 0 ? (
              <EmptyState icon={<CheckCircle />} title="Nothing settled yet" hint="No answer has gone through the queue yet." />
            ) : (
              <EmptyState icon={<CheckCircle />} title={`No piece ${settledFilter === "twice" ? "was possibly delivered twice" : `was ${settledFilter}`}`} hint="Pick another filter to see the others." />
            )
          }
        />
      </Section>
    </Page>
  );
}

export default defineView({
  id: "delivery",
  title: "Delivery",
  icon: DeliveryTruck,
  requires: ["outbound.queue"],
  order: 30,
  pages: [{ path: "/delivery", component: DeliveryPage, fill: true }],
});
