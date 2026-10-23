import { redirect } from "next/navigation";

// Companies are listed on the Contacts page, under the Companies tab.
export default function CompaniesIndex() {
  redirect("/contacts?view=companies");
}
