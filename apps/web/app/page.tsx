// There is no landing page: the app shell sends anyone who is not signed in on to /login.

import { redirect } from "next/navigation";

export default function Home() {
  redirect("/inbox");
}
