import ChangeBoard from "@/components/change/ChangeBoard";
import ChangeHeader from "@/components/change/ChangeHeader";
import ChangeManagementBoard from "@/components/change/ChangeManagementBoard";

export default function ChangeLogPage() {
  return (
    <main className="crPage">
      <ChangeHeader title="Change Control" subtitle="Fast scanning for busy PMs" />
      <ChangeBoard />
    </main>
  );
}
