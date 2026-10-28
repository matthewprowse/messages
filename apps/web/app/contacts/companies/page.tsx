// Companies are listed on the Contacts page, under the Companies tab.

import { redirect } from "next/navigation";

export default function CompaniesIndex() {
  redirect("/contacts?view=companies");
}
