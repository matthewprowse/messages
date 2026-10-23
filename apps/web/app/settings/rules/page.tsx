import { redirect } from "next/navigation";

export default async function Page({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const { add } = await searchParams;
  redirect(`/settings/personalisation${add ? `?add=${encodeURIComponent(add)}` : ""}#priorities`);
}
