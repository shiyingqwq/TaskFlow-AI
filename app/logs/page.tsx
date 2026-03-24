import { DailyLogPanel } from "@/components/daily-log-panel";
import { TopSectionNav } from "@/components/top-section-nav";

export default function LogsPage() {
  return (
    <main className="space-y-6 pb-10">
      <TopSectionNav logsActive />
      <DailyLogPanel />
    </main>
  );
}

