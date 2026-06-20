import { useStore } from "@/state/store";
import { TodoPanel } from "@/components/todo/TodoPanel";
import { ItemEditorPanel } from "@/components/item/ItemEditorPanel";

export function SidePanel() {
  const editingId = useStore((s) => s.editingId);
  return editingId ? <ItemEditorPanel /> : <TodoPanel />;
}
