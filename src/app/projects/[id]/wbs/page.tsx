import { redirect } from "next/navigation";

export default function ProjectWbsRedirectPage({ params }: { params: { id: string } }) {
  // ✅ you can swap this to your real WBS editor page later
  redirect(`/projects/${params.id}`);
}
