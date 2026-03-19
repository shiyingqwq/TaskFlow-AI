import { statusLabels, statusTone } from "@/lib/constants";

type Props = {
  status: keyof typeof statusLabels;
};

export function StatusBadge({ status }: Props) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusTone[status]}`}>
      {statusLabels[status]}
    </span>
  );
}
