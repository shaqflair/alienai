import HomePage from "@/components/home/HomePage";
import { getHomeData } from "@/lib/home/getHomeData";

export default async function Page() {
  const data = await getHomeData();

  // You can redirect to /login here if you want
  // if (!data.ok) redirect("/login");

  return <HomePage data={data} />;
}
