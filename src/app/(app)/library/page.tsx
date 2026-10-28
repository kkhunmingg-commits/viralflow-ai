import { redirect } from "next/navigation";

/** The clip library now lives on the free Google Flow page. */
export default function LibraryPage() {
  redirect("/post");
}
