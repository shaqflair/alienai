// Forces dynamic rendering on this route — prevents "window is not defined"
// during static prerender when client components access browser APIs.
export const dynamic = "force-dynamic";

export default function SuccessStoriesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
