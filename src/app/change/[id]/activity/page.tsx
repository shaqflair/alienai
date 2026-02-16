import ChangeHeader from "@/components/change/ChangeHeader";
import ChangeManagementBoard from "@/components/change/ChangeManagementBoard";

type Props = { params: { id: string } };

export default function ChangeActivityPage({ params }: Props) {
  return (
    <main className="crPage">
      <ChangeHeader title={`${params.id} · Activity`} subtitle="Comments, attachments, and audit trail" />
      <section className="crFormShell">
        <div className="crSection">
          <h2 className="crH2">Activity</h2>
          <p className="crMuted">
            Placeholder page. When you wire persistence, this becomes your immutable log (comments, approvals, attachments,
            timestamps).
          </p>
        </div>
      </section>
    </main>
  );
}
