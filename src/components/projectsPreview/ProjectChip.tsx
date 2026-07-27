import type { ProjectRefEntity } from "@/lib/projectsPreview/types";

interface ProjectChipProps {
  refEntity: ProjectRefEntity;
  onClick?: () => void;
}

export function ProjectChip({ refEntity, onClick }: ProjectChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex max-w-full items-center rounded-md border border-accent/35 bg-accent/10 px-1.5 py-0.5 text-left text-[12px] font-medium text-accent transition hover:bg-accent/20"
      title={refEntity.labelSnapshot}
    >
      <span className="truncate">{refEntity.labelSnapshot}</span>
    </button>
  );
}
