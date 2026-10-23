// src/app/reports/page.tsx  ->  /v2/reports
// rpt-01: the v2 Reports landing is the Cutting activity report for now. redirect() paths are
// basePath-relative, so "/reports/cutting" lands on /v2/reports/cutting.
import { redirect } from "next/navigation";

export default function ReportsIndex() {
  redirect("/reports/cutting");
}
