import { ImportForm } from "@/components/import-form";
import { TopSectionNav } from "@/components/top-section-nav";

export default function ImportPage() {
  return (
    <main className="space-y-6 pb-10">
      <TopSectionNav importActive />
      <ImportForm />
    </main>
  );
}
