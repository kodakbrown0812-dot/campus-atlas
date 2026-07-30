"use client";

import { HandoffSummary, PacketSummary } from "./ask-types";
import styles from "./ask.module.css";

export default function AskHistory({
  packets,
  handoffs,
  selectedPacketId,
  selectedHandoffId,
  onOpenPacket,
  onOpenHandoff,
}: {
  packets: PacketSummary[];
  handoffs: HandoffSummary[];
  selectedPacketId: string | null;
  selectedHandoffId: string | null;
  onOpenPacket(id: string): void;
  onOpenHandoff(id: string): void;
}) {
  return (
    <aside className={styles.history} aria-label="Canonical Ask history">
      <header>
        <span>Immutable history</span>
        <h2>Packets, handoffs, answers, and receipts</h2>
        <p>Opening history never recompiles a packet or retries a handoff.</p>
      </header>
      <section>
        <h3>Saved and failed packets</h3>
        {packets.length ? packets.map((packet) => (
          <button
            aria-current={selectedPacketId === packet.id ? "true" : undefined}
            className={selectedPacketId === packet.id ? styles.activeHistoryItem : styles.historyItem}
            key={packet.id}
            onClick={() => onOpenPacket(packet.id)}
            type="button"
          >
            <strong>{packet.task}</strong>
            <span>{packet.status} · {packet.finalTokenCount}/{packet.tokenBudget}</span>
            <small>{packet.id} · {packet.createdAt}</small>
          </button>
        )) : <p className={styles.empty}>No packet has been compiled.</p>}
      </section>
      <section>
        <h3>Handoffs and answers</h3>
        {handoffs.length ? handoffs.map((handoff) => (
          <button
            aria-current={selectedHandoffId === handoff.id ? "true" : undefined}
            className={selectedHandoffId === handoff.id ? styles.activeHistoryItem : styles.historyItem}
            key={handoff.id}
            onClick={() => onOpenHandoff(handoff.id)}
            type="button"
          >
            <strong>{handoff.originalTask}</strong>
            <span>{handoff.status} · {handoff.provider} · {handoff.model}</span>
            <small>
              {handoff.id} · {handoff.providerResponseId ? `answer ${handoff.providerResponseId}` : "no answer"}
            </small>
          </button>
        )) : <p className={styles.empty}>No handoff history exists.</p>}
      </section>
    </aside>
  );
}
